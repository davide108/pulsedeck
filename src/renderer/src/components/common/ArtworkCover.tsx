import { useEffect, useState } from 'react'
import { Disc3 } from 'lucide-react'
import { getArtworkUrl } from '@/utils/format'

interface ArtworkCoverProps {
  artworkPath: string | null | undefined
  alt: string
  className?: string
  iconClassName?: string
  roundedClassName?: string
}

export function ArtworkCover({
  artworkPath,
  alt,
  className = 'h-10 w-10',
  iconClassName = 'h-4 w-4',
  roundedClassName = 'rounded-lg'
}: ArtworkCoverProps) {
  const url = getArtworkUrl(artworkPath)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [url])

  if (!url || failed) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center border border-white/10 bg-gradient-to-br from-white/[0.08] to-white/[0.02] text-slate-500 ${roundedClassName} ${className}`}
      >
        <Disc3 className={iconClassName} />
      </div>
    )
  }

  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={`shrink-0 object-cover border border-white/10 bg-surface ${roundedClassName} ${className}`}
    />
  )
}
