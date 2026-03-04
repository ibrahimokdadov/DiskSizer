# Safe-to-Delete Badge — Design

**Date:** 2026-03-04
**Status:** Approved

## Overview

Add a safety classification badge to the Details panel that tells the user whether a selected file or folder is safe to delete, a system dependency, or unknown.

## Classification Logic

New file: `src/renderer/src/lib/safety.ts`

Pure function: `classifyNode(node: FileNode): 'safe' | 'unsafe' | 'unknown'`

Rules checked in order:

1. **Unsafe** — path is under any of:
   - `C:\Windows`
   - `C:\Program Files`
   - `C:\Program Files (x86)`
   - `C:\ProgramData`
   - `C:\System Volume Information`
   - `C:\Recovery`
   - `C:\$Recycle.Bin`
   - Or filename is one of: `pagefile.sys`, `hiberfil.sys`, `swapfile.sys`

2. **Safe (folders by name)** — folder name matches:
   - `node_modules`, `__pycache__`, `.cache`, `cache`, `Cache`
   - `Temp`, `temp`, `tmp`
   - `logs`, `.npm`, `.yarn`, `dist`, `.next`, `.nuxt`
   - `coverage`, `.pytest_cache`

3. **Safe (files by extension)** — extension is one of:
   - `.tmp`, `.log`, `.bak`, `.cache`, `.dmp`, `.old`, `.temp`

4. **Unknown** — anything not matched above

## UI Change

`DetailsPanel.tsx`: add a `SafetyBadge` component rendered in the info grid below the category line.

| Level   | Icon            | Label            | Color |
|---------|-----------------|------------------|-------|
| safe    | ShieldCheck     | Safe to delete   | Green |
| unsafe  | ShieldAlert     | Do not delete    | Red   |
| unknown | ShieldQuestion  | Unknown          | Gray  |

## Scope

- 1 new file: `src/renderer/src/lib/safety.ts`
- 1 changed file: `src/renderer/src/components/panels/DetailsPanel.tsx`
- No backend changes, no IPC, no new state
