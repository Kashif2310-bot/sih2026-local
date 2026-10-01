import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Circle,
  CircleMarker,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { VILLAGES } from '../data/villages'
import { inr, skillIcon, type PreparedJob } from '../jobs/model'

type Point = { lat: number; lng: number }
type MoveBody =
  | { kind: 'point'; lat: number; lng: number; zoom: number }
  | { kind: 'bounds'; bounds: L.LatLngBoundsExpression }
type Move = MoveBody & { id: number }

const KNOWN: Record<string, Point> = {
  bengaluru: { lat: 12.9716, lng: 77.5946 },
  bangalore: { lat: 12.9716, lng: 77.5946 },
  mysuru: { lat: 12.2958, lng: 76.6394 },
  mysore: { lat: 12.2958, lng: 76.6394 },
  hubballi: { lat: 15.3647, lng: 75.124 },
  belagavi: { lat: 15.8497, lng: 74.4977 },
  mangaluru: { lat: 12.9141, lng: 74.856 },
  patna: { lat: 25.5941, lng: 85.1376 },
  gaya: { lat: 24.7914, lng: 85.0002 },
  muzaffarpur: { lat: 26.1209, lng: 85.3647 },
  delhi: { lat: 28.6139, lng: 77.209 },
  mumbai: { lat: 19.076, lng: 72.8777 },
  hyderabad: { lat: 17.385, lng: 78.4867 },
  chennai: { lat: 13.0827, lng: 80.2707 },
  pune: { lat: 18.5204, lng: 73.8567 },
}

const CACHE_KEY = 'ishara-geo-cache'

const cityKey = (s: string) => s.trim().toLowerCase()

function loadCache(): Record<string, Point> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function saveCache(cache: Record<string, Point>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    /* storage full or blocked */
  }
}

async function geocode(q: string) {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&q=${encodeURIComponent(q)}`,
  )
  const data: { lat: string; lon: string; boundingbox?: string[] }[] = await res.json()
  return data[0] ?? null
}

function pin(emoji: string, agent: boolean) {
  return L.divIcon({
    className: '',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    html: `<div style="width:40px;height:40px;border-radius:9999px;background:#fff;border:2px ${
      agent ? 'dashed #b91c1c' : 'solid #000'
    };display:flex;align-items:center;justify-content:center;font-size:22px;box-shadow:0 2px 6px rgba(0,0,0,.25)">${emoji}</div>`,
  })
}

function Mover({ move }: { move: Move | null }) {
  const map = useMap()
  useEffect(() => {
    if (!move) return
    if (move.kind === 'bounds') map.flyToBounds(move.bounds, { duration: 2, maxZoom: 12 })
    else map.flyTo([move.lat, move.lng], move.zoom, { duration: 2 })
  }, [move, map])
  return null
}

function ViewTracker({ onView }: { onView: (b: L.LatLngBounds) => void }) {
  const map = useMapEvents({ moveend: () => onView(map.getBounds()) })
  useEffect(() => {
    onView(map.getBounds())
  }, [map, onView])
  return null
}

export function JobsMap({
  kn,
  rows,
  homeVillageId,
  onSelect,
}: {
  kn: boolean
  rows: PreparedJob[]
  homeVillageId: string
  onSelect: (id: string) => void
}) {
  const home = VILLAGES.find((v) => v.id === homeVillageId) ?? VILLAGES[0]
  const [origin, setOrigin] = useState<Point>({ lat: home.lat, lng: home.lng })
  const [move, setMove] = useState<Move | null>(null)
  const [view, setView] = useState<L.LatLngBounds | null>(null)
  const [cityPts, setCityPts] = useState<Record<string, Point>>(() => ({ ...KNOWN, ...loadCache() }))
  const [query, setQuery] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const nextId = useRef(1)

  const go = (body: MoveBody) => setMove({ ...body, id: nextId.current++ })

  useEffect(() => {
    setOrigin({ lat: home.lat, lng: home.lng })
    go({ kind: 'point', lat: home.lat, lng: home.lng, zoom: 10 })
  }, [home.lat, home.lng])

  const missing = useMemo(() => {
    const names = new Set<string>()
    rows.forEach(({ job }) => {
      if (job.workplace === 'city' && job.city.trim() && !cityPts[cityKey(job.city)]) {
        names.add(job.city.trim())
      }
    })
    return [...names]
  }, [rows, cityPts])
  const missingKey = missing.join('|')

  useEffect(() => {
    if (missing.length === 0) return
    let cancelled = false
    ;(async () => {
      for (const name of missing) {
        if (cancelled) return
        try {
          const hit = await geocode(name)
          if (hit && !cancelled) {
            setCityPts((cur) => {
              const next = { ...cur, [cityKey(name)]: { lat: Number(hit.lat), lng: Number(hit.lon) } }
              saveCache(next)
              return next
            })
          }
        } catch {
          /* offline, try again later */
        }
        await new Promise((r) => setTimeout(r, 1100))
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingKey])

  const pins = useMemo(() => {
    const seen: Record<string, number> = {}
    return rows.flatMap((row) => {
      const { job } = row
      const base =
        job.workplace === 'city'
          ? cityPts[cityKey(job.city)]
          : VILLAGES.find((v) => v.id === job.villageId)
      if (!base) return []
      const key = `${base.lat},${base.lng}`
      const n = seen[key] ?? 0
      seen[key] = n + 1
      const angle = n * (Math.PI / 3)
      const push = n === 0 ? 0 : 0.008
      return [
        {
          row,
          p: { lat: base.lat + Math.sin(angle) * push, lng: base.lng + Math.cos(angle) * push },
        },
      ]
    })
  }, [rows, cityPts])

  const visible = view ? pins.filter(({ p }) => view.contains([p.lat, p.lng])).length : 0

  const cityChips = useMemo(() => {
    const m = new Map<string, { name: string; count: number }>()
    rows.forEach(({ job }) => {
      if (job.workplace !== 'city' || !job.city.trim()) return
      const k = cityKey(job.city)
      const cur = m.get(k)
      m.set(k, { name: kn ? job.cityKn || job.city : job.city, count: (cur?.count ?? 0) + 1 })
    })
    return [...m.entries()].map(([key, v]) => ({ key, ...v })).filter((c) => cityPts[c.key])
  }, [rows, kn, cityPts])

  const useMyLocation = () => {
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setMsg(null)
        setOrigin(p)
        go({ kind: 'point', ...p, zoom: 11 })
      },
      () => setMsg(kn ? 'ಸ್ಥಳ ಸಿಗಲಿಲ್ಲ' : 'Could not get your location'),
    )
  }

  const search = async (ev: FormEvent) => {
    ev.preventDefault()
    const q = query.trim()
    if (!q) return
    setBusy(true)
    setMsg(null)
    try {
      const hit = await geocode(q)
      if (!hit) {
        setMsg(kn ? 'ಜಾಗ ಸಿಗಲಿಲ್ಲ' : 'Place not found in India')
        return
      }
      if (hit.boundingbox?.length === 4) {
        const [s, n, w, e] = hit.boundingbox.map(Number)
        go({ kind: 'bounds', bounds: [[s, w], [n, e]] })
      } else {
        go({ kind: 'point', lat: Number(hit.lat), lng: Number(hit.lon), zoom: 10 })
      }
    } catch {
      setMsg(kn ? 'ಹುಡುಕಾಟ ವಿಫಲ' : 'Search failed. Check your internet.')
    } finally {
      setBusy(false)
    }
  }

  const pillBtn = 'rounded-full border border-black/15 px-3 py-1.5 text-xs font-semibold hover:border-black'

  return (
    <section className="mt-4 rounded-[1.5rem] border border-black/10 bg-white p-3 sm:p-4">
      <form onSubmit={search} className="flex flex-wrap gap-2">
        <input
          className="min-w-0 flex-1 rounded-xl border border-black/15 px-3 py-2.5 text-sm"
          placeholder={kn ? 'ರಾಜ್ಯ, ನಗರ ಅಥವಾ ಊರು ಹುಡುಕಿ' : 'Search a state, city or village'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" disabled={busy} className="rounded-full bg-black px-4 py-2 text-sm font-bold text-white">
          {busy ? '…' : kn ? 'ಹುಡುಕಿ' : 'Search'}
        </button>
        <button type="button" onClick={useMyLocation} className="rounded-full border border-black/15 px-4 py-2 text-sm font-semibold">
          📍 {kn ? 'ನನ್ನ ಸ್ಥಳ' : 'My location'}
        </button>
      </form>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={pillBtn}
          onClick={() => go({ kind: 'point', lat: origin.lat, lng: origin.lng, zoom: 10 })}
        >
          {kn ? 'ನನ್ನ ಜಾಗಕ್ಕೆ ಹಿಂತಿರುಗಿ' : 'Back to my place'}
        </button>
        {cityChips.map((c) => (
          <button
            key={c.key}
            type="button"
            className={pillBtn}
            onClick={() => go({ kind: 'point', ...cityPts[c.key], zoom: 11 })}
          >
            {c.name} ({c.count})
          </button>
        ))}
      </div>

      <p className="mt-2 text-xs text-ink/60">
        {msg ??
          (visible > 0
            ? kn
              ? `ಈ ನಕ್ಷೆಯಲ್ಲಿ ${visible} ಕೆಲಸ`
              : `${visible} jobs in this map view`
            : kn
              ? 'ಈ ಭಾಗದಲ್ಲಿ ಕೆಲಸ ಇಲ್ಲ. ನಕ್ಷೆ ಎಳೆಯಿರಿ ಅಥವಾ ಬೇರೆ ಜಾಗ ಹುಡುಕಿ.'
              : 'No jobs in this view. Drag the map, search a place, or tap a city above.')}
      </p>

      <div className="relative isolate mt-2 h-80 overflow-hidden rounded-2xl">
        <MapContainer center={[origin.lat, origin.lng]} zoom={10} minZoom={4} scrollWheelZoom className="h-full w-full">
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Mover move={move} />
          <ViewTracker onView={setView} />
          <Circle
            center={[origin.lat, origin.lng]}
            radius={30000}
            pathOptions={{ color: '#185FA5', weight: 1, fillOpacity: 0.04 }}
          />
          <CircleMarker
            center={[origin.lat, origin.lng]}
            radius={7}
            pathOptions={{ color: '#fff', weight: 2, fillColor: '#185FA5', fillOpacity: 1 }}
          />
          {pins.map(({ row, p }) => (
            <Marker
              key={row.job.id}
              position={[p.lat, p.lng]}
              icon={pin(skillIcon(row.job.skill), row.job.channel === 'agent')}
            >
              <Popup>
                <strong>{kn ? row.job.titleKn : row.job.title}</strong>
                <br />
                {inr(row.pay.inHand)} {kn ? 'ಕೈಯಲ್ಲಿ' : 'in hand'}
                <br />
                <button type="button" className="mt-1 font-bold underline" onClick={() => onSelect(row.job.id)}>
                  {kn ? 'ವಿವರ ನೋಡಿ' : 'See details'}
                </button>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </section>
  )
}