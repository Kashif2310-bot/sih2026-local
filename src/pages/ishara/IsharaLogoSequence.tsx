import { useEffect, useRef } from 'react'
import {
  PRELOAD_CONCURRENCY,
  SMOOTHING,
  TOTAL_FRAMES,
  containFit,
  frameUrl,
  nearestLoadedIndex,
  scrollProgress,
} from './frameSequence'

/**
 * Scroll-scrubbed, canvas-rendered Ishara logo animation (192 JPEG frames).
 * Behaviour matches the tested standalone prototype: frame 1 first, then a
 * concurrent preload pool, DPR-aware contain-fit drawing, and RAF smoothing
 * toward the scroll target (instant under prefers-reduced-motion).
 */
export function IsharaLogoSequence() {
  const spacerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const loadBarRef = useRef<HTMLDivElement>(null)
  const loadFillRef = useRef<HTMLDivElement>(null)
  const hintRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const spacer = spacerRef.current
    const canvas = canvasRef.current
    const loadBar = loadBarRef.current
    const loadFill = loadFillRef.current
    const hint = hintRef.current
    if (!spacer || !canvas || !loadBar || !loadFill || !hint) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let disposed = false
    let rafId = 0

    const reduceMotion =
      typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
    let smoothing = reduceMotion?.matches ? 1 : SMOOTHING
    const onMotionChange = (e: MediaQueryListEvent) => {
      smoothing = e.matches ? 1 : SMOOTHING
    }
    reduceMotion?.addEventListener?.('change', onMotionChange)

    /* ---------- Frame store ---------- */
    const images: (HTMLImageElement | null)[] = new Array(TOTAL_FRAMES).fill(null)
    const loaded: boolean[] = new Array(TOTAL_FRAMES).fill(false)
    let settledCount = 0

    const updateLoadProgress = () => {
      const pct = Math.round((settledCount / TOTAL_FRAMES) * 100)
      loadFill.style.width = `${pct}%`
      loadBar.setAttribute('aria-valuenow', String(pct))
      if (settledCount >= TOTAL_FRAMES) loadBar.classList.add('is-complete')
    }

    const loadFrame = (index: number) =>
      new Promise<void>((resolve) => {
        const img = new Image()
        img.onload = () => {
          if (!disposed) {
            images[index] = img
            loaded[index] = true
            settledCount++
            updateLoadProgress()
          }
          resolve()
        }
        img.onerror = () => {
          // Count as settled so preloading can't stall on one bad file.
          if (!disposed) {
            settledCount++
            updateLoadProgress()
          }
          resolve()
        }
        img.src = frameUrl(index)
      })

    const preloadPool = async (startIndex: number) => {
      let cursor = startIndex
      const worker = async () => {
        while (!disposed && cursor < TOTAL_FRAMES) {
          const i = cursor++
          if (!loaded[i]) await loadFrame(i)
        }
      }
      await Promise.all(Array.from({ length: PRELOAD_CONCURRENCY }, worker))
    }

    /* ---------- Draw (contain-fit, DPR aware) ---------- */
    let cssWidth = 0
    let cssHeight = 0
    let lastDrawnIndex = -1
    let targetFrame = 0
    let currentFrame = 0
    let hintVisible = true

    const drawFrame = (targetIndex: number, force: boolean) => {
      const idx = nearestLoadedIndex(loaded, targetIndex)
      if (idx === -1) return
      if (!force && idx === lastDrawnIndex) return
      lastDrawnIndex = idx

      const img = images[idx]
      if (!img) return
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, cssWidth, cssHeight)
      const { x, y, w, h } = containFit(img.width, img.height, cssWidth, cssHeight)
      ctx.drawImage(img, x, y, w, h)
    }

    const resizeCanvas = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      cssWidth = canvas.clientWidth
      cssHeight = canvas.clientHeight
      canvas.width = Math.round(cssWidth * dpr)
      canvas.height = Math.round(cssHeight * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawFrame(Math.round(currentFrame), true)
    }

    /* ---------- Scroll -> progress -> target frame ---------- */
    const onScroll = () => {
      const rect = spacer.getBoundingClientRect()
      const progress = scrollProgress(rect.top, rect.height, window.innerHeight)
      targetFrame = progress * (TOTAL_FRAMES - 1)

      if (hintVisible && progress > 0.015) {
        hint.style.opacity = '0'
        hintVisible = false
      } else if (!hintVisible && progress <= 0.015) {
        hint.style.opacity = '1'
        hintVisible = true
      }
    }

    /* ---------- Animation loop ---------- */
    const tick = () => {
      if (disposed) return
      const delta = targetFrame - currentFrame
      if (Math.abs(delta) < 0.02) {
        currentFrame = targetFrame
      } else {
        currentFrame += delta * smoothing
      }
      drawFrame(Math.round(currentFrame), false)
      rafId = requestAnimationFrame(tick)
    }

    /* ---------- Init ---------- */
    const init = async () => {
      resizeCanvas()
      await loadFrame(0)
      if (disposed) return
      resizeCanvas()

      window.addEventListener('resize', resizeCanvas, { passive: true })
      window.addEventListener('scroll', onScroll, { passive: true })
      onScroll()
      rafId = requestAnimationFrame(tick)
      void preloadPool(1)
    }
    void init()

    return () => {
      disposed = true
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', resizeCanvas)
      window.removeEventListener('scroll', onScroll)
      reduceMotion?.removeEventListener?.('change', onMotionChange)
    }
  }, [])

  return (
    <section id="top" className="ishara-hero" aria-label="Ishara animated logo">
      <div ref={spacerRef} className="ishara-hero-spacer">
        <div className="ishara-hero-sticky">
          <canvas ref={canvasRef} className="ishara-logo-canvas" role="img" aria-label="Ishara" />

          <div
            ref={loadBarRef}
            className="ishara-load-bar"
            role="progressbar"
            aria-label="Loading animation frames"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={0}
          >
            <div ref={loadFillRef} className="ishara-load-bar-fill" />
          </div>

          <div ref={hintRef} className="ishara-scroll-hint" aria-hidden="true">
            <span>Scroll</span>
            <span className="ishara-scroll-hint-line" />
          </div>
        </div>
      </div>
    </section>
  )
}
