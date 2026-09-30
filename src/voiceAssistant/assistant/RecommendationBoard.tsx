import { useState, type CSSProperties } from 'react'
import type { AdvisorView, SchemeMatch } from './advisor/advisor'
import { STATUS_LABEL } from './advisor/format'

interface RecommendationBoardProps {
  advisor: AdvisorView
  analyzing: boolean
  onSelect: (schemeId: string) => void
}

function whyLine(match: SchemeMatch): string | undefined {
  if (match.status === 'likely_ineligible') return match.mismatchReasons[0]
  if (match.status === 'insufficient_data') return match.missingInfo[0] ?? match.reasons[0]
  return match.reasons[0] ?? match.missingInfo[0]
}

interface RankTracking {
  revision: number
  ranks: Map<string, number>
  movement: Map<string, number>
}

const rankMap = (advisor: AdvisorView) => new Map(advisor.matches.map((m) => [m.id, m.rank]))

/** Rank movement caused by the latest advisor revision, so a re-ordering is visible rather than silent. */
function useRankMovement(advisor: AdvisorView): Map<string, number> {
  const [tracked, setTracked] = useState<RankTracking>(() => ({
    revision: advisor.revision,
    ranks: rankMap(advisor),
    movement: new Map(),
  }))
  if (tracked.revision === advisor.revision) return tracked.movement

  const movement = new Map<string, number>()
  for (const match of advisor.matches) {
    const before = tracked.ranks.get(match.id)
    if (before !== undefined && before !== match.rank) movement.set(match.id, before - match.rank)
  }
  setTracked({ revision: advisor.revision, ranks: rankMap(advisor), movement })
  return movement
}

export function RecommendationBoard({ advisor, analyzing, onSelect }: RecommendationBoardProps) {
  const movement = useRankMovement(advisor)
  const plausible = advisor.matches.filter((m) => m.status !== 'likely_ineligible')
  const ruledOut = advisor.matches.filter((m) => m.status === 'likely_ineligible')
  const empty = advisor.matches.length === 0

  return (
    <section className="board board--recs" aria-labelledby="recs-title">
      <span className="board__pin board__pin--left" aria-hidden="true" />
      <span className="board__pin board__pin--right" aria-hidden="true" />

      <header className="board__header">
        <h2 id="recs-title" className="board__eyebrow">
          Matching schemes
        </h2>
        <p className="board__headline">
          {empty
            ? analyzing
              ? 'Listening for details…'
              : 'No matches yet'
            : advisor.top
              ? `Best match: ${advisor.top.shortName}`
              : 'No scheme fits yet'}
        </p>
      </header>

      {empty ? (
        <p className="recs__empty">Matches appear as soon as you share one detail, and re-rank with every new one.</p>
      ) : (
        <ol className="recs" aria-live="polite" data-testid="scheme-list">
          {plausible.map((match, index) => {
            const moved = movement.get(match.id) ?? 0
            const isTop = match.id === advisor.top?.id
            return (
              <li key={match.id} className="recs__item" style={{ '--i': index } as CSSProperties} data-scheme={match.id}>
                <button
                  type="button"
                  className={`rec ${isTop ? 'rec--best' : 'rec--relevant'} ${match.id === (advisor.detailSchemeId ?? advisor.application?.schemeId) ? 'is-highlighted' : ''}`}
                  onClick={() => onSelect(match.id)}
                  aria-label={`${match.name}: ${match.matchPercent} percent match, ${STATUS_LABEL[match.status]}${match.id === advisor.application?.schemeId ? ', application in progress' : ''}${advisor.forms[match.id] ? `, form ${advisor.forms[match.id].readiness.percent} percent filled` : ''}. Show details and form.`}
                >
                  <span className="rec__top">
                    <span className="rec__name">
                      <span className="rec__rank">{match.rank}</span>
                      {match.shortName}
                    </span>
                    <span className="rec__pct" data-testid="match-percent">
                      {match.matchPercent}%
                    </span>
                  </span>
                  <span className="rec__bar" aria-hidden="true">
                    <span style={{ transform: `scaleX(${match.matchPercent / 100})` }} />
                  </span>
                  <span className="rec__bottom">
                    <span className={`rec__status rec__status--${match.status}`}>
                      <i aria-hidden="true" />
                      {isTop ? 'Top match · ' : ''}
                      {STATUS_LABEL[match.status]}
                    </span>
                    {match.id === advisor.application?.schemeId && <span className="rec__applying">Applying</span>}
                    {moved !== 0 && (
                      <span key={`${advisor.revision}`} className={`rec__move ${moved > 0 ? 'is-up' : 'is-down'}`}>
                        {moved > 0 ? `▲ ${moved}` : `▼ ${-moved}`}
                      </span>
                    )}
                  </span>
                  {whyLine(match) && <span className="rec__summary">{whyLine(match)}</span>}
                  {advisor.forms[match.id] && (
                    <span className="rec__form" data-testid="scheme-form-progress">
                      <span className="rec__form-bar" aria-hidden="true">
                        <span style={{ transform: `scaleX(${advisor.forms[match.id].readiness.percent / 100})` }} />
                      </span>
                      Form {advisor.forms[match.id].readiness.percent}% filled
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ol>
      )}

      {ruledOut.length > 0 && (
        <details className="recs__ruled-out">
          <summary>
            {ruledOut.length} not eligible on current details
          </summary>
          <ul>
            {ruledOut.map((match) => (
              <li key={match.id}>
                <strong>{match.shortName}</strong> — {whyLine(match)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
