import clsx from 'clsx'

/**
 * The Ishara wordmark, keyed from the supplied artwork (luminance -> alpha)
 * so it sits on any surface without a visible box. On a dark surface the
 * white rendition reproduces the original metallic shading exactly, since
 * white at alpha = grey level over black is the original pixel.
 *   - 'white' — for dark surfaces (headers, hero).
 *   - 'black' — for light surfaces and print.
 * Callers size it with a height (h-9) or width (w-full) class; the other
 * dimension follows the image's aspect ratio.
 */
const SOURCES = {
  white: '/brand/ishara-logo-white.png',
  black: '/brand/ishara-logo-black.png',
} as const

export function BrandLogo({
  variant = 'white',
  className,
  alt = 'Ishara',
}: {
  variant?: keyof typeof SOURCES
  className?: string
  alt?: string
}) {
  return (
    <img
      src={SOURCES[variant]}
      alt={alt}
      draggable={false}
      className={clsx('block max-w-none select-none', className)}
    />
  )
}
