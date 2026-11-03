# DiskSizer

A Windows disk-space explorer with a largest-first file list, file previews, allocation accounting, and saved scans.

[Website](https://disksizer.whhite.com/) · [Download v1.1.0 for Windows x64](https://github.com/ibrahimokdadov/DiskSizer/releases/tag/v1.1.0) · [Report an issue](https://github.com/ibrahimokdadov/DiskSizer/issues)

## Download

Download the Windows x64 ZIP from the release page, extract the entire archive, and run **DiskSizer.exe**. Windows 10 or 11 is required. This build is unsigned. The release includes a SHA-256 checksum. Source and build instructions are also available below.

DiskSizer was previously named DiskVision internally. Existing application IDs, the user-data directory and the .diskvision saved-scan format remain compatible. No project license has been selected yet; public source availability does not grant an open-source license.

## Use

Choose a drive or folder. Results appear while scanning, and the scan index retains every discovered item. Choose **This folder** or **All scanned files** to find the largest files across the scan. Filter by name, file category, or modification age, sort by logical size or **On disk**, and use the arrow or double-click to open a folder. The list loads one page from the index at a time; the map groups smaller items into an explicit summary without removing them from the list.

Single-click selects an item and opens its inspector. `Enter` opens a focused folder, `Alt+Up` goes to its parent, and `Esc` closes the selection or menu. Stop keeps partial results and clearly identifies unfinished folders. Rescan refreshes the current location.

**File size means logical bytes**. **On disk** shows measured allocation. Folder allocation counts each known file identity once across the scan, attributed to its lexicographically first path; each hardlink still shows its own logical and allocated size. Unknown allocation/identity is counted explicitly and omitted from the known folder total (shown as a lower bound). Neither measure is a guarantee of reclaimable space. Volume capacity/free space is queried separately. Hardlinks, sparse/compressed files, filesystem metadata, cloud content, and inaccessible locations can make these quantities differ. Moving files to the Recycle Bin does not necessarily free drive space immediately.

**Saved scans:** results are saved automatically in the application user-data `scans` directory. Use **Open scan** to browse those dated files, or **Save copy** to choose another location. Reopened scans are dated and read-only; rescan before deleting anything. Previews read the file currently at the saved path. Saved databases consume disk space and are retained until you manage them in Windows.

## Develop

```sh
npm install
npm run build:native
npm run dev
```

The N-API addon builds against pinned Node 20.11.1 headers compatible with the packaged Electron runtime. Packaging includes the N-API SQLite binary without an ABI rebuild. The native build requires Windows C++ Build Tools, a Windows SDK, and Python compatible with node-gyp. A missing or outdated addon automatically selects the standard scanner. No administrator access is required for normal scans; inaccessible locations remain visible as partial coverage.

```sh
npm run typecheck
npm test
npm run build
npm run build:unpack
npm run build:win
```

The build includes TypeScript checking. `build:unpack` creates an unsigned runnable app directory and skips executable resource editing, so local packaging does not require Windows symbolic-link privileges for the signing tools. `build:win` creates an installer using the normal signing/resource-editing pipeline. Packaging explicitly includes and unpacks the native addon.

## Scanner

- The native cursor uses `GetFileInformationByHandleEx` directory batches containing logical length, allocation and file identity. It returns at most 256 entries at a time. Unsupported providers fall back to Win32 enumeration with metadata queries; sparse/compressed files receive targeted allocation queries. The portable reader streams at most 128 entries and reports unknown Windows allocation.
- Native volume discovery returns mount paths, filesystem type, availability, volume identity, and capacity/free space. A timed PowerShell query is a compatibility fallback. Scanner startup no longer depends on an HDD/SSD query.
- A separate Electron utility process owns scanning and the index. A fatal scanner error is reported without terminating the app window. The production queue, file records, sorting and shared-identity index live in SQLite with bounded cache settings. Directory traversal is currently sequential, with bounded asynchronous batches.
- Progress carries a bounded root preview with an explicit aggregate for omitted items. Completion sends a shallow summary; folder pages are fetched on demand. The full tree is never copied into the main process or renderer. Scan IDs isolate old, cancelled, and replacement scans.
- The production helper does not retain the full file tree in JavaScript memory. SQLite stores the authoritative records and returns only the requested page. The legacy tree/compact benchmark APIs remain available for regression comparisons.
- Win32 errors are reported. Unicode, long paths, and ordinary `$` folders are retained. Links/junctions are excluded to avoid loops; unavailable cloud directories are reported instead of deliberately recalled.
- The app distinguishes complete, partial, stopped, pending, skipped, and unreadable states. Unloaded folders cannot be mistaken for empty completed folders.

Completed results persist on disk after the helper exits. Storage grows with the file count; disk-backed indexing trades additional disk space and write time for bounded retained memory. Normal Stop commits partial results; a forced Stop returns a bounded preview and may leave an incomplete database that cannot be reopened. Active database/journal files are excluded from their own scan. Database failures surface as errors. Direct MFT scanning, automatic USN reconciliation, and snapshot comparison remain future milestones.

Local lifecycle/scan diagnostics are stored under the application's user-data `logs` directory. Native crash reports are collected locally with uploading disabled.

## Verification

The regression suite covers full/deep tree retention, Unicode and `$` names, global concurrency, error reporting, cancellation during reads, scan replacement, junction loops, state isolation, navigation, and deletion accounting. It uses temporary fixtures and does not delete user data.

The optional Electron smoke check exercises the real built renderer, preload, worker, native addon, pagination, treemap, navigation, and media protocol against generated files. It writes screenshots under ignored `.qa/` and cleans up its temporary fixtures:

```sh
npm run build
node tests/electron-smoke.cjs
```

The packaged executable has its own integration check, covering repeated scans, UI pagination, Stop, helper-failure recovery, idle responsiveness, and normal exit. Run it after packaging:

```sh
node tests/packaged-smoke.cjs
```

Set `DISKVISION_SMOKE_FAULT=1` to include deliberate scanner-process termination and recovery. The test uses a disposable profile and generated files; an additional real drive/folder scan requires an explicit `DISKVISION_SMOKE_TARGET` value and has time/file-count limits. `DISKVISION_SMOKE_EXPECT_FULL_SCAN=1` requires traversal to finish without a manual or memory-limit stop and checks deep file paths through the actual UI. `DISKVISION_SMOKE_EXPECT_MEMORY_LIMIT=1` is retained only for testing older builds with the in-memory heap guard; it does not apply to the SQLite backend.

Media previews use scoped URLs with renderer sandboxing and web security enabled. Production builds include a content policy; the development server retains its hot-reload support.

## Benchmark

```sh
npm run benchmark:storage -- "C:/path/to/stable/folder" 3
# Legacy logical-only tree scanners:
npm run benchmark -- "C:/path/to/stable/folder" 5
```

The storage benchmark includes metadata collection, SQLite writes and finalization under Node. It samples process RSS/heap and reports database size; it excludes Electron and UI costs. The legacy harness warms both engines, alternates execution order, repeats measurements, and refuses to compare speed when file/byte/error/exclusion counts differ. It includes Unicode filenames and does not suppress unhandled rejections. Timings exclude discovery, IPC, and rendering. Sampled RSS is process-wide, not isolated per-engine memory, and the comparison is not a cold-cache whole-drive benchmark.

The research and original findings are recorded in `docs/reviews/2026-10-31-scan-performance-review.md`. That review describes the pre-change defects and the longer-term MFT/USN design; this README describes the implemented version. The large-scan crash diagnosis and recovery evidence are recorded in `docs/reviews/2026-10-31-large-scan-crash.md`.

Version 1.1.0 implementation status, validation, measured storage/latency tradeoffs and the MFT decision gate are documented in [the adopted priorities](docs/plans/2026-11-03-adopted-priorities.md).
