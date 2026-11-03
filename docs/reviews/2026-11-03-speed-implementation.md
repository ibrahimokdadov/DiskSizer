# Scan pipeline improvement and NTFS prototype

Implemented on `codex/faster-index-and-ntfs`, following the speed research. This is local development work, not a published release or a change to the landing page.

## Production changes

- One SQLite writer consumes up to four concurrent directory readers. The full queue remains on disk; only 64 directory descriptors and one outstanding batch per active reader are retained.
- Inserts batch up to 256 records across directory boundaries. Directory status changes are written together at the end of each queue window, replacing per-directory queue/status round trips.
- Reader completions use a bounded ready queue. A slow reader does not accumulate promise handlers for every batch produced by faster readers.
- Normal Stop retains accepted records, drains outstanding reads, closes cursors, and commits explicit partial/pending states. Database errors still fail and remove the newly created incomplete index.
- File-type lookup and self-database exclusion use precomputed maps/sets.
- Logical-size ordering no longer sorts by a redundant null expression, allowing the existing size index to serve the largest-files page. Allocation sorting preserves unknowns-last behavior.

No changes were made to logical-byte, hardlink attribution, sparse-file, or saved-scan read-only semantics. Insertion order and database page layout can vary with concurrency; path-based hardlink ownership and query ordering remain deterministic.

## Measured before/after

Windows, AMD Ryzen 9 3900X, NTFS C: drive, Node v24.14.0. Target: this checkout's `node_modules`. Each run returned 14,950 files, 1,897 directories, 568,382,218 logical bytes and 592,553,920 allocated bytes, with zero errors, skipped entries, or unknown allocation.

The baseline is the pre-change `master` index pipeline at `1b8eef6c83f6b9bcff56d5d2553ec4f4e27831bb`. Both variants use the same current native metadata reader. Order alternates between rounds to reduce systematic cache advantage.

| Round | Baseline | Updated | Baseline largest-files page | Updated page |
| --- | ---: | ---: | ---: | ---: |
| 1 | 2,046.364 ms | 836.152 ms | 9.430 ms | 3.926 ms |
| 2 | 1,886.184 ms | 847.981 ms | 11.370 ms | 3.820 ms |
| 3 | 1,782.145 ms | 798.107 ms | 8.628 ms | 3.576 ms |
| Median | **1,886.184 ms** | **836.152 ms** | | |

The updated median is **2.26× faster**, or about **56% less elapsed time**, on this workload. Timings include index creation and commit, but exclude Electron startup and rendering. Cache state is uncontrolled. This is not a cold-volume measurement or a comparison with another product.

Baseline databases were 13,295,616 bytes; updated databases ranged from 13,340,672 to 13,373,440 bytes in the alternating comparison. Separate repeated measurements sampled updated JS heap at 11.8–14.5 MiB and process RSS at 126.7–138.9 MiB; baseline heap was 11.6–15.2 MiB and RSS 105.4–120.8 MiB. These process-wide observations are not isolated allocation measurements; the added concurrency is not claimed to reduce memory.

Reproduce: `npx tsx benchmark/compare-storage.ts <stable-folder> <baseline-git-ref> 3`. The baseline must contain the earlier standalone `DiskScanIndex`; this compares that index implementation with the current reader, not an entire historical application build. `npm run benchmark:storage -- <folder> 3 1` measures the updated pipeline with one reader; its default is four, and the supported range is 1–16.

## Scale check

`npx tsx benchmark/storage-synthetic.ts 1000000` generated one million metadata records in 100 child directories. It completed in **26.213 s**, sampled **63.8 MiB peak JS heap / 237.1 MiB process RSS**, and produced a **671,039,488-byte** database. Exact expected counts, logical totals and allocation totals passed.

The global largest-files page took **76.5 ms**. Substring search for `file-999` took **333.4 ms**, returning 1,111 matches. These are individual query observations, not percentiles. Substring search and index size remain optimization targets. Adding a text index would impose ingestion and storage costs that must be measured.

This test generates metadata; it does not measure physical enumeration of one million files. Temporary databases were closed and removed afterward.

## Experimental NTFS work

The native addon now exposes a read-only NTFS capability probe and bounded USN-journal reads. The TypeScript prototype decodes V2/V3 records without truncating identifiers, checks volume/journal continuity, rejects malformed or unsupported records, coalesces updates by identity, retains all affected parents, bounds retained changes, and returns a checkpoint that is valid only after the caller commits the corresponding updates.

The prototype is deliberately not wired into renderer IPC or automatic refresh. It **does not implement metadata reconciliation, checkpoint persistence, folder-growth UI, or direct MFT scanning**. USN events contain no current size; a production reconciler still needs fresh metadata, directory identities in the baseline, move/hardlink handling, summary maintenance, and an atomic index/checkpoint commit. Existing saved scans remain read-only snapshots.

Run `npx tsx benchmark/ntfs-journal.ts 'C:\'` for a capability probe. An optional checkpoint JSON file with `volumeId`, `journalId`, and `nextUsn` enables planning/counting of changes only; no scan is modified. The CLI does not print user filenames.

On this host the native probe returned `available: false`, Win32 error **5 (Access denied)** when opening the volume for read access. Synthetic decoder/planner tests passed; live privileged journal behavior and MFT accounting were not validated. The earlier `fsutil usn queryjournal` command can display journal metadata, but that does not establish raw-volume read permission for this process.

Next gate: run the native prototype in an explicitly elevated test process on a disposable NTFS fixture, test concurrent changes and journal discontinuity, then implement reconciliation. Do not mark a snapshot fresh merely because a change plan was produced. Direct MFT reading requires its own parser/correctness work and an equal-policy comparison; there is no shipped MFT speed claim.

## Verification

- Native addon rebuild and production TypeScript/renderer build pass.
- 50 automated tests pass, including new parallel accounting, cancellation, cursor cleanup, rollback, indexed ordering, USN parsing, continuity, endpoint, and memory-bound cases.
- Electron smoke checks pass: native/SQLite loading, allocation, counts, filters, pagination, map, navigation, preview, compact layout, save/reopen, and snapshot deletion rejection.
- The packaged executable in `dist/speed-preview/win-unpacked/DiskSizer.exe` passes three scan rounds, exact fixture totals, Stop/replacement, UI navigation/filtering, deliberate scanner-process failure and recovery, 30 seconds of responsive idle, and normal exit. Dependency scans reported 846, 779 and 787 ms; those internal scan durations exclude some final transport/commit work and are separate from the end-to-end index benchmark above.
- Large-scale synthetic accounting and alternating real-directory benchmarks pass as described above.

The website and public downloads retain their existing claims. Any future speed claim must state the dataset, version, permissions, accounting rules, and cache conditions.
