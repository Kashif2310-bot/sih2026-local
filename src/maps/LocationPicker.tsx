import { AdvancedMarker, Map, Pin, useMap, useMapsLibrary } from '@vis.gl/react-google-maps'
import { Crosshair, Loader2, MapPin } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useMapsStatus } from './mapsContext'
import type { SelectedLocation } from './types'

const KARNATAKA_CENTER = { lat: 15.3173, lng: 75.7139 }
const KARNATAKA_BOUNDS: google.maps.LatLngBoundsLiteral = {
  north: 18.5,
  south: 11.5,
  east: 78.7,
  west: 74,
}

interface LocationPickerProps {
  value?: SelectedLocation | null
  onLocationSelect: (location: SelectedLocation) => void
}

export function LocationPicker({ value, onLocationSelect }: LocationPickerProps) {
  const { status, error: loadError } = useMapsStatus()

  if (status === 'missing_key') {
    return <p role="alert" className="rounded-xl bg-[#ffece8] px-3 py-2 text-sm text-danger">Google Maps is not configured. Add VITE_GOOGLE_MAPS_API_KEY to .env.local.</p>
  }
  if (status === 'error') {
    return <p role="alert" className="rounded-xl bg-[#ffece8] px-3 py-2 text-sm text-danger">{loadError}</p>
  }
  if (status === 'loading') {
    return <p className="flex items-center gap-2 text-sm text-ink/60"><Loader2 className="h-4 w-4 animate-spin" /> Loading Google Maps…</p>
  }
  return <ReadyLocationPicker value={value} onLocationSelect={onLocationSelect} />
}

function RecenterMap({ position, selected }: { position: google.maps.LatLngLiteral; selected: boolean }) {
  const map = useMap()
  const { lat, lng } = position
  useEffect(() => {
    if (!map) return
    map.panTo({ lat, lng })
    if (selected) map.setZoom(16)
  }, [lat, lng, map, selected])
  return null
}

function ReadyLocationPicker({ value, onLocationSelect }: LocationPickerProps) {
  const places = useMapsLibrary('places')
  const geocoding = useMapsLibrary('geocoding')
  const autocompleteHost = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState(() =>
    value ? { lat: value.latitude, lng: value.longitude } : KARNATAKA_CENTER,
  )
  const [message, setMessage] = useState<string>()
  const [geoBusy, setGeoBusy] = useState(false)

  const markerPosition = value ? { lat: value.latitude, lng: value.longitude } : position

  const selectCoordinates = useCallback(async (lat: number, lng: number) => {
    setPosition({ lat, lng })
    setMessage(undefined)
    if (!geocoding) {
      onLocationSelect({ latitude: lat, longitude: lng, formattedAddress: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, placeId: '' })
      return
    }
    try {
      const response = await new geocoding.Geocoder().geocode({ location: { lat, lng } })
      const hit = response.results[0]
      onLocationSelect({
        latitude: lat,
        longitude: lng,
        formattedAddress: hit?.formatted_address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        placeId: hit?.place_id || '',
      })
    } catch {
      setMessage('The pin moved, but its address could not be resolved. The coordinates are still saved.')
      onLocationSelect({ latitude: lat, longitude: lng, formattedAddress: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, placeId: '' })
    }
  }, [geocoding, onLocationSelect])

  useEffect(() => {
    if (!places || !autocompleteHost.current) return
    const element = new places.PlaceAutocompleteElement({
      includedRegionCodes: ['in'],
      locationBias: KARNATAKA_BOUNDS,
    })
    element.placeholder = 'Search village, town, address, or landmark'
    element.style.width = '100%'
    element.style.colorScheme = 'light'
    const onSelect = async (event: Event) => {
      try {
        const prediction = (event as google.maps.places.PlacePredictionSelectEvent).placePrediction
        const place = prediction.toPlace()
        await place.fetchFields({ fields: ['id', 'formattedAddress', 'location'] })
        if (!place.location) {
          setMessage('That result has no map coordinates. Try another nearby place.')
          return
        }
        const latitude = place.location.lat()
        const longitude = place.location.lng()
        setPosition({ lat: latitude, lng: longitude })
        setMessage(undefined)
        onLocationSelect({
          latitude,
          longitude,
          formattedAddress: place.formattedAddress || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
          placeId: place.id,
        })
      } catch {
        setMessage('That place could not be loaded. Try a different search result.')
      }
    }
    element.addEventListener('gmp-select', onSelect)
    autocompleteHost.current.replaceChildren(element)
    return () => element.removeEventListener('gmp-select', onSelect)
  }, [places, onLocationSelect])

  const useCurrentLocation = () => {
    setMessage(undefined)
    if (!navigator.geolocation) {
      setMessage('This browser does not support location access. Search for your village instead.')
      return
    }
    setGeoBusy(true)
    navigator.geolocation.getCurrentPosition(
      (current) => {
        void selectCoordinates(current.coords.latitude, current.coords.longitude).finally(() => setGeoBusy(false))
      },
      (geoError) => {
        setGeoBusy(false)
        setMessage(
          geoError.code === geoError.PERMISSION_DENIED
            ? 'Location permission was denied. You can still search and drag the pin.'
            : 'Your current location could not be detected. Search for your village instead.',
        )
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    )
  }

  return (
    <div className="space-y-3">
      <div ref={autocompleteHost} className="min-h-12 rounded-xl border border-forest/15 bg-white p-1" />
      <button
        type="button"
        onClick={useCurrentLocation}
        disabled={geoBusy}
        className="inline-flex items-center gap-2 rounded-full border border-forest/20 bg-white px-3 py-1.5 text-xs font-semibold text-forest disabled:opacity-60"
      >
        {geoBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crosshair className="h-3.5 w-3.5" />}
        Use my current location
      </button>
      <div className="h-80 overflow-hidden rounded-xl border border-forest/10">
        <Map
          mapId="DEMO_MAP_ID"
          defaultCenter={KARNATAKA_CENTER}
          defaultZoom={7}
          gestureHandling="greedy"
          disableDefaultUI={false}
        >
          <RecenterMap position={markerPosition} selected={Boolean(value)} />
          <AdvancedMarker
            position={markerPosition}
            draggable
            title="Drag to confirm the exact location"
            onDragEnd={(event) => {
              const next = event.latLng
              if (next) void selectCoordinates(next.lat(), next.lng())
            }}
          >
            <Pin background="#174c3c" borderColor="#ffffff" glyphColor="#ffffff" />
          </AdvancedMarker>
        </Map>
      </div>
      <p className="flex items-start gap-2 text-xs text-ink/60">
        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {value ? value.formattedAddress : 'Search for a place, use GPS, then drag the pin to the exact point.'}
      </p>
      {message && <p role="alert" className="text-sm text-clay">{message}</p>}
    </div>
  )
}
