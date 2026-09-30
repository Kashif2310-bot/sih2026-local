import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { PortraitIcon } from '../components/icons'
import { mouthLayers, stepMouth } from './avatar/mouth'
import type { VoiceState } from './voiceState'

/** Source portrait size and the two mouth patches, in source pixels. Patches share the portrait's geometry exactly. */
const PORTRAIT = {
  base: '/assistant/advisor-base.webp',
  mid: '/assistant/advisor-mouth-mid.webp',
  open: '/assistant/advisor-mouth-open.webp',
  size: 1024,
  patch: { x: 378, y: 396, width: 224, height: 176 },
  crop: { x: 96, y: 24, width: 832, height: 1000 },
}

const pct = (value: number, of: number) => `${(value / of) * 100}%`

const imageStyle: CSSProperties = {
  width: pct(PORTRAIT.size, PORTRAIT.crop.width),
  height: pct(PORTRAIT.size, PORTRAIT.crop.height),
  left: pct(-PORTRAIT.crop.x, PORTRAIT.crop.width),
  top: pct(-PORTRAIT.crop.y, PORTRAIT.crop.height),
}

const patchStyle: CSSProperties = {
  width: pct(PORTRAIT.patch.width, PORTRAIT.crop.width),
  height: pct(PORTRAIT.patch.height, PORTRAIT.crop.height),
  left: pct(PORTRAIT.patch.x - PORTRAIT.crop.x, PORTRAIT.crop.width),
  top: pct(PORTRAIT.patch.y - PORTRAIT.crop.y, PORTRAIT.crop.height),
  opacity: 0,
}

interface AssistantCharacterProps {
  voiceState: VoiceState
  /** Level (0..1) of the assistant audio that is audible right now. Absent means there is no real audio to follow. */
  getOutputLevel?: () => number
}

export function AssistantCharacter({ voiceState, getOutputLevel }: AssistantCharacterProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  const midRef = useRef<HTMLImageElement>(null)
  const openRef = useRef<HTMLImageElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')

  const speaking = voiceState === 'speaking'

  // Layout effect: leaving "speaking" (turn end, barge-in, stop) closes the mouth before the next paint.
  useLayoutEffect(() => {
    const frame = frameRef.current
    const mid = midRef.current
    const open = openRef.current
    if (!frame || !mid || !open) return

    const apply = (openness: number) => {
      const layers = mouthLayers(openness)
      mid.style.opacity = layers.mid.toFixed(3)
      open.style.opacity = layers.open.toFixed(3)
      frame.style.setProperty('--talk', openness.toFixed(3))
      frame.dataset.mouth = openness.toFixed(2)
    }

    apply(0)
    if (!speaking || !getOutputLevel) return

    let openness = 0
    let last = performance.now()
    let raf = requestAnimationFrame(function tick(now) {
      openness = stepMouth(openness, getOutputLevel(), now - last)
      last = now
      apply(openness)
      raf = requestAnimationFrame(tick)
    })
    return () => {
      cancelAnimationFrame(raf)
      apply(0)
    }
  }, [speaking, getOutputLevel])

  const frameStyle = { '--frame-ratio': PORTRAIT.crop.width / PORTRAIT.crop.height } as CSSProperties

  return (
    <div className={`character character--${voiceState}`}>
      {status === 'failed' ? (
        <div className="character__placeholder" role="img" aria-label="Advisor portrait placeholder">
          <PortraitIcon width={28} height={28} />
          <span className="character__placeholder-title">Advisor portrait</span>
          <code>{PORTRAIT.base}</code>
        </div>
      ) : null}

      <div
        ref={frameRef}
        className="character__frame"
        style={frameStyle}
        hidden={status === 'failed'}
        data-audio-driven={getOutputLevel ? 'true' : 'false'}
      >
        <img
          className="character__media"
          src={PORTRAIT.base}
          alt="Ishaara advisor"
          draggable={false}
          onLoad={() => setStatus('ready')}
          onError={() => setStatus('failed')}
          style={imageStyle}
        />
        <img ref={midRef} className="character__media character__mouth" src={PORTRAIT.mid} alt="" draggable={false} style={patchStyle} />
        <img ref={openRef} className="character__media character__mouth" src={PORTRAIT.open} alt="" draggable={false} style={patchStyle} />
      </div>
    </div>
  )
}
