# Safe-to-Delete Badge Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show a colored safety badge in the Details panel indicating whether a selected file/folder is safe to delete, a system dependency, or unknown.

**Architecture:** Pure frontend classification via a new `safety.ts` lib file. `classifyNode()` checks the node's path, name, and extension against hardcoded rule lists — no IPC, no disk I/O. Badge rendered as a small pill in `DetailsPanel.tsx`.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Lucide React icons

---

### Task 1: Create `src/renderer/src/lib/safety.ts`

**Files:**
- Create: `src/renderer/src/lib/safety.ts`

**Step 1: Create the file with the classification function**

```ts
import type { FileNode } from '../types/scan'

export type SafetyLevel = 'safe' | 'unsafe' | 'unknown'

const UNSAFE_PATH_PREFIXES = [
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\ProgramData',
  'C:\\System Volume Information',
  'C:\\Recovery',
  'C:\\$Recycle.Bin',
]

const UNSAFE_FILENAMES = new Set([
  'pagefile.sys',
  'hiberfil.sys',
  'swapfile.sys',
  'bootmgr',
  'BOOTNXT',
])

const SAFE_FOLDER_NAMES = new Set([
  'node_modules',
  '__pycache__',
  '.cache',
  'cache',
  'Cache',
  'Temp',
  'temp',
  'tmp',
  'logs',
  '.npm',
  '.yarn',
  '.pnpm-store',
  'dist',
  '.next',
  '.nuxt',
  'coverage',
  '.pytest_cache',
  '__MACOSX',
  '.gradle',
  '.m2',
  'target',
  'build',
  '.DS_Store',
])

const SAFE_EXTENSIONS = new Set([
  'tmp',
  'log',
  'bak',
  'cache',
  'dmp',
  'old',
  'temp',
  'crdownload',
  'part',
])

export function classifyNode(node: FileNode): SafetyLevel {
  const nameLower = node.name.toLowerCase()
  const pathNorm = node.path.replace(/\//g, '\\')

  // Unsafe: known system paths
  for (const prefix of UNSAFE_PATH_PREFIXES) {
    if (pathNorm.toLowerCase().startsWith(prefix.toLowerCase())) {
      return 'unsafe'
    }
  }

  // Unsafe: critical system filenames
  if (UNSAFE_FILENAMES.has(node.name)) return 'unsafe'

  // Safe: known cache/temp folder names
  if (node.type === 'directory' && SAFE_FOLDER_NAMES.has(node.name)) return 'safe'

  // Safe: known throwaway extensions
  if (node.type === 'file' && node.extension && SAFE_EXTENSIONS.has(node.extension.toLowerCase())) {
    return 'safe'
  }

  return 'unknown'
}

export const SAFETY_META: Record<SafetyLevel, { label: string; color: string; bg: string }> = {
  safe:    { label: 'Safe to delete', color: 'text-green-400', bg: 'bg-green-400/10' },
  unsafe:  { label: 'Do not delete',  color: 'text-red-400',   bg: 'bg-red-400/10'   },
  unknown: { label: 'Unknown',         color: 'text-gray-400',  bg: 'bg-gray-400/10'  },
}
```

**Step 2: Commit**

```bash
git add src/renderer/src/lib/safety.ts
git commit -m "feat: add classifyNode safety classification lib"
```

---

### Task 2: Add `SafetyBadge` to `DetailsPanel.tsx`

**Files:**
- Modify: `src/renderer/src/components/panels/DetailsPanel.tsx`

**Step 1: Add imports at the top of `DetailsPanel.tsx`**

Add to the existing imports:
```ts
import { ShieldCheck, ShieldAlert, ShieldQuestion } from 'lucide-react'
import { classifyNode, SAFETY_META } from '../../lib/safety'
```

**Step 2: Add `SafetyBadge` component at the bottom of the file (after `ActionButton`)**

```tsx
function SafetyBadge({ node }: { node: import('../../types/scan').FileNode }) {
  const level = classifyNode(node)
  const { label, color, bg } = SAFETY_META[level]
  const Icon = level === 'safe' ? ShieldCheck : level === 'unsafe' ? ShieldAlert : ShieldQuestion
  return (
    <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium ${color} ${bg}`}>
      <Icon size={11} />
      {label}
    </div>
  )
}
```

**Step 3: Render `SafetyBadge` in the info grid**

Inside `DetailsPanel`, find the header block (the `div` with icon + name + category), and add the badge directly below the category `<p>` tag:

```tsx
<p className="text-xs text-gray-500 capitalize">{category}</p>
<div className="mt-1">
  <SafetyBadge node={selectedNode} />
</div>
```

**Step 4: Verify in dev**

Run `npm run dev` and click any file/folder in the Details panel. Confirm:
- A system path (e.g. `C:\Windows\System32`) shows a red "Do not delete" badge
- A `node_modules` folder shows a green "Safe to delete" badge
- A user document shows a gray "Unknown" badge

**Step 5: Commit**

```bash
git add src/renderer/src/components/panels/DetailsPanel.tsx
git commit -m "feat: show safe-to-delete badge in details panel"
```
