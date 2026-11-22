interface EnergyMeterProps {
  energy: number | null
  showValue?: boolean
  size?: 'sm' | 'md'
  className?: string
}

function getEnergyColor(energy: number): string {
  if (energy < 0.35) return '#38bdf8' // chill cyan
  if (energy < 0.65) return '#34d399' // groove emerald
  if (energy < 0.82) return '#facc15' // peak amber
  return '#fb7185' // high-energy coral
}

export function EnergyMeter({
  energy,
  showValue = true,
  size = 'sm',
  className = ''
}: EnergyMeterProps) {
  if (energy === null || !Number.isFinite(energy)) {
    return (
      <div className={`inline-flex items-center gap-1.5 text-slate-500 ${className}`}>
        <div className="flex items-center gap-0.5">
          {[0, 1, 2, 3, 4].map((idx) => (
            <span
              key={idx}
              className={`rounded-sm bg-white/10 ${size === 'md' ? 'h-3 w-1.5' : 'h-2.5 w-1'}`}
            />
          ))}
        </div>
        {showValue && <span className="font-mono text-[11px] tabular-nums">—</span>}
      </div>
    )
  }

  const clamped = Math.max(0, Math.min(1, energy))
  const activeBars = Math.max(1, Math.round(clamped * 5))
  const color = getEnergyColor(clamped)

  return (
    <div
      className={`inline-flex items-center gap-1.5 ${className}`}
      title={`Energy: ${clamped.toFixed(2)}`}
    >
      <div className="flex items-end gap-0.5">
        {[0, 1, 2, 3, 4].map((idx) => {
          const isLit = idx < activeBars
          const barHeight =
            size === 'md'
              ? ['h-1.5', 'h-2', 'h-2.5', 'h-3', 'h-3.5'][idx]
              : ['h-1.5', 'h-2', 'h-2.5', 'h-3', 'h-3'][idx]
          return (
            <span
              key={idx}
              className={`rounded-sm transition-colors ${size === 'md' ? 'w-1.5' : 'w-1'} ${barHeight}`}
              style={{
                backgroundColor: isLit ? color : 'rgba(255, 255, 255, 0.1)'
              }}
            />
          )
        })}
      </div>
      {showValue && (
        <span className="font-mono text-[11px] tabular-nums text-slate-300">
          {clamped.toFixed(2)}
        </span>
      )}
    </div>
  )
}
