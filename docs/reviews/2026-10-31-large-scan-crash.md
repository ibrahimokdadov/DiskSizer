Historical review: this records the implementation at the time of the review, under the former DiskVision name. For current behavior and performance limits, see [the 1.1.0 roadmap](../plans/2026-11-03-adopted-priorities.md).

# Large C: scan crash and recovery

## Captured failure

The diagnostic build closed after a C: scan on 2026-10-31. Its last progress record reported 4,356,331 files and 709,430 directories; the worker's used heap was approximately 3.1 GiB. The local Crashpad dump identifies the same main process and Electron 28.3.3.

The dump records Chromium's `0xE0000008` out-of-memory exception with a failed allocation of 2,164,260,800 bytes, just over 2 GiB. Local AMD64 stack unwinding reaches `v8::ValueSerializer::WriteValue` on a Node worker thread. This identifies serialization of the large result as the immediate failure. It does not establish that physical RAM was exhausted, or that native directory enumeration caused the crash. No dump was uploaded.

Chromium can reject a single large allocation even when physical memory is available. See its [OOM documentation](https://chromium.googlesource.com/chromium/src/+/main/docs/memory/oom.md) and the [matching Chromium 120 exception implementation](https://raw.githubusercontent.com/chromium/chromium/120.0.6099.291/base/allocator/partition_allocator/src/partition_alloc/oom.cc).

## Recovery design

- The scanner and retained index run in a separate Electron utility process. A helper failure becomes an actionable UI error; it does not terminate the app.
- Completion sends only a shallow result summary. Directory entries cross IPC in bounded pages; progress uses a bounded preview. The complete tree is never serialized into the main process or renderer.
- The production helper retains compact file records. Only directories keep full paths; file paths, extensions, and default status fields are reconstructed for requested pages. Ancestor links are stored only for directories. The public benchmark API still returns full records.
- A conservative heap guard preserves clearly labeled partial results before the scanner approaches its runtime heap limit. This remains a fallback for workloads larger than the in-memory index can hold.
- Directory pages validate active scan identity and index membership. A replacement scan invalidates the old helper and outstanding requests.

## Verification evidence

Before compact storage was added, the packaged recovery build automatically stopped at its production memory limit after discovering 2,318,092 files on C:. It returned an indexed, browsable partial result without a manual Stop. Main-process memory peaked at 95 MiB, renderer memory at 166 MiB, and the separate scanner at 1,778 MiB. The app remained responsive for 30 seconds after completion and exited normally with code zero.

The final compact build, version 1.0.1 at `dist/win-unpacked/DiskVision.exe`, traversed C: without a manual Stop or memory-limit stop: 4,363,504 files, 710,960 directories, and 470,688,203,566 logical bytes. Scanner time was 54.315 seconds; the UI displayed the terminal result after 55.84 seconds. Its partial status correctly reflected 157 read errors and 6,382 excluded items. The terminal JSON payload was only 7,715 UTF-8 bytes. Four-level UI navigation and 77 reconstructed file paths passed. This is an observed run on the development machine with caches already warm, not a general speed guarantee.

Across this packaged suite, memory peaked at 95 MiB for the main process, 162 MiB for the renderer, and 797 MiB for the scanner. Deliberate helper-failure recovery, a successful replacement scan, forced main-process garbage collection, 30 seconds of responsive idle, and normal exit code zero also passed. The final report is `.qa/packaged-smoke-compact-full-c-result.json`.

Additional packaged checks cover repeated scans, exact generated-fixture totals, directory paging, filtering, sorting, nested navigation, cancellation, replacement scans, and deliberate termination of only the scanner helper followed by a successful new scan. Generated fixtures and disposable profiles are removed only after the test process exits. Reports remain under ignored `.qa/`.

An offline comparison on Electron 28.3.3 used 500,000 files, 83,463 directories, and a representative 217-character file path. After garbage collection, the retained index used 384.7 MiB above baseline with full records and 112.1 MiB with compact records, a 70.9% reduction. Counts, bytes, previews, reconstructed paths and metadata, membership validation, and deletion accounting matched. These are synthetic memory measurements, not a cold-cache disk benchmark.

The 31 automated regression cases and the production TypeScript/Vite build pass. Both full and compact modes exercise cancellation and the same heap-budget guard.

## Remaining limits

The index is still held in memory. Native enumeration materializes one folder's entries before returning to the heap guard, so an exceptionally large single folder can still exhaust its helper. Helper isolation contains this failure and permits another scan. Persistent disk-backed indexing and streaming/chunked enumeration are future work; the current version does not claim unlimited scan size.
