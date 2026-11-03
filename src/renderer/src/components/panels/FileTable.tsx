import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, File, Folder, FolderOpen, Loader2, Search, X } from 'lucide-react'
import type { DirectoryPageRequest, FileNode } from '../../types/scan'
import { useScanStore } from '../../store/scan-store'
import { useUIStore } from '../../store/ui-store'
import { useContextMenu } from '../../hooks/useContextMenu'
import { formatBytes, formatNumber } from '../../lib/format'
import { getFileColor } from '../../lib/colors'
import { canNavigate } from '../../lib/scan-tree'
import { useDirectoryPage } from '../../hooks/useDirectoryPage'

const PAGE_SIZE = 100

export function FileTable({ node, live = false }: { node: FileNode; live?: boolean }) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [descending, setDescending] = useState(true)
  const [scope, setScope] = useState<'folder' | 'scan'>('folder')
  const [category, setCategory] = useState<NonNullable<DirectoryPageRequest['category']>>('all')
  const [age, setAge] = useState(0)
  const [sizeMetric, setSizeMetric] = useState<'logical' | 'allocated'>('logical')
  const modifiedBefore = useMemo(() => age ? Date.now() - age * 86400000 : undefined, [age])
  const selectedNode = useUIStore(s => s.selectedNode)
  const select = useUIStore(s => s.setSelectedNode)
  const navigateIn = useScanStore(s => s.navigateIn)
  const indexed = useScanStore(s => !!s.scanResult?.indexed) && !live
  const { showContextMenu } = useContextMenu()
  useEffect(() => { setPage(0); setQuery('') }, [node.path])
  const directory = useDirectoryPage(node, { enabled: indexed, offset: page * PAGE_SIZE, limit: PAGE_SIZE, query, descending, scope, category, modifiedBefore, sizeMetric })
  const rows = useMemo(() => {
    if (indexed) return directory.page?.node.children || []
    const needle = query.trim().toLocaleLowerCase()
    return (node.children || []).filter(child => !needle || child.name.toLocaleLowerCase().includes(needle)).slice().sort((a, b) => (descending ? b.size - a.size : a.size - b.size) || a.name.localeCompare(b.name))
  }, [indexed, directory.page, node.children, query, descending])
  const totalMatches = indexed ? directory.page?.totalMatches ?? 0 : rows.length
  const pages = Math.max(1, Math.ceil(totalMatches / PAGE_SIZE))
  const currentPage = indexed && directory.page ? Math.floor(directory.page.offset / PAGE_SIZE) : Math.min(page, pages - 1)
  const visible = indexed ? rows : rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
  const loading = indexed && directory.loading
  const error = indexed ? directory.error : undefined
  const incomplete = node.childrenLoaded === false || (node.status !== undefined && node.status !== 'complete')
  useEffect(() => {
    if (indexed && directory.page && directory.page.offset !== page * PAGE_SIZE) setPage(Math.floor(directory.page.offset / PAGE_SIZE))
  }, [indexed, directory.page, page])
  const open = (item: FileNode) => {
    if (canNavigate(item) && !live) {
      navigateIn(item)
      select(null)
    }
  }

  return (
    <section className="file-browser" aria-label="Files and folders">
      <div className="table-toolbar"><div className="table-label">{live ? 'Largest items found so far' : scope === 'scan' ? 'All scanned files' : 'Files & folders'}<span>{loading ? '…' : formatNumber(totalMatches)}</span></div><label className="search-field"><Search size={15} /><input value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} placeholder={scope === 'scan' ? 'Search all scanned files' : 'Filter this folder'} aria-label="Filter files and folders by name" />{query && <button aria-label="Clear filter" onClick={() => { setQuery(''); setPage(0) }}><X size={13} /></button>}</label></div>
      {indexed && <div className="file-filters">
        <label>Search in<select aria-label="Search scope" value={scope} onChange={event => { setScope(event.target.value as 'folder' | 'scan'); setPage(0) }}><option value="folder">This folder</option><option value="scan">All scanned files</option></select></label>
        <label>Type<select aria-label="File type filter" value={category} onChange={event => { setCategory(event.target.value as typeof category); setPage(0) }}>{['all', 'image', 'video', 'audio', 'document', 'code', 'archive', 'other'].map(value => <option key={value} value={value}>{value === 'all' ? 'All types' : value[0].toUpperCase() + value.slice(1)}</option>)}</select></label>
        <label>Modified<select aria-label="File age filter" value={age} onChange={event => { setAge(Number(event.target.value)); setPage(0) }}><option value={0}>Any time</option><option value={30}>Over 30 days ago</option><option value={180}>Over 6 months ago</option><option value={365}>Over a year ago</option></select></label>
        <label>Size<select aria-label="Size metric" value={sizeMetric} onChange={event => { setSizeMetric(event.target.value as 'logical' | 'allocated'); setPage(0) }}><option value="logical">Logical file size</option><option value="allocated">On disk</option></select></label>
      </div>}
      {indexed && sizeMetric === 'allocated' && <p className="allocation-note">File allocation is shown per name. Folder totals count hardlinks once across this scan. Unknown allocation is excluded from folder totals; this is not reclaimable space.</p>}
      <div className="table-scroll">
        <table className="file-table">
          <thead><tr><th scope="col">Name</th><th scope="col" className="type-column">Type</th><th scope="col" className="size-column" aria-sort={descending ? 'descending' : 'ascending'}><button onClick={() => { setDescending(!descending); setPage(0) }} aria-label={`Sort file size ${descending ? 'smallest' : 'largest'} first`}>{sizeMetric === 'allocated' && !live ? 'On disk' : 'File size'}{descending ? <ArrowDown size={12} /> : <ArrowUp size={12} />}</button></th><th scope="col" className="share-column" title="Share of the current folder's analyzed file size">Share</th><th className="open-column"><span className="sr-only">Open folder</span></th></tr></thead>
          <tbody>{visible.map(item => {
            const isDirectory = item.type === 'directory'
            const aggregate = item.kind === 'aggregate'
            const waiting = (item.childrenLoaded === false && !item.detailsAvailable) || item.status === 'scanning' || item.status === 'pending'
            const canOpen = canNavigate(item) && !live
            const selected = selectedNode?.path === item.path && !aggregate
            const size = sizeMetric === 'allocated' && !live ? item.allocatedSize : item.size
            const base = scope === 'scan' ? directory.page?.root ?? node : node
            const total = sizeMetric === 'allocated' && !live ? base.allocatedSize ?? 0 : base.size
            const percent = total > 0 ? Math.min(100, (size ?? 0) / total * 100) : 0
            return <tr key={item.path || item.name} data-file-row tabIndex={aggregate ? -1 : 0} aria-selected={selected} className={`${selected ? 'selected' : ''} ${aggregate ? 'aggregate-row' : ''}`} onClick={() => { if (!aggregate) select(item) }} onDoubleClick={() => open(item)} onContextMenu={event => { if (!aggregate) showContextMenu(event, item) }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); if (canOpen) open(item); else if (!aggregate) select(item) } else if (event.key === ' ') { event.preventDefault(); if (!aggregate) select(item) } }}>
              <td><div className="file-name-cell"><span className={`file-icon ${isDirectory ? 'folder' : ''}`} style={!isDirectory ? { color: getFileColor(item.extension) } : undefined}>{isDirectory ? <Folder size={18} /> : <File size={17} />}</span><div className="min-w-0"><span className="file-name" title={item.path}>{item.name}</span>{scope === 'scan' && !live && <span className="file-subtitle" title={item.path}>{item.path}</span>}{item.status === 'error' || item.status === 'skipped' ? <span className="file-subtitle warning" title={item.skipReason}>{item.skipReason || 'Not included'}</span> : waiting && isDirectory ? <span className="file-subtitle">{live ? 'Scanning…' : 'Details not loaded'}</span> : aggregate ? <span className="file-subtitle">Included in the total</span> : null}</div></div></td>
              <td className="type-column">{aggregate ? 'Summary' : isDirectory ? 'Folder' : item.extension ? item.extension.toUpperCase() : 'File'}</td>
              <td className="size-column" title={scope === 'scan' ? item.path : undefined}>{size === undefined ? 'Unknown' : `${sizeMetric === 'allocated' && item.type === 'directory' && item.allocationUnknownFiles ? '≥ ' : ''}${formatBytes(size)}`}</td>
              <td className="share-column"><div className="share-cell"><span>{percent > 0 && percent < 0.1 ? '<0.1' : percent.toFixed(1)}%</span><div><i style={{ width: `${percent}%` }} /></div></div></td>
              <td className="open-column">{canOpen ? <button className="icon-button" title={`Open ${item.name}`} aria-label={`Open folder ${item.name}`} onClick={event => { event.stopPropagation(); open(item) }}><ChevronRight size={16} /></button> : live && waiting && isDirectory ? <Loader2 size={13} className="animate-spin opacity-40 mx-auto" /> : null}</td>
            </tr>
          })}</tbody>
        </table>
        {loading ? <div className="table-empty" role="status"><Loader2 size={24} className="animate-spin" /><strong>Loading folder…</strong></div> : error ? <div className="table-empty" role="alert"><FolderOpen size={26} strokeWidth={1.5} /><strong>Folder details are unavailable</strong><span className="max-w-lg break-words">{error}</span><span>Rescan this location to rebuild its results.</span><button className="text-button" onClick={directory.retry}>Retry loading</button></div> : rows.length === 0 && <div className="table-empty"><FolderOpen size={26} strokeWidth={1.5} /><strong>{query ? 'No matching items' : live ? 'Discovering folders…' : node.status === 'error' ? 'This folder couldn’t be read' : incomplete ? 'No scanned items to show' : 'This folder is empty'}</strong><span>{query ? 'Try a different name or clear the filter.' : live ? 'Results will appear here shortly.' : node.skipReason || (incomplete ? 'This scan is incomplete. Rescan this folder to check its contents.' : 'There are no files to show.')}</span>{query && <button className="text-button" onClick={() => setQuery('')}>Clear filter</button>}</div>}
      </div>
      <div className="table-pagination"><span>{loading ? 'Loading…' : error ? 'Details unavailable' : totalMatches ? `${formatNumber(currentPage * PAGE_SIZE + 1)}–${formatNumber(Math.min(currentPage * PAGE_SIZE + visible.length, totalMatches))} of ${formatNumber(totalMatches)} items` : '0 items'}{live && <span className="ml-2">· Live preview</span>}</span><div><button className="icon-button" aria-label="Previous page" disabled={loading || !!error || currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /></button><span>{currentPage + 1} / {pages}</span><button className="icon-button" aria-label="Next page" disabled={loading || !!error || currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></button></div></div>
    </section>
  )
}
