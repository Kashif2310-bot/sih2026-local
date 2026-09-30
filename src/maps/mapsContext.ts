import { createContext, useContext } from 'react'

export type MapsLoadStatus = 'missing_key' | 'loading' | 'ready' | 'error'

export const MapsStatusContext = createContext<{ status: MapsLoadStatus; error?: string }>({
  status: 'missing_key',
})

export function useMapsStatus() {
  return useContext(MapsStatusContext)
}
