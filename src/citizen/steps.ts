export interface WizardStepDef {
  path: string
  titleKey: string
}

export const WIZARD_STEPS: WizardStepDef[] = [
  { path: '/apply', titleKey: 'apply.steps.voice' },
  { path: '/apply/profile', titleKey: 'apply.steps.profile' },
  { path: '/apply/conversation', titleKey: 'apply.steps.conversation' },
  { path: '/apply/recommendations', titleKey: 'apply.steps.recommendations' },
  { path: '/apply/business-analysis', titleKey: 'apply.steps.businessAnalysis' },
  { path: '/apply/schemes', titleKey: 'apply.steps.schemes' },
  { path: '/apply/financial-plan', titleKey: 'apply.steps.financialPlan' },
  { path: '/apply/application', titleKey: 'apply.steps.application' },
  { path: '/apply/documents', titleKey: 'apply.steps.documents' },
  { path: '/apply/review', titleKey: 'apply.steps.review' },
  { path: '/apply/consent', titleKey: 'apply.steps.consent' },
  { path: '/apply/submission', titleKey: 'apply.steps.submission' },
  { path: '/apply/tracking', titleKey: 'apply.steps.tracking' },
  { path: '/apply/final-report', titleKey: 'apply.steps.finalReport' },
]

export function stepIndexForPath(pathname: string): number {
  const idx = WIZARD_STEPS.findIndex((s) => s.path === pathname)
  return idx === -1 ? 0 : idx
}
