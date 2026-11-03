import sqlite3 from 'sqlite3'
import { promises as fs } from 'fs'
import * as path from 'path'
import { streamDirectories, type EntryReader } from './directory-stream'
import type { DirectoryPage, DirectoryPageRequest, FileNode, ScanProgress, ScanResult } from '../preload/types'

export type { EntryReader } from './directory-stream'
export type ScanOptions = { concurrency?: number }
type Row = { id: number; path: string; parent: number | null; depth: number; name: string; size: number; allocated: number | null;
  attributed: number | null; identity: string | null; type: 'file' | 'directory'; status: NonNullable<FileNode['status']>;
  modified: number; skipReason: string | null; files: number; dirs: number; items: number; unknown: number; links: number; owner: string | null }
const APPLICATION_ID = 1146505555
const categories: Record<string, string[]> = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico', 'heic', 'raw'],
  video: ['mp4', 'mkv', 'avi', 'mov', 'webm'], audio: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'],
  document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'csv', 'odt'],
  code: ['js', 'ts', 'tsx', 'jsx', 'py', 'rs', 'go', 'c', 'cpp', 'h', 'java', 'cs', 'json', 'html', 'css'],
  archive: ['zip', '7z', 'rar', 'tar', 'gz', 'bz2', 'xz']
}
const extensionCategories = new Map(Object.entries(categories).flatMap(([category, extensions]) => extensions.map(extension => [extension, category] as const)))
const categoryOf = (name: string) => extensionCategories.get(path.extname(name).slice(1).toLowerCase()) ?? 'other'
const readNode = (row: Row): FileNode => ({
  name: row.name, path: row.path, type: row.type, size: row.size,
  ...(row.allocated === null ? {} : { allocatedSize: row.allocated }), allocationUnknownFiles: row.unknown,
  ...(row.links > 1 ? { hardlinkCount: row.links, allocationOwner: row.owner ?? undefined } : {}),
  modified: row.modified || undefined, extension: row.type === 'file' ? path.extname(row.name).slice(1).toLowerCase() || undefined : undefined,
  status: row.status, skipReason: row.skipReason ?? undefined,
  childrenLoaded: !['pending', 'scanning', 'error', 'skipped'].includes(row.status),
  detailsAvailable: row.type === 'directory' && !['pending', 'scanning', 'error', 'skipped'].includes(row.status),
  itemCount: row.items, fileCount: row.files, directoryCount: row.dirs
})

/** SQLite owns the file records, sorting and identity index. JS holds only a batch/page. */
export class DiskScanIndex {
  private constructor(private readonly db: sqlite3.Database, readonly filePath: string, private result: ScanResult) {}
  private run(sql: string, values: unknown[] = []): Promise<void> { return new Promise((resolve, reject) => this.db.run(sql, values, error => error ? reject(error) : resolve())) }
  private all<T = Row>(sql: string, values: unknown[] = []): Promise<T[]> { return new Promise((resolve, reject) => this.db.all(sql, values, (error, rows: T[]) => error ? reject(error) : resolve(rows))) }
  private async one<T = Row>(sql: string, values: unknown[] = []): Promise<T | undefined> { return (await this.all<T>(sql, values))[0] }
  private exec(sql: string): Promise<void> { return new Promise((resolve, reject) => this.db.exec(sql, error => error ? reject(error) : resolve())) }
  async close(): Promise<void> { return new Promise((resolve, reject) => this.db.close(error => error ? reject(error) : resolve())) }
  private static connect(file: string, flags: number): Promise<sqlite3.Database> {
    return new Promise((resolve, reject) => { const db = new sqlite3.Database(file, flags, error => error ? reject(error) : resolve(db)) })
  }
  static async open(file: string, scanId: string): Promise<DiskScanIndex> {
    const db = await this.connect(file, sqlite3.OPEN_READONLY)
    const index = new DiskScanIndex(db, file, {} as ScanResult)
    try {
      await index.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA cache_size=-8192; PRAGMA temp_store=FILE;')
      const app = await index.one<{ application_id: number }>('PRAGMA application_id')
      const version = await index.one<{ user_version: number }>('PRAGMA user_version')
      if (app?.application_id !== APPLICATION_ID || version?.user_version !== 1) throw new Error('This is not a supported DiskSizer scan.')
      const meta = await index.one<{ value: string }>('SELECT value FROM metadata WHERE key=\'result\'')
      if (!meta || meta.value.length > 256_000) throw new Error('The saved scan is incomplete or invalid.')
      const result = JSON.parse(meta.value) as ScanResult
      if (!result.root || !path.isAbsolute(result.root.path) || !['complete', 'partial', 'cancelled'].includes(result.status)) throw new Error('Invalid saved scan metadata.')
      index.result = { ...result, scanId, source: 'snapshot', snapshotPath: file, storage: 'sqlite', indexed: true }
      await index.summary()
      return index
    } catch (error) { await index.close(); throw error }
  }
  static async scan(file: string, rootPath: string, scanId: string, engine: 'native' | 'standard', read: EntryReader,
    signal: AbortSignal, progress: (value: ScanProgress) => void, options: ScanOptions = {}): Promise<DiskScanIndex> {
    const concurrency = options.concurrency ?? 4
    if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error('Choose 1–16 directory readers.')
    const target = path.resolve(rootPath)
    if (!(await fs.stat(target)).isDirectory()) throw new Error('Choose a folder or drive to scan.')
    await fs.mkdir(path.dirname(file), { recursive: true })
    // Exclusive reservation prevents overwriting an earlier scan.
    const reservation = await fs.open(file, 'wx'); await reservation.close()
    const db = await this.connect(file, sqlite3.OPEN_READWRITE)
    const started = Date.now()
    const index = new DiskScanIndex(db, file, {
      scanId, engine, sizeKind: 'logical', status: 'complete', root: { name: path.basename(target) || target, path: target, type: 'directory', size: 0 },
      totalSize: 0, totalFiles: 0, totalDirectories: 0, scanDurationMs: 0, errors: [], errorCount: 0, skippedCount: 0,
      createdAt: new Date().toISOString(), source: 'live', snapshotPath: file, storage: 'sqlite', indexed: true
    })
    let transaction = false
    try {
      await index.exec(`PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=1;
        PRAGMA cache_size=-8192; PRAGMA temp_store=FILE; PRAGMA synchronous=NORMAL;
        CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE nodes(id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, parent INTEGER, depth INTEGER NOT NULL,
          name TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL, size REAL NOT NULL DEFAULT 0,
          allocated REAL, attributed REAL, identity TEXT, modified REAL NOT NULL DEFAULT 0, category TEXT, skipReason TEXT, searchName TEXT,
          files INTEGER NOT NULL DEFAULT 0, dirs INTEGER NOT NULL DEFAULT 0, items INTEGER NOT NULL DEFAULT 0,
          unknown INTEGER NOT NULL DEFAULT 0, links INTEGER NOT NULL DEFAULT 1, owner TEXT);
        CREATE INDEX parent_nodes ON nodes(parent);
        CREATE INDEX queue_nodes ON nodes(type,status,id);
        CREATE INDEX depth_nodes ON nodes(depth,type);
        BEGIN IMMEDIATE;`)
      transaction = true
      await index.run('INSERT INTO nodes(path,parent,depth,name,type,status) VALUES (?,NULL,0,?,\'directory\',\'pending\')', [target, index.result.root.name])
      let lastProgress = 0, currentPath = target
      const recordError = (filePath: string, message: string) => {
        index.result.errorCount++; if (index.result.errors.length < 100) index.result.errors.push(`${filePath}: ${message}`)
      }
      const publish = async (force = false, phase: ScanProgress['phase'] = 'scanning') => {
        if (!force && Date.now() - lastProgress < 250) return
        lastProgress = Date.now()
        // A bounded preview of root entries; aggregate direct bytes at each finished directory.
        const top = await index.all('SELECT * FROM nodes WHERE parent=1 ORDER BY size DESC LIMIT 40')
        const children = top.map(readNode)
        const represented = children.reduce((sum, node) => sum + node.size, 0)
        if (represented < index.result.totalSize) children.push({ name: 'Other discovered items', path: `aggregate:${target}`, type: 'directory', kind: 'aggregate', size: index.result.totalSize - represented })
        progress({ scanId, engine, phase, currentPath, filesScanned: index.result.totalFiles, directoriesScanned: index.result.totalDirectories,
          totalSizeBytes: index.result.totalSize, elapsedMs: Date.now() - started, errorCount: index.result.errorCount, skippedCount: index.result.skippedCount,
          partialRoot: { ...index.result.root, size: index.result.totalSize, itemCount: Math.max(0, index.result.totalFiles + index.result.totalDirectories - 1), children, childrenLoaded: false, status: 'scanning' } })
      }
      await publish(true)
      const excluded = new Set([file, `${file}-journal`, `${file}-wal`, `${file}-shm`].map(name => path.resolve(name).toLowerCase()))
      const insertColumns = 'path,parent,depth,name,type,status,size,allocated,attributed,identity,modified,category,skipReason,files,unknown,searchName'
      let values: unknown[] = []
      const flush = async () => {
        if (!values.length) return
        const tuples = Array(values.length / 16).fill('(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',')
        await index.run(`INSERT INTO nodes(${insertColumns}) VALUES ${tuples}`, values)
        values = []
      }
      while (!signal.aborted) {
        // SQLite retains the full queue; JS holds only this bounded window.
        const directories = await index.all<Pick<Row, 'id' | 'path' | 'depth'>>("SELECT id,path,depth FROM nodes WHERE type='directory' AND status='pending' ORDER BY id LIMIT 64")
        if (!directories.length) break
        const states = new Map<number, { status: string; reason: string | null; observed: boolean }>()
        for await (const event of streamDirectories(directories, read, signal, concurrency, directory => {
          index.result.totalDirectories++
          states.set(directory.id, { status: 'partial', reason: null, observed: false })
        })) {
          const directory = event.directory
          currentPath = directory.path
          const state = states.get(directory.id)!
          if (event.kind === 'error') {
            if (event.error instanceof Error && /^SQLITE_/.test((event.error as Error & { code?: string }).code || '')) throw event.error
            recordError(directory.path, String(event.error))
            state.status = state.observed ? 'partial' : 'error'; state.reason = String(event.error)
          } else if (event.kind === 'end') state.status = 'complete'
          else {
            for (const entry of event.entries) {
              if (signal.aborted) break
              if (!entry.name || entry.name === '.' || entry.name === '..' || path.basename(entry.name) !== entry.name || entry.name.includes('\0')) {
                recordError(directory.path, 'Invalid directory entry name.'); continue
              }
              const childPath = path.join(directory.path, entry.name)
              const writingIndex = excluded.has(childPath.toLowerCase())
              const skipped = entry.isSymlink || !!entry.skipReason || writingIndex
              const observed = !skipped && !entry.error && !entry.isDir
              const measured = observed && Number.isFinite(entry.allocatedSize) && entry.allocatedSize! >= 0
              const known = measured && !!entry.fileIdentity
              const size = observed && Number.isFinite(entry.size) && entry.size >= 0 ? entry.size : 0
              const status = skipped ? 'skipped' : entry.error ? 'error' : entry.isDir ? 'pending' : 'complete'
              if (skipped) index.result.skippedCount++
              if (entry.error) recordError(childPath, entry.error)
              if (observed) { index.result.totalFiles++; index.result.totalSize += size }
              values.push(childPath, directory.id, directory.depth + 1, entry.name, entry.isDir ? 'directory' : 'file', status,
                size, measured ? entry.allocatedSize : null, known ? entry.allocatedSize : null, observed ? entry.fileIdentity ?? null : null,
                entry.mtime || 0, categoryOf(entry.name), writingIndex ? 'Active scan database excluded while it is being written.' : entry.skipReason || entry.error || (entry.isSymlink ? 'Link not followed.' : null), observed ? 1 : 0, observed && !known ? 1 : 0, entry.name.toLocaleLowerCase())
              state.observed = true
              // Batch across small directory boundaries, not just within a single directory.
              if (values.length >= 256 * 16) await flush()
            }
          }
          if (Date.now() - lastProgress >= 250) { await flush(); await publish() }
        }
        await flush()
        if (states.size) {
          const updates = [...states].flatMap(([id, state]) => [id, state.status, state.reason])
          await index.run(`WITH states(id,status,reason) AS (VALUES ${Array(states.size).fill('(?,?,?)').join(',')})
            UPDATE nodes SET status=(SELECT status FROM states WHERE states.id=nodes.id), dirs=1,
              skipReason=(SELECT reason FROM states WHERE states.id=nodes.id) WHERE id IN (SELECT id FROM states)`, updates)
        }
      }
      await publish(true, 'building')
      await index.exec('CREATE INDEX identity_nodes ON nodes(identity,path); CREATE INDEX size_nodes ON nodes(type,size DESC,path); CREATE INDEX allocation_nodes ON nodes(type,allocated DESC,path);')
      await index.aggregate()
      index.result.status = signal.aborted ? 'cancelled' : index.result.errorCount || index.result.skippedCount ? 'partial' : 'complete'
      index.result.scanDurationMs = Date.now() - started
      await index.persist()
      await index.exec('COMMIT'); transaction = false
      return index
    } catch (error) {
      if (transaction) await index.exec('ROLLBACK').catch(() => {})
      await index.close().catch(() => {})
      // Only remove this invocation's exclusively-created, incomplete database.
      await fs.unlink(file).catch(() => {})
      throw error
    }
  }
  private async aggregate(): Promise<void> {
    // Deterministic allocation attribution to the lexicographically first observed name.
    // Logical size always includes every name. Unknown identities are never guessed.
    await this.exec(`UPDATE nodes SET attributed=CASE WHEN identity IS NULL THEN NULL ELSE allocated END,links=1,owner=NULL WHERE type='file';
      DROP TABLE IF EXISTS temp.shared;
      CREATE TEMP TABLE shared AS SELECT identity,MIN(path) AS owner,COUNT(*) AS links FROM nodes
        WHERE identity IS NOT NULL AND type='file' AND status='complete' GROUP BY identity HAVING COUNT(*)>1;
      CREATE UNIQUE INDEX shared_identity ON shared(identity);
      UPDATE nodes SET owner=(SELECT owner FROM shared WHERE shared.identity=nodes.identity),
        links=(SELECT links FROM shared WHERE shared.identity=nodes.identity),
        attributed=CASE WHEN path=(SELECT owner FROM shared WHERE shared.identity=nodes.identity) THEN allocated ELSE 0 END
        WHERE identity IN (SELECT identity FROM shared);
      UPDATE nodes SET status='partial' WHERE status='scanning';`)
    const max = await this.one<{ depth: number }>('SELECT MAX(depth) AS depth FROM nodes WHERE type=\'directory\'')
    for (let depth = max?.depth ?? 0; depth >= 0; depth--) {
      await this.run(`UPDATE nodes SET
        size=COALESCE((SELECT SUM(c.size) FROM nodes c WHERE c.parent=nodes.id),0),
        allocated=COALESCE((SELECT SUM(CASE WHEN c.type='file' THEN c.attributed ELSE c.allocated END) FROM nodes c WHERE c.parent=nodes.id),0),
        unknown=COALESCE((SELECT SUM(c.unknown) FROM nodes c WHERE c.parent=nodes.id),0),
        files=COALESCE((SELECT SUM(c.files) FROM nodes c WHERE c.parent=nodes.id),0),
        dirs=CASE WHEN status IN ('pending','skipped') THEN 0 ELSE 1 END + COALESCE((SELECT SUM(c.dirs) FROM nodes c WHERE c.parent=nodes.id),0),
        items=COALESCE((SELECT SUM(1+c.items) FROM nodes c WHERE c.parent=nodes.id),0),
        status=CASE WHEN status='complete' AND EXISTS(SELECT 1 FROM nodes c WHERE c.parent=nodes.id AND c.status<>'complete') THEN 'partial' ELSE status END
        WHERE type='directory' AND depth=?`, [depth])
    }
  }
  private async persist(): Promise<void> {
    const summary = await this.summary()
    await this.run('INSERT OR REPLACE INTO metadata(key,value) VALUES (\'result\',?)', [JSON.stringify(summary)])
  }
  async summary(): Promise<ScanResult> {
    const root = await this.one('SELECT * FROM nodes WHERE parent IS NULL')
    if (!root || root.path !== this.result.root.path) throw new Error('The scan root is missing or invalid.')
    this.result = { ...this.result, root: readNode(root), totalSize: root.size, totalFiles: root.files, totalDirectories: root.dirs }
    return this.result
  }
  async page(request: DirectoryPageRequest): Promise<DirectoryPage> {
    if (request.scanId !== this.result.scanId) throw new Error('These scan results are no longer active.')
    const directory = await this.one('SELECT * FROM nodes WHERE path=? AND type=\'directory\'', [request.path])
    if (!directory) throw new Error('This directory is not part of the scan.')
    if (!readNode(directory).detailsAvailable) throw new Error('This directory was not read. Rescan its parent.')
    const offset = request.offset ?? 0, limit = Math.min(request.limit ?? 100, 1000)
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid page size or offset.')
    if (request.query !== undefined && (typeof request.query !== 'string' || request.query.length > 1024)) throw new Error('Invalid search query.')
    if (request.scope !== undefined && !['folder', 'scan'].includes(request.scope)) throw new Error('Invalid search scope.')
    if (request.category !== undefined && !['all', ...Object.keys(categories), 'other'].includes(request.category)) throw new Error('Invalid file category.')
    if (request.modifiedBefore !== undefined && (!Number.isFinite(request.modifiedBefore) || request.modifiedBefore < 0)) throw new Error('Invalid modification filter.')
    if (request.sizeMetric !== undefined && !['logical', 'allocated'].includes(request.sizeMetric)) throw new Error('Invalid size metric.')
    const global = request.scope === 'scan', values: unknown[] = global ? [] : [directory.id]
    const where = [global ? 'type=\'file\' AND status=\'complete\'' : 'parent=?']
    if (request.query?.trim()) { where.push('instr(searchName,?)>0'); values.push(request.query.trim().toLocaleLowerCase()) }
    if (request.category && request.category !== 'all') { where.push('type=\'file\' AND category=?'); values.push(request.category) }
    if (request.modifiedBefore !== undefined) { where.push('type=\'file\' AND modified>0 AND modified<?'); values.push(request.modifiedBefore) }
    const condition = where.join(' AND ')
    const totalMatches = (await this.one<{ count: number }>(`SELECT COUNT(*) AS count FROM nodes WHERE ${condition}`, values))!.count
    const actualOffset = Math.min(offset, totalMatches ? Math.floor((totalMatches - 1) / limit) * limit : 0)
    const metric = request.sizeMetric === 'allocated' ? 'allocated' : 'size'
    const rows = await this.all(`SELECT * FROM nodes WHERE ${condition} ORDER BY ${metric === 'allocated' ? 'allocated IS NULL,' : ''}${metric} ${request.descending === false ? 'ASC' : 'DESC'},path LIMIT ? OFFSET ?`, [...values, limit, actualOffset])
    const ancestors: FileNode[] = []; let current: Row | undefined = directory
    const visited = new Set<number>()
    while (current) {
      if (visited.has(current.id) || visited.size > 32768) throw new Error('Invalid saved directory ancestry.')
      visited.add(current.id); ancestors.unshift(readNode(current))
      current = current.parent === null ? undefined : await this.one('SELECT * FROM nodes WHERE id=?', [current.parent])
    }
    const root = (await this.summary()).root
    const totalChildren = global ? this.result.totalFiles : (await this.one<{ count: number }>('SELECT COUNT(*) AS count FROM nodes WHERE parent=?', [directory.id]))!.count
    return { scanId: this.result.scanId, node: { ...readNode(directory), children: rows.map(readNode) }, root, ancestors, totalMatches, totalChildren, offset: actualOffset, limit }
  }
  async validateDeletion(target: string): Promise<FileNode> {
    if (this.result.source === 'snapshot') throw new Error('Saved scans are read-only. Rescan before deleting files.')
    const row = await this.one('SELECT * FROM nodes WHERE path=?', [target])
    if (!row || row.parent === null || row.status !== 'complete') throw new Error('Only fully scanned items below the scan root can be recycled.')
    return readNode(row)
  }
  async remove(target: string): Promise<ScanResult> {
    await this.validateDeletion(target)
    await this.exec('BEGIN IMMEDIATE')
    try {
      await this.run(`WITH RECURSIVE removed(id) AS (SELECT id FROM nodes WHERE path=? UNION ALL SELECT n.id FROM nodes n JOIN removed r ON n.parent=r.id)
        DELETE FROM nodes WHERE id IN (SELECT id FROM removed)`, [target])
      await this.aggregate(); await this.persist(); await this.exec('COMMIT')
      return this.summary()
    } catch (error) { await this.exec('ROLLBACK'); throw error }
  }
}
