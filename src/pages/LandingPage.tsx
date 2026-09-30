import { motion, MotionConfig } from 'framer-motion'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, HandCoins, Landmark, MapPinned, PlayCircle, ShieldCheck, Sparkles, Store } from 'lucide-react'
import { BrandLogo } from '../components/BrandLogo'
import { citizenApplyNavPath } from '../apply/resumePath'

export function LandingPage() {
  const { t, i18n } = useTranslation()
  const kn = i18n.language === 'kn'
  const applyHref = citizenApplyNavPath()

  return (
    // reducedMotion="user" makes framer-motion honor prefers-reduced-motion by
    // disabling transform/scale animations for those users (opacity still fades).
    <MotionConfig reducedMotion="user">
    <div className="space-y-16">
      <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-black text-white shadow-2xl shadow-black/40">
        {/* Soft silver light falling from the logo's sparkle, over pure black. */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(ellipse 60% 55% at 22% 18%, rgba(255,255,255,0.09) 0%, transparent 60%), radial-gradient(ellipse 45% 40% at 88% 8%, rgba(255,255,255,0.06) 0%, transparent 60%), linear-gradient(180deg, transparent 55%, rgba(255,255,255,0.03))',
          }}
        />
        <div className="relative grid gap-10 px-6 pt-10 sm:px-10 lg:grid-cols-[1.2fr_0.8fr] lg:pt-14">
          <div>
            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 text-xs font-semibold uppercase tracking-[0.28em] text-white/55 sm:text-sm"
            >
              MoSJE · SIH26091 · NSFDC
            </motion.p>
            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="-ml-2 max-w-[34rem] sm:-ml-3"
            >
              <span className="sr-only">{t('brand')}</span>
              <span className="ishara-sheen block">
                <BrandLogo variant="white" alt="" className="h-auto w-full max-w-full" />
              </span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12 }}
              className="mt-4 max-w-xl text-lg text-white/90 sm:text-xl"
            >
              {t('tagline')}
            </motion.p>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.18 }}
              className="mt-3 max-w-xl text-sm text-white/55 sm:text-base"
            >
              {t('sub')}
            </motion.p>
          </div>

          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            className="relative min-h-[260px] self-center rounded-3xl border border-white/12 bg-white/[0.04] p-5 backdrop-blur"
          >
            <p className="text-xs uppercase tracking-widest text-white/60">
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
                  className="flex items-start gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.05] px-3 py-3 text-sm text-white/85"
                  style={{ animationDelay: `${i * 0.2}s` }}
                >
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-white shadow-[0_0_8px_2px_rgba(255,255,255,0.55)]" />
                  {line}
                </div>
              ))}
            </div>
            <div className="pointer-events-none absolute -right-6 -top-6 h-28 w-28 rounded-full border border-white/15">
              <div className="pulse-ring absolute inset-0 rounded-full border border-white/35" />
            </div>
          </motion.div>
        </div>

        {/* Role entry: the two ways into the prototype. */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.28 }}
          className="relative px-6 pb-10 pt-10 sm:px-10 lg:pb-14"
        >
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.28em] text-white/45">
            {t('roles.choose')}
          </p>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="group relative flex flex-col overflow-hidden rounded-3xl border border-white/15 bg-gradient-to-br from-white/[0.10] to-white/[0.02] p-6 transition hover:border-white/35 sm:p-7">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white text-black">
                  <Store className="h-5 w-5" />
                </span>
                <h2 className="font-display text-2xl font-bold tracking-tight">{t('roles.entrepreneur.title')}</h2>
              </div>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-white/65">{t('roles.entrepreneur.body')}</p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Link
                  to="/scan"
                  className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-bold text-black transition hover:bg-white/85"
                >
                  {t('start')} <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </Link>
                <Link
                  to={applyHref}
                  className="inline-flex items-center gap-2 rounded-full border border-white/25 px-5 py-3 text-sm font-semibold text-white transition hover:border-white/60 hover:bg-white/10"
                >
                  {t('roles.entrepreneur.apply')}
                </Link>
              </div>
              <Link
                to="/scan?demo=1"
                className="mt-4 inline-flex w-fit items-center gap-1.5 text-xs font-semibold text-white/55 underline-offset-4 transition hover:text-white hover:underline"
              >
                <PlayCircle className="h-3.5 w-3.5" /> {t('demo')}
              </Link>
            </div>

            <div className="group relative flex flex-col overflow-hidden rounded-3xl border border-white/15 bg-gradient-to-br from-white/[0.06] to-transparent p-6 transition hover:border-white/35 sm:p-7">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-2xl border border-white/30 text-white">
                  <Landmark className="h-5 w-5" />
                </span>
                <h2 className="font-display text-2xl font-bold tracking-tight">{t('roles.admin.title')}</h2>
              </div>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-white/65">{t('roles.admin.body')}</p>
              <div className="mt-6 flex flex-wrap items-center gap-3 md:mt-auto md:pt-6">
                <Link
                  to="/admin/login"
                  className="inline-flex items-center gap-2 rounded-full border border-white/40 px-5 py-3 text-sm font-bold text-white transition hover:border-white hover:bg-white hover:text-black"
                >
                  {t('roles.admin.cta')} <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </Link>
              </div>
            </div>

            <div className="group relative flex flex-col overflow-hidden rounded-3xl border border-white/15 bg-gradient-to-br from-white/[0.10] to-white/[0.02] p-6 transition hover:border-white/35 sm:p-7">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white text-black">
                  <HandCoins className="h-5 w-5" />
                </span>
                <h2 className="font-display text-2xl font-bold tracking-tight">{t('roles.jobs.title')}</h2>
              </div>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-white/65">{t('roles.jobs.body')}</p>
              <div className="mt-6 flex flex-wrap items-center gap-3 md:mt-auto md:pt-6">
                <Link
                  to="/jobs"
                  className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-bold text-black transition hover:bg-white/85"
                >
                  {t('roles.jobs.cta')} <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </Link>
              </div>
            </div>
          </div>
        </motion.div>
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
          {kn ? 'ಇತರ ತಂಡಗಳು vs ಇಶಾರಾ' : 'Generic teams vs Ishara'}
        </h2>
        <div className="mt-5 overflow-hidden rounded-2xl border border-forest/10">
          <table className="w-full text-left text-sm">
            <thead className="bg-mist/80 text-forest">
              <tr>
                <th className="px-4 py-3 font-semibold">{kn ? 'ಸಾಮಾನ್ಯ' : 'Typical SIH build'}</th>
                <th className="px-4 py-3 font-semibold">{kn ? 'ಇಶಾರಾ' : 'Ishara'}</th>
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
    </div>
    </MotionConfig>
  )
}
