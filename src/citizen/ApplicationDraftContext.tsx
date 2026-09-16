import { useCallback, useState, type ReactNode } from 'react'
import type { RankedScheme } from '../assistant/types'
import { buildInitialDocuments } from '../platform/documentRequirements'
import { routeApplication } from '../platform/ministries'
import { createApplication, newApplicationId } from '../platform/store'
import type { Application, ApplicantInfo, DocumentRecord } from '../platform/types'
import { useApp } from '../state/useApp'
import { ApplicationDraftCtx, type DraftState } from './draft-state'
import { EMPTY_EXTRA, type ExtraApplicantInfo } from './draft-types'

export type { ExtraApplicantInfo } from './draft-types'

export function ApplicationDraftProvider({ children }: { children: ReactNode }) {
  const app = useApp()
  const [transcript, setTranscript] = useState('')
  const [extra, setExtra] = useState<ExtraApplicantInfo>(EMPTY_EXTRA)
  const [documents, setDocuments] = useState<DocumentRecord[]>([])
  const [consentGiven, setConsentGiven] = useState(false)
  const [consentAt, setConsentAt] = useState<number | null>(null)
  const [consentName, setConsentName] = useState('')
  const [submittedId, setSubmittedId] = useState<string | null>(null)
  const [rankedSchemes, setRankedSchemes] = useState<RankedScheme[]>([])

  const updateExtra = useCallback((patch: Partial<ExtraApplicantInfo>) => {
    setExtra((e) => ({ ...e, ...patch }))
  }, [])

  const ensureDocuments = useCallback(() => {
    setDocuments((existing) => {
      if (existing.length > 0 || !app.plan) return existing
      return buildInitialDocuments(app.plan.schemeId)
    })
  }, [app.plan])

  const updateDocument = useCallback((id: string, patch: Partial<DocumentRecord>) => {
    setDocuments((docs) => docs.map((d) => (d.id === id ? { ...d, ...patch } : d)))
  }, [])

  const setConsent = useCallback((given: boolean, name: string) => {
    setConsentGiven(given)
    setConsentName(name)
    setConsentAt(given ? Date.now() : null)
  }, [])

  const submit = useCallback((): Application | null => {
    if (!app.profile || !app.plan || !app.score) return null
    const routing = routeApplication({
      category: app.profile.category,
      gender: app.profile.gender,
      community: app.profile.community,
    })
    const applicant: ApplicantInfo = {
      name: app.profile.name,
      age: app.profile.age,
      gender: app.profile.gender,
      community: app.profile.community,
      phone: extra.phone || app.profile.phone || '',
      email: extra.email || undefined,
      address: extra.address,
      villageOrTown: extra.villageOrTown || app.location?.name || '',
      district: extra.district || app.location?.district || '',
      state: extra.state,
      bankAccountNumber: extra.bankAccountNumber,
      bankIfsc: extra.bankIfsc,
      category: app.profile.category,
      businessDescription: extra.businessDescription,
    }
    const id = newApplicationId()
    const now = Date.now()
    const application: Application = {
      id,
      createdAt: now,
      updatedAt: now,
      applicant,
      leadMinistryId: routing.leadMinistryId,
      supportingMinistryIds: routing.supportingMinistryIds,
      schemeId: app.plan.schemeId,
      schemeName: app.plan.schemeName,
      projectCost: app.plan.projectCost,
      loanAmount: app.plan.loanAmount,
      lokScore: app.score.total,
      lokScoreBreakdown: app.score,
      quorumRequired: app.score.quorumRequired,
      quorumPool: app.score.quorumPool,
      mentorRequired: app.score.mentorRequired,
      documents,
      signatures: [],
      status: 'submitted',
      consentGiven,
      consentAt: consentAt ?? undefined,
      auditTrail: [
        {
          id: `evt-${now}`,
          at: now,
          actor: applicant.name,
          action: 'submitted',
          detail: `Application submitted via citizen portal. Routed to ${routing.leadMinistryId}.`,
        },
      ],
    }
    createApplication(application)
    setSubmittedId(id)
    return application
  }, [app.profile, app.plan, app.score, app.location, extra, documents, consentGiven, consentAt])

  const reset = useCallback(() => {
    setTranscript('')
    setExtra(EMPTY_EXTRA)
    setDocuments([])
    setConsentGiven(false)
    setConsentAt(null)
    setConsentName('')
    setSubmittedId(null)
    setRankedSchemes([])
  }, [])

  const value: DraftState = {
    transcript,
    extra,
    documents,
    consentGiven,
    consentAt,
    consentName,
    submittedId,
    rankedSchemes,
    setTranscript,
    updateExtra,
    ensureDocuments,
    updateDocument,
    setConsent,
    setRankedSchemes,
    submit,
    reset,
  }

  return <ApplicationDraftCtx.Provider value={value}>{children}</ApplicationDraftCtx.Provider>
}
