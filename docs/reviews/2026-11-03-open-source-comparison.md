Historical review: this records the implementation at the time of the review, under the former DiskVision name. For current behavior and performance limits, see [the 1.1.0 roadmap](../plans/2026-11-03-adopted-priorities.md).

**DiskVision compared with open-source disk analyzers — 3 November 2026**

DiskVision has a credible foundation for a Windows application focused on inspecting large files before cleanup. It does not currently match the breadth of WinDirStat, and its scanning architecture does not establish a speed advantage over existing tools. Its most promising distinction is the combination of a simple size-sorted list, embedded file previews, and clear explanations of incomplete results. That is a product direction to validate with users, not a demonstrated usability win.

This comparison uses the current local source, existing packaged-test evidence, official project documentation, release metadata, and selected competitor source files. No competitor binaries were installed or benchmarked for this research. Performance expectations below are architectural inferences, not comparative measurements. Release-tagged documentation was used where available so development-branch features are not silently treated as shipped features.

**The relevant alternatives**

| Tool and checked release | Platform and interface | What it establishes for this comparison |
|---|---|---|
| [WinDirStat 2.9.3](https://github.com/windirstat/windirstat/releases/tag/release/v2.9.3), released 11 October 2026 | Windows; native desktop UI | The principal direct competitor. Accelerated NTFS scans, richer accounting, multiple visualizations, duplicate detection, reports, and filesystem monitoring already exist. |
| [Filelight 26.08.2](https://apps.kde.org/filelight/), listed 8 October 2026 | Linux and Windows; Qt/KDE graphical UI | A focused visual explorer built around concentric rings, with local/remote/removable scan support advertised by the project and file-manager integration. Platform/provider capabilities and Windows package versions can differ. |
| [gdu 5.38.0](https://github.com/dundee/gdu/releases/tag/v5.38.0), released 5 October 2026 | Windows, Linux, macOS and others; terminal plus browser UI | Parallel scanning, a browser treemap and donut view, JSON import/export, and SQLite/BadgerDB storage. It is no longer accurate to characterize gdu as only a terminal alternative. |
| [dua 3.0.0](https://github.com/Byron/dua-cli/releases/tag/v3.0.0), released 2 November 2026 | Windows, Linux and macOS; CLI/terminal UI, with SVG flame graphs | A particularly relevant engineering reference: native Windows metadata batches, allocation/file identity, developer cleanup, snapshots, and snapshot comparison. |
| [QDirStat 2.0](https://github.com/shundhammer/qdirstat/releases/tag/2.0), released 18 January 2026 | Linux/BSD/Unix-oriented Qt UI; no native Windows version | A feature-design reference for file-type/age statistics, package ownership, configurable cleanup, and saved scan caches. It is not a direct native Windows substitute. |

Filelight's development metadata also contained a 26.08.3 entry dated 5 November; that future-dated entry was not treated as released on the research date.

**WinDirStat sets the broadest Windows baseline**

The [2.9.3 release README](https://github.com/windirstat/windirstat/blob/release/v2.9.3/README.md) documents features that overlap with or exceed DiskVision's current scope:

| Capability | DiskVision today | WinDirStat 2.9.3 |
|---|---|---|
| Main exploration | Size-sorted, paginated file list and optional treemap | Sortable file lists, largest files, file types, treemap, sunburst, and flame graph |
| Full local NTFS scan | Native directory traversal | Direct MFT acceleration when elevated; ordinary traversal fallback |
| Size semantics | Logical bytes; volume used/free statistics shown separately | Logical/physical size, hardlinks, and free/unknown space |
| Search | Name substring in the current directory page query | Search by name, size, file/folder type, or owner; richer scan filters including regular expressions |
| Inspect contents | Embedded image, text, video, and audio previews, subject to supported formats/codecs | Extensive metadata inspection and opening files; equivalent embedded multimedia preview is not established by the reviewed documentation |
| Duplicate detection | Not implemented | Configurable hashing; sampled matches explicitly labeled probable duplicates |
| Saved results | Index lives in the scan helper and is replaced by a new scan | Save/load CSV or JSON and command-line reports |
| Refresh | Rescanning a chosen location; no persistent journal reconciliation | Refresh selected/all, pause/resume, and filesystem monitoring |
| Cleanup | Explorer reveal and confirmed Recycle Bin actions; heuristic review notes | Move/delete, custom cleanup commands, compression, deduplication, and other advanced tools |

The [WinDirStat scanning guide](https://github.com/windirstat/windirstat/wiki/Scanning) explicitly limits MFT acceleration to elevated local NTFS drive scans. Folder-only, network, and non-NTFS scans use ordinary scanning. This gives WinDirStat an architectural advantage for eligible whole-volume scans; it does not prove it beats DiskVision for a selected project folder or under normal user permissions.

DiskVision's native enumeration and worker isolation are useful implementation choices, but are not unique product features. Likewise, a treemap, dark appearance, Stop, partial results, and generated-file hints are insufficient individually to distinguish the application.

**Windows accounting needs platform-specific scrutiny**

DiskVision's [native scanner](../../native/fast-readdir.cpp) uses `FindFirstFileExW`/`FindNextFileW` and combines the file-length fields from `WIN32_FIND_DATAW`. It does not collect allocation sizes or file IDs. Its [README](../../README.md) correctly labels the result as logical size. Consequently, a large logical file need not occupy that much disk space, and deleting one of several hardlinks need not free the displayed amount.

Three source-level comparisons matter:

- **dua is a strong reference for the next scanner revision.** Its [released Windows backend](https://github.com/Byron/dua-cli/blob/v3.0.0/crates/dua-lib/src/windows.rs) uses `GetFileInformationByHandleEx` with `FileIdBothDirectoryInfo`, returning bounded directory batches with `EndOfFile`, `AllocationSize`, and file IDs. Its [identity filtering](https://github.com/Byron/dua-cli/blob/v3.0.0/src/inodefilter.rs) and [CLI options](https://github.com/Byron/dua-cli/blob/v3.0.0/src/options.rs) expose the corresponding hardlink and apparent-size policies. This is richer directory enumeration, not a direct MFT reader.
- **gdu's general documentation overstates what can be inferred for Windows.** Its README says hardlinks are counted once and offers apparent versus disk usage. However, its [Windows-specific implementation](https://github.com/dundee/gdu/blob/v5.38.0/pkg/analyze/dir_other.go) uses apparent size for usage and returns zero for the inode identifier. It therefore should not be credited with equivalent Windows allocation/hardlink accounting on the strength of the general README. It also applies special OneDrive placeholder handling, so even apparent totals require matching policies before comparison.
- **Filelight already handles some Windows allocation exceptions.** Its [released Windows walker](https://github.com/KDE/filelight/blob/v26.08.2/src/windowsWalker.cpp) calls `GetCompressedFileSizeW` for compressed, sparse, or unpinned files, falling back to logical length. Ordinary files use logical length, and the walker skips reparse points and temporary files. This is not a universal allocated-size or reclaimable-space model, but it addresses cases DiskVision currently only explains.

These differences are why comparing raw byte totals without matching inclusion and accounting rules would be misleading. Even allocated size is not automatically reclaimable space.

**Persistence and developer cleanup are already competitive areas**

The [gdu release documentation](https://github.com/dundee/gdu/blob/v5.38.0/README.md) describes SQLite/BadgerDB-backed analysis and reopening saved data without a scan. Its browser UI includes a table, donut chart, treemap, reveal actions, and deletion. A browser-based visual interface alone is therefore not a differentiator. Database storage is also not evidence of automatic USN journal reconciliation; saved results and a live incremental index are different capabilities.

The [dua release README](https://github.com/Byron/dua-cli/blob/v3.0.0/README.md) documents `dua clean`, covering `node_modules`, Python environments/caches, Cargo build output, and Zig caches. In Git repositories, candidates must be ignored and contain no tracked files, and directories containing `.git` are excluded. That is materially stronger contextual checking than DiskVision's [name/extension heuristic](../../src/renderer/src/lib/safety.ts), though it still cannot establish that a directory is disposable for every user. dua also [exports/imports snapshots and compares two snapshots](https://github.com/Byron/dua-cli/blob/v3.0.0/src/options.rs), so a generic “what grew?” feature would bring parity rather than establish exclusivity.

The [QDirStat 2.0 documentation](https://github.com/shundhammer/qdirstat/blob/2.0/README.md) describes package ownership, file-type statistics, age views, histograms, custom cleanup, allocated-size handling, and cache files that can be generated elsewhere. The applicable lesson for DiskVision is to explain what files belong to and why they exist, beyond presenting their sizes.

**What the existing DiskVision measurements establish**

The recorded [packaged integration result](../../.qa/packaged-smoke-compact-full-c-result.json) from 31 October reports:

| Measure | Recorded result |
|---|---:|
| Files / directories visited | 4,363,504 / 710,960 |
| Logical bytes | 470,688,203,566 |
| Scanner time | 54.315 seconds |
| UI terminal result | 55.841 seconds |
| Read errors / excluded items | 157 / 6,382 |
| Final summary payload | 7,715 bytes |

Traversal finished without a manual or memory-limit stop, but coverage was explicitly **partial** because of errors and exclusions. The [recovery report](2026-10-31-large-scan-crash.md) records per-process peaks across that packaged suite of 797 MiB for the scanner, 95 MiB for the main process, and 162 MiB for the renderer. These are separate peaks, not a simultaneous total, and do not include every Chromium helper. The run was warm-cache on the development machine.

This is useful evidence that the compact index and bounded IPC design can handle millions of entries while preserving navigation. It is not a benchmark against any competitor. The older native-versus-JavaScript ratio compares two DiskVision engines only.

The index still grows with entry count. Its heap guard is a fallback that stops scanning with partial results. The native addon accumulates an entire directory before returning, so one exceptionally wide directory can still exhaust its helper. Pagination limits rendering and IPC, not total index memory.

The existing unpacked app directory measured 287,665,392 bytes, approximately 274.3 MiB, across 73 files during this research. This is an installed-layout measurement, not a compressed download size. Electron's deployment footprint is a tradeoff of the chosen UI stack; competitor download sizes should not be compared directly with that unpacked figure.

**Recommended priorities**

1. **Make accounting trustworthy before claiming space savings.** Add logical and allocated sizes, volume/file identity, a defined hardlink attribution policy, and clear cloud/stream exclusions. Use dua's metadata batching as a concrete engineering reference. Preserve a compatibility fallback and keep reclaimable space distinct.
2. **Finish the inspection workflow.** Add global largest-file search and type/age filters while retaining the current simple list and previews. Validate the intended benefit by measuring how quickly users identify and review a cleanup candidate compared with WinDirStat and Filelight.
3. **Make scans reusable and memory growth manageable.** Stream native entries in bounded chunks and introduce a disk-backed index. Add save/reopen, freshness labels, and visual changes between scans. Consider USN reconciliation after identity, persistence, and invalidation are reliable.
4. **Add optional MFT acceleration if whole-drive latency is the primary problem.** Isolate it in a read-only helper and retain normal traversal for selected folders, unsupported volumes, and unavailable privileges. Allocation-aware enumeration is independently worthwhile and does not require an MFT implementation first.
5. **Use contextual cleanup rules.** For developer directories, check project and Git context, explain why something was suggested, and preserve review and confirmation. Do not describe name-based candidates as proven safe. This would improve parity with dua's cleanup mode.

The most defensible positioning is **a Windows disk explorer that makes large files easy to inspect and cleanup choices easy to understand**. A claim of being the fastest analyzer, having the most accurate storage accounting, or uniquely offering visual/developer cleanup is not supported by the evidence reviewed here.

**A fair follow-up benchmark**

Compare DiskVision 1.0.1, WinDirStat 2.9.3, gdu 5.38.0, dua 3.0.0, and an identified Filelight Windows build on the same machine. Start with an ordinary project folder and a full NTFS volume. Run WinDirStat normal traversal and elevated MFT mode separately, labeling their permissions and coverage. Disable optional content hashing for scan-speed comparisons.

Use generated fixtures for known counts and logical/allocation semantics, including hardlinks, sparse/compressed files, Unicode, wide/deep trees, and inaccessible paths. Add a representative real directory and an exFAT or network target if those are product priorities. Match or document link, hidden-file, cloud, and exclusion policies; explain count differences before interpreting timing.

Record time to first useful result, total traversal/index/UI time, peak memory across the process tree, CPU/I/O, Stop latency, responsiveness after completion, and correctness. Alternate order and repeat warm-cache runs; use a documented separate procedure for cold-cache runs. Measure save/reopen and refresh separately from first scans. Do not compare gdu's aggregate-only mode, which retains less detail, with a fully browsable retained index as if they provided the same result.

**Open-source licensing and reuse**

The checked projects identify WinDirStat as GPL-3.0-or-later, Filelight as GPL-2.0-or-later at the application level, QDirStat as GPL v2, and gdu/dua as MIT. Individual files and dependencies can have additional or alternative terms. The MIT projects are useful starting points for studying or reusing implementation details with the applicable notices preserved; copying GPL application code needs a compatible distribution decision.

No project-level `LICENSE` file or package license field was found in this DiskVision checkout. Before distributing it as open source, choose and publish an explicit license. Repository visibility alone does not establish open-source reuse rights.

Primary source snapshots and GitHub release metadata used for this review are retained locally under `.qa/research-open-source/` (ignored by Git). The versioned links above provide the durable external references; live project pages and wiki content can change.
