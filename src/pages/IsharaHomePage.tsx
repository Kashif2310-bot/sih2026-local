import { useEffect, useRef, type MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { IsharaLogoSequence } from './ishara/IsharaLogoSequence'
import './ishara/isharaHome.css'

/** Existing entry points — this page only links to them, it never re-implements them. */
export const ENTREPRENEUR_ENTRY_PATH = '/scan'
export const ADMIN_ENTRY_PATH = '/admin'

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** In-page jump that moves focus too, without writing a #hash into the router URL. */
function jumpTo(id: string) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById(id)
    if (!target) return
    e.preventDefault()
    target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })
    target.focus({ preventScroll: true })
  }
}

/**
 * The app has no global scroll reset, and this page is several viewports tall,
 * so without this the next route would open scrolled far down.
 */
function resetScrollBeforeLeaving(e: MouseEvent<HTMLAnchorElement>) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
}

/** Ishara cinematic homepage — the front door to the existing Entrepreneur and Admin flows. */
export function IsharaHomePage() {
  const rootRef = useRef<HTMLDivElement>(null)

  // Black page chrome while mounted, so overscroll never flashes the citizen app's light body.
  useEffect(() => {
    const previous = document.body.style.background
    document.body.style.background = '#000000'
    return () => {
      document.body.style.background = previous
    }
  }, [])

  // Scroll-reveal for the content sections (same thresholds as the prototype).
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const targets = root.querySelectorAll<HTMLElement>('.ishara-intro-inner, .ishara-connect-card')
    if (!('IntersectionObserver' in window)) {
      targets.forEach((el) => el.classList.add('in-view'))
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view')
            io.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.3 },
    )
    targets.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  return (
    <div ref={rootRef} className="ishara-home">
      <a className="ishara-skip-link" href="#main" onClick={jumpTo('main')}>
        Skip to content
      </a>

      <header className="ishara-nav">
        <a className="ishara-wordmark" href="#top" onClick={jumpTo('top')}>
          ISHARA
        </a>
        <nav aria-label="Primary">
          <ul>
            <li>
              <a href="#connect" onClick={jumpTo('connect')}>
                Connect / Activity
              </a>
            </li>
          </ul>
        </nav>
      </header>

      <main id="main" tabIndex={-1}>
        <IsharaLogoSequence />

        <section id="intro" className="ishara-intro">
          <div className="ishara-intro-inner">
            <span className="ishara-section-label">What is Ishara?</span>
            <h1 className="ishara-intro-main">
              Ishara helps rural entrepreneurs discover opportunities, understand financing options, and move
              from an idea to action.
            </h1>
            <p className="ishara-intro-sub">
              Discover opportunities, explore financing, and manage your journey — all in one place.
            </p>
          </div>
        </section>

        <section id="connect" className="ishara-connect" tabIndex={-1} aria-labelledby="ishara-connect-label">
          <div className="ishara-connect-inner">
            <span id="ishara-connect-label" className="ishara-section-label">
              Connect / Activity
            </span>
            <div className="ishara-connect-cards">
              <Link className="ishara-connect-card" to={ENTREPRENEUR_ENTRY_PATH} onClick={resetScrollBeforeLeaving}>
                <h2>Entrepreneur</h2>
                <p>Discover opportunities, explore financing, and manage your entrepreneurial journey.</p>
                <span className="ishara-card-arrow" aria-hidden="true">
                  &rarr;
                </span>
              </Link>
              <Link className="ishara-connect-card" to={ADMIN_ENTRY_PATH} onClick={resetScrollBeforeLeaving}>
                <h2>Admin</h2>
                <p>Review applications, manage activities, and oversee the platform.</p>
                <span className="ishara-card-arrow" aria-hidden="true">
                  &rarr;
                </span>
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="ishara-footer">
        <p>&copy; 2026 Ishara. All rights reserved.</p>
      </footer>
    </div>
  )
}
