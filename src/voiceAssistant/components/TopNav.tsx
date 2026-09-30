import type { VoiceLanguage } from '../assistant/advisor/systemInstruction'

/** The prototype's own pages; the assistant is a separate page, so these are full navigations. */
const LINKS = [
  { label: 'Home', href: '/home' },
  { label: 'Apply', href: '/apply' },
  { label: 'Scan', href: '/scan' },
  { label: 'History', href: '/history' },
  { label: 'Pulse', href: '/pulse' },
  { label: 'Report', href: '/report' },
  { label: 'Finance', href: '/finance' },
  { label: 'Sanction', href: '/sanction' },
  { label: 'Export', href: '/export' },
  // Clearing the hash leaves the review queue without reloading, so the conversation is kept.
  { label: 'Assistant', href: '#' },
]
const ACTIVE = 'Assistant'

interface TopNavProps {
  demo?: boolean
  admin?: boolean
  language: VoiceLanguage
  onLanguageChange: (language: VoiceLanguage) => void
}

export function TopNav({ demo = false, admin = false, language, onLanguageChange }: TopNavProps) {
  const next: VoiceLanguage = language === 'kn' ? 'en' : 'kn'
  return (
    <header className="nav">
      <a className="nav__brand" href="/home" aria-label="Ishaara home">
        <img className="nav__logo" src="/brand/ishara-logo-white.png" alt="Ishara" draggable={false} />
      </a>

      <nav className="nav__links" aria-label="Primary">
        {LINKS.map(({ label, href }) => (
          <a
            key={label}
            href={href}
            className="nav__link"
            aria-current={label === ACTIVE && !admin ? 'page' : undefined}
          >
            {label}
          </a>
        ))}
      </nav>

      <div className="nav__actions">
        {demo && <span className="nav__mode">Demo mode</span>}
        <a className="nav__link" href="/login">
          Log in
        </a>
        <button
          type="button"
          className="nav__lang"
          aria-pressed={language === 'kn'}
          aria-label={language === 'kn' ? 'Voice language: Kannada. Switch to English' : 'Voice language: English. Switch to Kannada'}
          onClick={() => onLanguageChange(next)}
        >
          {language === 'kn' ? 'English' : 'ಕನ್ನಡ'}
        </button>
        <a className="nav__admin" href="#admin" aria-current={admin ? 'page' : undefined}>
          Admin
        </a>
      </div>
    </header>
  )
}
