import { ChevronRight } from 'lucide-react'
import { useScanStore } from '../../store/scan-store'

export function Breadcrumb() {
  const stack = useScanStore(s => s.navigationStack)
  const navigateTo = useScanStore(s => s.navigateTo)
  return <nav className="breadcrumbs" aria-label="Folder path">{stack.map((node, index) => <span key={node.path}>{index > 0 && <ChevronRight size={12} aria-hidden="true" />}<button title={node.path} aria-current={index === stack.length - 1 ? 'location' : undefined} onClick={() => navigateTo(index)}>{node.name || node.path}</button></span>)}</nav>
}
