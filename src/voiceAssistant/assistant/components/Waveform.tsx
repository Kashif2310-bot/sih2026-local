import { useEffect, useRef } from 'react'

interface WaveformProps {
  variant: 'user' | 'assistant'
  /** Audio activity, 0..1. */
  level: number
  bars?: number
}

const MIN_SCALE = 0.1

export function Waveform({ variant, level, bars = 22 }: WaveformProps) {
  const barRefs = useRef<(HTMLSpanElement | null)[]>([])
  const levelRef = useRef(level)

  useEffect(() => {
    levelRef.current = level
  }, [level])

  useEffect(() => {
    const els = barRefs.current
    const envelope = (i: number) => {
      const x = bars === 1 ? 0.5 : i / (bars - 1)
      const bell = Math.sin(Math.PI * x)
      return variant === 'assistant' ? 0.25 + 0.75 * bell : 0.45 + 0.55 * bell
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      els.forEach((el, i) => {
        if (el) el.style.transform = `scaleY(${MIN_SCALE + 0.35 * envelope(i)})`
      })
      return
    }

    let frame = 0
    let current = 0
    const startedAt = performance.now()
    const speed = variant === 'assistant' ? 1 : 1.35

    const tick = (now: number) => {
      current += (levelRef.current - current) * 0.1
      const t = ((now - startedAt) / 1000) * speed
      els.forEach((el, i) => {
        if (!el) return
        const motion = Math.abs(Math.sin(t * 5.3 + i * 0.83) * 0.6 + Math.sin(t * 2.9 + i * 1.91) * 0.4)
        const scale = MIN_SCALE + (1 - MIN_SCALE) * current * envelope(i) * (0.3 + 0.7 * motion)
        el.style.transform = `scaleY(${scale.toFixed(3)})`
      })
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [bars, variant])

  return (
    <span className={`waveform waveform--${variant}`} aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          className="waveform__bar"
          ref={(el) => {
            barRefs.current[i] = el
          }}
        />
      ))}
    </span>
  )
}
