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
 *   GET  /api/datasets                       → DatasetInfo[]  the data a run can read: EINSTEIN, the fixture, uploads
 *   POST /api/datasets        multipart      → DatasetInfo    `name` and `files`: your own data, kept in data/uploads/
 *   DELETE /api/datasets/:id                 → 204            uploads only
 *   GET  /api/datasets/:id/companies         → CompanyInfo[]  the companies a run can pick, with their challenges
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
	/** True when a model API key is set, or LOCAL_CLAUDE=1, so a run without `mock` can start. */
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
	/** Why the run stopped before its work ended (a crash, or a signal), from summary.json. Its files then hold partial results. */
	stopped?: string
	/** Which result files the run folder has. */
	has: { summary: boolean; results: boolean; sources: boolean }
	/** True for the sample run built into the web app (no folder on disk). */
	sample?: boolean
	/** A reverse search: the problem a company described, from `problem.json`. Absent for runs on dataset companies. */
	problem?: string
	/** The data the run read, from `dataset.json`, when it was not the EINSTEIN dataset: the fixture or an upload. */
	dataset?: { kind: DatasetKind; name: string }
}

export interface StartRunBody {
	mock?: boolean
	companies?: number
	/** Exactly these companies of the dataset, instead of the first `companies`. */
	ids?: string[]
	/** Reverse search: find researchers for this described problem instead of reading dataset companies. */
	problem?: string
	/** With `problem`: the company's sector, if given. */
	sector?: string
	/** A DatasetInfo id: the data the run reads. Default: the EINSTEIN dataset when it is here, else the fixture. */
	dataset?: string
	/** Researchers shortlisted per challenge. */
	k?: number
	/** Most proposals in the run. */
	proposals?: number
}

/** einstein: data/raw/ (or EINSTEIN_DATA_DIR). fixture: test/fixtures/data. upload: your own files, in data/uploads/. */
export type DatasetKind = "einstein" | "fixture" | "upload"

export interface DatasetCounts {
	researchers: number
	publications: number
	projects: number
	patents: number
	companies: number
	challenges: number
}

export interface DatasetInfo {
	/** `einstein`, `fixture`, or the upload's folder name. */
	id: string
	name: string
	kind: DatasetKind
	counts: DatasetCounts
	/** The data a run reads when it names none. */
	default: boolean
	/** Uploads: ISO time of the upload. */
	createdAt?: string
	/** Uploads: ids that got the dataset's shape, original → new. */
	renamed?: Record<string, string>
	/** Uploads: records skipped and files not used. */
	warnings?: string[]
}

export interface CompanyInfo {
	id: string
	name: string
	sector: string
	challenges: { id: string; text: string }[]
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
