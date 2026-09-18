/** Compact header-nav current-state rules. Do not redesign navigation. */

export function isCitizenNavActive(pathname: string, to: string, apply: boolean): boolean {
  if (apply) return pathname === '/apply' || pathname.startsWith('/apply/')
  if (to === '/') return pathname === '/'
  return pathname === to || pathname.startsWith(`${to}/`)
}
