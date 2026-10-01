import { APIProvider } from '@vis.gl/react-google-maps'
import { useMemo, useState, type ReactNode } from 'react'
import { MapsStatusContext, type MapsLoadStatus } from './mapsContext'

export function MapsProvider({ children }: { children: ReactNode }) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim()
  const [status, setStatus] = useState<MapsLoadStatus>(apiKey ? 'loading' : 'missing_key')
  const [error, setError] = useState<string>()
  const value = useMemo(() => ({ status, error }), [status, error])

  if (!apiKey) {
    return <MapsStatusContext.Provider value={value}>{children}</MapsStatusContext.Provider>
  }

  return (
    <APIProvider
      apiKey={apiKey}
      region="IN"
      language="en"
      onLoad={() => setStatus('ready')}
      onError={() => {
        setStatus('error')
        setError('Google Maps could not be loaded. Check the key restrictions and enabled APIs.')
      }}
    >
      <MapsStatusContext.Provider value={value}>{children}</MapsStatusContext.Provider>
    </APIProvider>
  )
}
