import type { DocumentKind } from '../../application/documents'
import {
  computeFeasibilityReport,
  feasibilityReadiness,
  type FeasibilityInputs,
  type FeasibilityResult,
  type FeasibilityState,
} from '../../application/feasibility'
import type { ApplicationStore } from '../../application/store'
import { submitToIshaara, type SubmitOutcome, type SubmittedApplication } from '../../application/submission'
import type { DocumentDeclaration } from '../../../apply/types'
import type { ToolCall } from '../live/geminiProtocol'
import {
  chooseApplicationScheme,
  correctField,
  deriveAdvisorView,
  ingestUtterance,
  INITIAL_ADVISOR_STATE,
  setDocumentDeclaration,
  showSchemeDetails,
  type AdvisorState,
  type AdvisorView,
} from './advisor'
import { runAdvisorTool } from './advisorTools'

export type SubmissionState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'submitted'; application: SubmittedApplication }
  | { status: 'failed'; error: string }

export interface AdvisorSessionOptions {
  /** Null disables the feasibility report (the offline demo makes no network calls). */
  computeFeasibility?: ((inputs: FeasibilityInputs) => Promise<FeasibilityResult>) | null
  feasibilityDisabledReason?: string
  /** Null disables submission (the offline demo never writes to the admin store). */
  store: ApplicationStore | null
  submitDisabledReason?: string
  /** Facts arrive a few words at a time while the citizen speaks; the live lookups wait for a pause. */
  feasibilityDebounceMs?: number
}

/**
 * Owns the one advisor state for a runtime (live or demo). Every write path —
 * speech, typed text, Gemini tools, review corrections — goes through here,
 * and the view, the feasibility report and the submission are derived from
 * that single state.
 */
export class AdvisorSession {
  private state: AdvisorState = INITIAL_ADVISOR_STATE
  private feasibility: FeasibilityState
  private view: AdvisorView
  private submission: SubmissionState = { status: 'idle' }
  private lastReportedSchemeId: string | null | undefined = undefined

  private feasibilitySignature: string | null = null
  private feasibilityTimer: ReturnType<typeof setTimeout> | null = null
  private feasibilityRun: Promise<void> | null = null
  private pendingInputs: FeasibilityInputs | null = null
  private disposed = false

  private readonly onChange: () => void
  private readonly options: AdvisorSessionOptions

  constructor(onChange: () => void, options: AdvisorSessionOptions) {
    this.onChange = onChange
    this.options = options
    this.view = deriveAdvisorView(this.state)
    this.feasibility = this.view.feasibility
  }

  getState = () => this.state
  getView = () => this.view
  getSubmission = () => this.submission

  ingest(text: string) {
    this.commit(ingestUtterance(this.state, text).state)
  }

  runTool(call: Pick<ToolCall, 'name' | 'args'>): Record<string, unknown> {
    const { state, outcome } = runAdvisorTool(this.state, call, {
      feasibility: this.feasibility,
      lastReportedSchemeId: this.lastReportedSchemeId,
    })
    this.commit(state)
    if (call.name === 'recordCitizenDetail' || call.name === 'findSchemes' || call.name === 'applyForScheme' || call.name === 'getApplicationReadiness') {
      this.lastReportedSchemeId = this.view.application?.schemeId ?? null
    }
    return outcome
  }

  showSchemeDetails(schemeId: string | null) {
    this.commit(showSchemeDetails(this.state, schemeId))
  }

  chooseApplicationScheme(schemeId: string | null) {
    this.commit(chooseApplicationScheme(this.state, schemeId))
  }

  correctField(key: string, value: string): string | undefined {
    const { state, error } = correctField(this.state, key, value)
    this.commit(state)
    return error
  }

  setDocument(kind: DocumentKind, declaration: DocumentDeclaration) {
    this.commit(setDocumentDeclaration(this.state, kind, declaration))
  }

  clearSubmission() {
    if (this.submission.status === 'idle') return
    this.submission = { status: 'idle' }
    this.onChange()
  }

  async submit(consentAccepted: boolean): Promise<SubmitOutcome> {
    if (!this.options.store) {
      const reason = this.options.submitDisabledReason ?? 'Submission is not available here.'
      this.setSubmission({ status: 'failed', error: reason })
      return { ok: false, reason }
    }
    const form = this.view.application
    const criteria = this.view.criteria
    const match = this.view.applicationMatch
    const scheme = this.view.ranked.find((r) => r.scheme.id === form?.schemeId)?.scheme
    if (!form || !criteria || !match || !scheme) {
      const reason = 'There is no application to submit yet.'
      this.setSubmission({ status: 'failed', error: reason })
      return { ok: false, reason }
    }

    this.setSubmission({ status: 'submitting' })
    await this.settleFeasibility()
    const outcome = await submitToIshaara({
      form,
      criteria,
      feasibility: this.feasibility,
      match: {
        schemeId: match.id,
        matchPercent: match.matchPercent,
        eligibilityStatus: match.status,
        eligibilityScore: match.eligibilityScore,
        rank: match.rank,
        basis: form.basis,
      },
      profile: this.state.profile,
      details: this.state.details,
      implementingMinistry: scheme.ministry,
      consentAccepted,
    })
    if (this.disposed) return outcome
    if (!outcome.ok) {
      this.setSubmission({ status: 'failed', error: outcome.reason })
      return outcome
    }
    try {
      this.options.store.save(outcome.application)
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : 'The application could not be saved.'
      this.setSubmission({ status: 'failed', error: reason })
      return { ok: false, reason }
    }
    this.setSubmission({ status: 'submitted', application: outcome.application })
    return outcome
  }

  reset() {
    this.cancelFeasibility()
    this.state = INITIAL_ADVISOR_STATE
    this.submission = { status: 'idle' }
    this.lastReportedSchemeId = undefined
    this.feasibilitySignature = null
    this.view = deriveAdvisorView(this.state)
    this.feasibility = this.view.feasibility
  }

  dispose() {
    this.disposed = true
    this.cancelFeasibility()
  }

  private setSubmission(submission: SubmissionState) {
    this.submission = submission
    this.onChange()
  }

  private commit(state: AdvisorState) {
    if (state === this.state) return
    this.state = state
    this.refreshFeasibility()
    this.view = deriveAdvisorView(state, this.feasibility)
    this.onChange()
  }

  /** Keeps the feasibility state in step with the inputs: current report, pending lookup, or what is missing. */
  private refreshFeasibility() {
    const readiness = feasibilityReadiness(this.state.profile, this.state.details)
    if (!readiness.ready) {
      this.cancelFeasibility()
      this.feasibilitySignature = null
      this.feasibility = readiness.unsupportedReason
        ? { status: 'unsupported', reason: readiness.unsupportedReason }
        : { status: 'waiting', missing: readiness.missing }
      return
    }
    if (!this.options.computeFeasibility) {
      this.feasibility = { status: 'disabled', reason: this.options.feasibilityDisabledReason ?? 'The feasibility report is not computed here.' }
      return
    }
    const { signature } = readiness.inputs
    if (signature === this.feasibilitySignature) return
    this.cancelFeasibility()
    this.feasibilitySignature = signature
    this.feasibility = { status: 'computing' }
    this.pendingInputs = readiness.inputs
    this.feasibilityTimer = setTimeout(() => this.startFeasibility(), this.options.feasibilityDebounceMs ?? 1200)
  }

  private startFeasibility() {
    this.feasibilityTimer = null
    const inputs = this.pendingInputs
    const compute = this.options.computeFeasibility
    if (!inputs || !compute) return
    this.pendingInputs = null
    const run = compute(inputs)
      .catch((cause): FeasibilityResult => ({ ok: false, reason: cause instanceof Error ? cause.message : 'The feasibility check failed.' }))
      .then((result) => {
        // A newer set of inputs has replaced these; its own lookup decides the report.
        if (this.disposed || inputs.signature !== this.feasibilitySignature) return
        this.feasibility = result.ok ? { status: 'ready', report: result.report } : { status: 'failed', reason: result.reason }
        this.view = deriveAdvisorView(this.state, this.feasibility)
        this.onChange()
      })
      .finally(() => {
        if (this.feasibilityRun === run) this.feasibilityRun = null
      })
    this.feasibilityRun = run
  }

  /** Submission waits for a pending lookup instead of sealing a report that is still being computed. */
  private async settleFeasibility() {
    if (this.feasibilityTimer !== null) {
      clearTimeout(this.feasibilityTimer)
      this.startFeasibility()
    }
    if (this.feasibilityRun) await this.feasibilityRun
  }

  private cancelFeasibility() {
    if (this.feasibilityTimer !== null) clearTimeout(this.feasibilityTimer)
    this.feasibilityTimer = null
    this.pendingInputs = null
  }
}

export const LIVE_FEASIBILITY = (inputs: FeasibilityInputs) => computeFeasibilityReport(inputs)
