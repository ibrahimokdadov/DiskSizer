**Adopted priorities — DiskSizer 1.1.0**

The priorities from the open-source comparison are now the development order. Version 1.1.0 implements allocation-aware inspection, global file search, and persistent storage. Optional MFT acceleration is gated on profiling and correctness comparisons; it is not part of this release.

| Priority | Delivered in 1.1.0 | Next acceptance gate |
|---|---|---|
| Trustworthy accounting | Native allocation/file identity; sparse/compressed metadata; deterministic hardlink attribution; explicit unknowns; logical/on-disk selection and explanations | Add fixtures for provider-specific cloud behavior, streams, ReFS and network volumes; never equate allocation with reclaimable space |
| Search and inspection | Global largest-file view, Unicode name search, file category and modification-age filters, allocation sorting, full paths, existing media previews | Measure cleanup-task completion against WinDirStat/Filelight; refine category rules from actual use |
| Persistent scans and bounded memory | SQLite file records, disk-backed queue/sort/identity index, bounded native/portable batches, dated automatic saves, save copy and read-only reopen | Profile large whole-volume writes, optimize disk space/latency, add snapshot comparison and a scan-history management view |
| Optional NTFS acceleration | Decision recorded; normal read-only metadata enumeration remains the scanner | Profile traversal versus SQLite/finalization first. Benchmark equal targets/policies under standard and elevated permissions. Implement isolated MFT helper only if traversal is the material bottleneck |

The scan worker is intentionally the only owner of its SQLite connection. Queries, deletion accounting, and export run serially. A saved scan is read-only at both the UI and worker boundaries, and opening a different scan invalidates old requests. The active database/journal is explicitly excluded if it falls inside the scan target. Prior completed scan files are ordinary files and may appear in later scans.

Logical bytes count every observed path. Allocation totals count a shared identity once, attributed to the lexicographically first observed path in the scan. Per-file allocation remains visible at every alias. Deleting an attributed alias transfers the contribution to another observed alias. Unknown allocation or identity is omitted from the known folder-allocation total and counted explicitly. These measurements cover normal file data, not all volume metadata or a guarantee about alternate streams or reclaimable storage. Scans are not atomic filesystem snapshots.

Automatic saves consume disk space and are retained under the application's user-data `scans` directory. They are not automatically expired. Users can open that location with **Open scan**, save a named copy elsewhere, and manage old files through Windows. A normal Stop commits available partial results; a forced helper stop may leave an incomplete database that cannot be reopened. An I/O/database failure fails visibly and does not turn into an apparently complete scan.

**Validation and measured tradeoffs**

- Regression coverage includes actual NTFS hardlinks and sparse files, native batches bounded to 256 records, portable batches bounded to 128, allocation transfer after removal, combined global filters, Unicode case matching, cancellation, and foreign/incomplete database rejection.
- The real Electron UI smoke check exercises native/SQLite loading, global filters, pagination, maps, previews, compact layout, save/reopen, and snapshot deletion rejection.
- The packaged executable passed three rounds of scans, exact fixture totals, paging/navigation, Stop/replacement, deliberate scanner-process failure and recovery, 30 seconds of responsive idle, and normal exit.
- A 100,000-record synthetic storage run took 3.593 seconds, sampled peak JavaScript heap 41.0 MiB, sampled process RSS 127.9 MiB, and produced a 53.7 MiB database. It generates metadata records, so it is not a filesystem enumeration benchmark.
- Packaged native scans of this checkout's dependency directory (14,950 files / 1,895 directories) took 2.197, 2.188, and 2.100 seconds. This includes allocation metadata and persistent indexing. It is slower than the earlier logical-only in-memory scanner; no speedup is claimed. The older 4.36-million-file measurement is for version 1.0.1 and must not be presented as a 1.1.0 timing.

Use `npm run benchmark:storage -- <stable-folder> 3` to measure the current storage engine. The older `benchmark` command remains a comparison of legacy tree-returning scanners and is not the production persistence benchmark. Cold-cache control, an elevated WinDirStat comparison, and a new whole-volume memory/disk-space evaluation remain needed before an MFT decision.
