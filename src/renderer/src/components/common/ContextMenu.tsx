import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

export interface ContextMenuItem {
  id: string
  label: string
  icon?: ReactNode
  disabled?: boolean
  danger?: boolean
  dividerAfter?: boolean
  onClick?: () => void
  children?: ContextMenuItem[]
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })
  const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null)

  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const pad = 10
    const nextLeft = Math.min(x, Math.max(pad, window.innerWidth - rect.width - pad))
    const nextTop = Math.min(y, Math.max(pad, window.innerHeight - rect.height - pad))
    setPosition({ left: nextLeft, top: nextTop })
  }, [x, y, items])

  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return (
    <div
      ref={menuRef}
      style={{ left: position.left, top: position.top }}
      className="fixed z-[100] min-w-[205px] rounded-xl glass-elevated py-1.5 text-xs text-slate-200 shadow-2xl"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => {
        const hasChildren = Boolean(item.children && item.children.length > 0)
        const flipSubmenuLeft = position.left + 410 > window.innerWidth
        return (
          <div
            key={item.id}
            className="relative"
            onMouseEnter={() => setOpenSubmenuId(hasChildren ? item.id : null)}
          >
            <button
              type="button"
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled || hasChildren) return
                item.onClick?.()
                onClose()
              }}
              className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors ${
                item.disabled
                  ? 'cursor-not-allowed text-slate-600'
                  : item.danger
                    ? 'text-rose-400 hover:bg-rose-500/15'
                    : 'text-slate-200 hover:bg-white/10 hover:text-white'
              }`}
            >
              <span className="flex items-center gap-2.5 truncate">
                {item.icon && <span className="h-3.5 w-3.5 shrink-0 opacity-80">{item.icon}</span>}
                <span className="truncate font-medium">{item.label}</span>
              </span>
              {hasChildren && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
            </button>

            {hasChildren && openSubmenuId === item.id && (
              <div
                className={`absolute top-0 z-[101] max-h-64 min-w-[190px] overflow-y-auto rounded-xl glass-elevated py-1.5 shadow-2xl ${
                  flipSubmenuLeft ? 'right-full mr-1' : 'left-full ml-1'
                }`}
              >
                {item.children!.map((sub) => (
                  <button
                    key={sub.id}
                    type="button"
                    disabled={sub.disabled}
                    onClick={() => {
                      if (sub.disabled) return
                      sub.onClick?.()
                      onClose()
                    }}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                      sub.disabled
                        ? 'cursor-not-allowed text-slate-500'
                        : 'text-slate-200 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    {sub.icon && <span className="h-3.5 w-3.5 shrink-0 opacity-80">{sub.icon}</span>}
                    <span className="truncate">{sub.label}</span>
                  </button>
                ))}
              </div>
            )}

            {item.dividerAfter && <div className="my-1 border-t border-white/10" />}
          </div>
        )
      })}
    </div>
  )
}
