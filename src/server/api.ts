/**
 * What the server (src/server/) and the web app (web/) say to each other.
 * Types only, so the web app can import this file. Data types come from src/types.ts.
 *
 * Endpoints (all JSON unless noted):
 *   GET  /api/health                         → Health
 *   GET  /api/runs                           → RunInfo[] (newest first)
 *   POST /api/runs            StartRunBody   → { runId }   start `npm run match` in the background
 *   GET  /api/runs/:id                       → RunInfo
 *   GET  /api/runs/:id/trace                 → trace.jsonl as NDJSON (one TraceRecord per line)
 *   GET  /api/runs/:id/events                → SSE: `records` (TraceRecord[]), `status` (RunStatus), `end`
 *   GET  /api/runs/:id/results               → RunResults
 *   GET  /api/runs/:id/pairs                 → { pairs, noMatches, approvals }
 *   GET  /api/runs/:id/proposals             → { proposals, verdicts }
 *   GET  /api/runs/:id/proposals/:pid        → { proposal, verdicts }
 *   GET  /api/runs/:id/approvals             → Approvals
 *   POST /api/runs/:id/approvals ApprovalBody → Approvals     writes out/<run>/approvals.json
 *   GET  /api/runs/:id/sources               → Record<id, SourceRecord> for every id the run cites
 *   GET  /api/sources/:id?run=<runId>        → SourceRecord (the run's sources.json first, then the dataset)
 *
 * A static build (`npm run build`) serves the same data as files: `runs/index.json` (RunInfo[]) and
 * `runs/<id>/{trace.jsonl,results.json,sources.json}`. The web app falls back to them when /api is missing.
 */
import type {
	CompanyNeed,
	CriticVerdict,
	FundingMatch,
	NoMatch,
	PairCandidate,
	Proposal,
	ResearcherProfile,
	SourceRecord,
	TraceRecord,
} from "../types"

export type { SourceRecord, TraceRecord }

export interface Health {
	ok: true
	/** True when the dataset is loaded, so /api/sources can answer for ids outside a run's sources.json. */
	dataset: boolean
	/** True when POST /api/runs is available. */
	canStartRuns: boolean
	/** True when a model API key is set, so a run without `mock` can start. */
	hasKeys: boolean
}

/** live: the trace is still growing. ended: summary.json is written. stalled: no summary and no writes for a while. */
export type RunStatus = "live" | "ended" | "stalled"

export interface RunInfo {
	/** The run folder's name, e.g. `2026-10-30T10-52-54-mock` or `golden`. */
	id: string
	status: RunStatus
	mock: boolean
	/** ISO time of the first trace record. */
	startedAt: string | null
	durationMs: number | null
	tokens: number
	costUsd: number
	tasks: { total: number; done: number; failed: number }
	/** Which result files the run folder has. */
	has: { summary: boolean; results: boolean; sources: boolean }
	/** True for the sample run built into the web app (no folder on disk). */
	sample?: boolean
}

export interface StartRunBody {
	mock?: boolean
	companies?: number
}

export type ApprovalDecision = "approved" | "rejected"

/** A person's decision on a pair before any outreach. */
export interface Approval {
	pairId: string
	decision: ApprovalDecision
	note?: string
	/** ISO time. */
	decidedAt: string
}

export type Approvals = Record<string, Approval>

export interface ApprovalBody {
	pairId: string
	/** null clears the decision. */
	decision: ApprovalDecision | null
	note?: string
}

/**
 * Everything the results view needs, in one object.
 * The server reads `out/<run>/results.json` with this shape. Without it, it falls back to
 * `pairs.json`, `proposals.json`, `verdicts.json`, `needs.json`, `profiles.json`, summary.json fields,
 * `proposals/*.md` and `needs-human/*.md`.
 */
export interface RunResults {
	needs: CompanyNeed[]
	profiles: ResearcherProfile[]
	pairs: PairCandidate[]
	/**
	 * Pair ids handed to the Writers, in the order they were chosen. A chosen pair with no proposal and no
	 * held-back draft lost its Writer task (budget, or a failure). Absent when the run did not record it.
	 */
	chosen?: string[]
	noMatches: NoMatch[]
	/** Proposals the Critics accepted. */
	proposals: Proposal[]
	/** Full drafts the Critics did not accept (`needs-human/<id>.md`): a person reads them and decides. */
	needsHuman?: Proposal[]
	verdicts: CriticVerdict[]
	approvals: Approvals
	/** Open EU calls the Funding Scout found per chosen pair. Absent in runs from before the Scout. */
	funding?: FundingMatch[]
}
