import { camelotToMusicalName, getCamelotColor } from '@shared/camelot'

interface KeyBadgeProps {
  camelotKey: string | null
  musicalKey?: string | null
  showMusicalName?: boolean
  size?: 'xs' | 'sm' | 'md'
  className?: string
}

export function KeyBadge({
  camelotKey,
  musicalKey,
  showMusicalName = false,
  size = 'sm',
  className = ''
}: KeyBadgeProps) {
  if (!camelotKey) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-md border border-white/10 bg-white/[0.03] text-slate-500 font-mono ${
          size === 'xs'
            ? 'px-1.5 py-0.5 text-[10px]'
            : size === 'md'
              ? 'px-2.5 py-1 text-xs'
              : 'px-2 py-0.5 text-[11px]'
        } ${className}`}
        title="Key unknown"
      >
        —
      </span>
    )
  }

  const color = getCamelotColor(camelotKey)
  const resolvedMusical = camelotToMusicalName(camelotKey) || musicalKey || ''
  const sizeClasses =
    size === 'xs'
      ? 'px-1.5 py-0.5 text-[10px] gap-1'
      : size === 'md'
        ? 'px-2.5 py-1 text-xs gap-1.5'
        : 'px-2 py-0.5 text-[11px] gap-1'

  return (
    <span
      className={`inline-flex items-center rounded-md font-mono font-semibold tracking-tight select-none transition-colors ${sizeClasses} ${className}`}
      style={{
        color,
        backgroundColor: `${color}1A`,
        border: `1px solid ${color}4D`
      }}
      title={resolvedMusical ? `${camelotKey} (${resolvedMusical})` : camelotKey}
    >
      <span>{camelotKey}</span>
      {showMusicalName && resolvedMusical && (
        <span className="font-sans font-normal opacity-80">{resolvedMusical}</span>
      )}
    </span>
  )
}
