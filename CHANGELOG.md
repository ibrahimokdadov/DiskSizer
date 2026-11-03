# Changelog

## 1.1.0 — 2026-11-03

DiskSizer now supports inspecting large files with global search, allocation accounting, and saved scans. The app, repository and website use the DiskSizer name; existing DiskVision profiles and saved files remain compatible.

- Search every scanned file by name, category, or modification age, and sort by logical or on-disk size.
- Inspect measured allocation, hardlink attribution, unknown values and supported media previews before cleanup.
- Stream metadata into a SQLite index, with bounded result pages and automatic dated saves. Export a copy or reopen a read-only scan.
- Keep partial results visible, isolate cancelled/replaced scans, and recover from scanner-process failure without closing the app.
- Correct repository/download links and replace historical speed multipliers with scoped measurements and reproducible benchmark instructions.

Validation: 40 automated tests, native build, TypeScript checks, Electron UI smoke checks, and packaged-app scan, cancellation, failure-recovery and idle checks.

Persistent indexing adds disk usage and write time. Saved scans are retained until removed. MFT acceleration, USN updates and snapshot comparison are not included. No competitive speed advantage is claimed. The Windows x64 ZIP build is unsigned; extract the full archive and run DiskSizer.exe.
