/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ADMIN_ENTRY_PATH, ENTREPRENEUR_ENTRY_PATH, IsharaHomePage } from './IsharaHomePage'

describe('IsharaHomePage', () => {
  beforeEach(() => {
    // jsdom has no 2D canvas; the hero must degrade to a no-op, not crash.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  function renderHome() {
    return render(
      <MemoryRouter initialEntries={['/']}>
        <IsharaHomePage />
      </MemoryRouter>,
    )
  }

  it('links Entrepreneur to the existing /scan flow and Admin to the existing /admin flow', () => {
    expect(ENTREPRENEUR_ENTRY_PATH).toBe('/scan')
    expect(ADMIN_ENTRY_PATH).toBe('/admin')
    renderHome()
    expect(screen.getByRole('link', { name: /^Entrepreneur/ }).getAttribute('href')).toBe('/scan')
    expect(screen.getByRole('link', { name: /^Admin/ }).getAttribute('href')).toBe('/admin')
  })

  it('renders the tested copy', () => {
    renderHome()
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /Ishara helps rural entrepreneurs discover opportunities, understand financing options, and move from an idea to action\./,
      }),
    ).toBeTruthy()
    expect(
      screen.getByText('Discover opportunities, explore financing, and manage your journey — all in one place.'),
    ).toBeTruthy()
    expect(screen.getByText('What is Ishara?')).toBeTruthy()
  })

  it('renders the hero as a canvas frame sequence, never a video', () => {
    const { container } = renderHome()
    expect(container.querySelector('canvas.ishara-logo-canvas')).not.toBeNull()
    expect(container.querySelector('video')).toBeNull()
    expect(screen.getByRole('progressbar', { name: /loading animation frames/i })).toBeTruthy()
  })

  it('offers keyboard-reachable navigation to the entry cards without scrolling', () => {
    renderHome()
    const connect = screen.getByRole('link', { name: 'Connect / Activity' })
    expect(connect.getAttribute('href')).toBe('#connect')
    expect(document.getElementById('connect')?.getAttribute('tabindex')).toBe('-1')
  })
})
