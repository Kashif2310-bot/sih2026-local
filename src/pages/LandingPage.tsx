import { motion, MotionConfig } from 'framer-motion'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, MapPinned, ShieldCheck, Sparkles } from 'lucide-react'

export function LandingPage() {
  const { t, i18n } = useTranslation()
  const kn = i18n.language === 'kn'

  return (
    // reducedMotion="user" makes framer-motion honor prefers-reduced-motion by
    // disabling transform/scale animations for those users (opacity still fades).
    <MotionConfig reducedMotion="user">
    <div className="space-y-16">
      <section className="relative overflow-hidden rounded-[2rem] border border-forest/10 bg-forest text-white shadow-xl shadow-forest/20">
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 20%, #1f6b4f 0%, transparent 45%), radial-gradient(circle at 80% 10%, #3d7ea6 0%, transparent 35%), linear-gradient(135deg, transparent 40%, rgba(232,197,71,0.15))',
          }}
        />
        <div className="relative grid gap-10 px-6 py-12 sm:px-10 lg:grid-cols-[1.2fr_0.8fr] lg:py-16">
          <div>
            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-gold"
            >
              MoSJE · SIH26091 · NSFDC
            </motion.p>
            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="font-display text-4xl font-extrabold leading-[1.05] sm:text-5xl lg:text-6xl"
            >
              {t('brand')}
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12 }}
              className="mt-4 max-w-xl text-lg text-white/85 sm:text-xl"
            >
              {t('tagline')}
            </motion.p>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.18 }}
              className="mt-3 max-w-xl text-sm text-white/65 sm:text-base"
            >
              {t('sub')}
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.24 }}
              className="mt-8 flex flex-wrap gap-3"
            >
              <Link
                to="/scan"
                className="inline-flex items-center gap-2 rounded-full bg-gold px-5 py-3 text-sm font-bold text-ink transition hover:brightness-105"
              >
                {t('start')} <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/scan?demo=1"
                className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-5 py-3 text-sm font-semibold text-white backdrop-blur"
              >
                {t('demo')}
              </Link>
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            className="relative min-h-[260px] rounded-3xl border border-white/15 bg-white/10 p-5 backdrop-blur"
          >
            <p className="text-xs uppercase tracking-widest text-gold/90">
              {kn ? 'ಟೆಂಪೋರಲ್ ಅವಕಾಶ ಗ್ರಾಫ್' : 'Temporal Opportunity Graph'}
            </p>
            <div className="mt-4 space-y-3">
              {[
                kn
                  ? 'ಜಾತ್ರೆ +4 ದಿನ — ಸಸ್ಯಾಹಾರಿ ಕಾಂಬೋ ಬೇಡಿಕೆ +55%'
                  : 'Jatra in 4 days — veg combo demand +55%',
                kn
                  ? 'ಮಂಡಿ ಹಾಲು ₹42/ಲೀ — ಪನೀರ್‌ಗೆ ಪರಿವರ್ತಿಸಿ ಮಾರ್ಜಿನ್ +2.1×'
                  : 'Mandi milk ₹42/L — convert to paneer, margin +2.1×',
                kn
                  ? 'ಲೋಕ್‌ಸ್ಕೋರ್ 84 → ಮಲ್ಟಿ-ಸಿಗ್ ಕೋರಂ 2/3'
                  : 'LokScore 84 → multi-sig quorum shrinks to 2/3',
              ].map((line, i) => (
                <div
                  key={line}
                  className="flex items-start gap-3 rounded-2xl bg-forest/50 px-3 py-3 text-sm"
                  style={{ animationDelay: `${i * 0.2}s` }}
                >
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-gold" />
                  {line}
                </div>
              ))}
            </div>
            <div className="pointer-events-none absolute -right-6 -top-6 h-28 w-28 rounded-full border border-gold/30">
              <div className="pulse-ring absolute inset-0 rounded-full border border-gold/50" />
            </div>
          </motion.div>
        </div>
      </section>

      <section>
        <h2 className="font-display text-2xl font-bold text-forest sm:text-3xl">{t('pain.title')}</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {[t('pain.a'), t('pain.b'), t('pain.c')].map((text, i) => (
            <div key={i} className="glass rounded-2xl p-5 shadow-sm">
              <div className="mb-3 grid h-10 w-10 place-items-center rounded-xl bg-mist text-forest">
                {i === 0 ? <ShieldCheck className="h-5 w-5" /> : i === 1 ? <MapPinned className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
              </div>
              <p className="text-sm leading-relaxed text-ink/80">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="glass rounded-[1.75rem] p-6 sm:p-8">
        <h2 className="font-display text-2xl font-bold text-forest">
          {kn ? 'ಇತರ ತಂಡಗಳು vs ಲೋಕ್‌ಪಲ್ಸ್' : 'Generic teams vs LokPulse'}
        </h2>
        <div className="mt-5 overflow-hidden rounded-2xl border border-forest/10">
          <table className="w-full text-left text-sm">
            <thead className="bg-mist/80 text-forest">
              <tr>
                <th className="px-4 py-3 font-semibold">{kn ? 'ಸಾಮಾನ್ಯ' : 'Typical SIH build'}</th>
                <th className="px-4 py-3 font-semibold">{kn ? 'ಲೋಕ್‌ಪಲ್ಸ್' : 'LokPulse'}</th>
              </tr>
            </thead>
            <tbody className="bg-white/60">
              {(kn
                ? [
                    ['AI ಚಾಟ್‌ಬಾಟ್', 'ಟೆಂಪೋರಲ್ ಅವಕಾಶ ಏಜೆಂಟ್ (ಜಾತ್ರೆ×ಹವಾಮಾನ×ಮಂಡಿ)'],
                    ['ಸ್ಥಿರ SWOT', 'ಗ್ರಾಮ-ಮಟ್ಟದ ಲೈವ್ ಪಲ್ಸ್ + ಭೂಪಟ'],
                    ['ಸರಳ ಕ್ಯಾಲ್ಕುಲೇಟರ್', 'NSFDC ನಿಖರ ರೂಟರ್ + ತ್ರೈಮಾಸಿಕ ವೇಳಾಪಟ್ಟಿ'],
                    ['ಯೋಜನೆ ಪಟ್ಟಿ', 'ಅರ್ಹತೆ + ಲೋಕ್‌ಸ್ಕೋರ್ → ಅಡಾಪ್ಟಿವ್ ಮಲ್ಟಿ-ಸಿಗ್'],
                  ]
                : [
                    ['AI chatbot Q&A', 'Temporal opportunity agent (jatra × weather × mandi)'],
                    ['Static SWOT essay', 'Village-level live pulse + map reach'],
                    ['Basic EMI calc', 'Exact NSFDC router + quarterly schedule'],
                    ['Scheme list dump', 'Eligibility + LokScore → adaptive multi-sig'],
                  ]
              ).map(([a, b]) => (
                <tr key={a} className="border-t border-forest/8">
                  <td className="px-4 py-3 text-ink/55">{a}</td>
                  <td className="px-4 py-3 font-medium text-forest">{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="border-t border-forest/10 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-ink/40">{t('brand')}</p>
          <Link
            to="/admin/login"
            className="text-xs font-medium text-ink/45 transition hover:text-forest"
          >
            {t('landing.adminAccess')}
          </Link>
        </div>
      </footer>
    </div>
    </MotionConfig>
  )
}
