import type { AdvisorView } from './advisor/advisor'

export function LokScoreStatus({ advisor, compact = false }: { advisor: AdvisorView; compact?: boolean }) {
  const state = advisor.feasibility
  let text: string
  switch (state.status) {
    case 'ready':
      text = `${state.report.lokScore.total}/100 · Grade ${state.report.lokScore.grade}`
      break
    case 'computing':
      text = 'Checking local market, weather and repayment…'
      break
    case 'waiting':
      text = `Needs ${state.missing.map((m) => m.label.toLowerCase()).join(', ')}`
      break
    default:
      text = state.reason
  }
  return (
    <p className={`lokscore-status lokscore-status--${state.status} ${compact ? 'is-compact' : ''}`} data-testid="lokscore-status">
      <span className="lokscore-status__label">Ishaara LokScore</span>
      <span className="lokscore-status__value">{text}</span>
    </p>
  )
}
