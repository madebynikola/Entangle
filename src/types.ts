/**
 * Shared contracts for every agent, the runtime, the trace and the web app.
 *
 * Working rule: extend these types by adding fields. Never rename or remove a field,
 * because parallel cards build against them.
 */

// ---------------------------------------------------------------------------
// Sources and claims
// ---------------------------------------------------------------------------

/**
 * A dataset id: `R0001`, `C001`, `C001-CH1`, `SYN-PUB-00001`, `SYN-PRJ-0001`, `SYN-PAT-001`.
 * Company pages have no id; cite them as `C001/job/2024-02-05/<title>`.
 * Join on ids only, never on names (see docs/dataset.md, "Name traps").
 */
export type SourceId = string

/** Every factual statement the system makes. A claim with no source is not a fact. */
export interface Claim {
	text: string
	sourceIds: SourceId[]
}

// ---------------------------------------------------------------------------
// Profiles and needs
// ---------------------------------------------------------------------------

export interface ResearcherProfile {
	/** Canonical id. For merged duplicates, the main profile's id. */
	researcherId: string
	/** Shadow profile ids merged into this one (e.g. R0539 for R0139). */
	aliases: string[]
	name: string
	title: string
	faculty: string
	department: string
	/** Skills and topics, each backed by publications, projects or patents. */
	expertise: Claim[]
	/** Industry-facing facts: what they are open to, industry experience, existing ties. */
	industryFit: Claim[]
	/** Availability as a constraint only ("available from autumn 2026"). Never the reason. */
	availability: Claim | null
	/** False for emeritus, departed or on-leave researchers: never propose them as PI or supervisor. */
	canLead: boolean
}

export type ChallengeTriage = "research" | "engineering-service" | "not-research"

/** One company challenge as the Industry Analyst reads it. */
export interface CompanyNeed {
	/** `C001-CH1` */
	challengeId: string
	/** `C001` */
	companyId: string
	companyName: string
	sector: string
	triage: ChallengeTriage
	triageReason: string
	/** English, academic restatement of the challenge. */
	restatement: Claim
	/** Query terms for retrieval, in research vocabulary. */
	searchTerms: string[]
	/** What the company brings: data, lab, production line, money. */
	assets: Claim[]
	constraints: Claim[]
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * A researcher–challenge pair. `fit` measures how well this pair fits this problem.
 * It is never a measure of the person, and it is never compared across challenges.
 */
export interface PairCandidate {
	/** `${challengeId}:${researcherId}` */
	id: string
	challengeId: string
	companyId: string
	researcherId: string
	/** 0..1, fit of the pair to the stated problem. */
	fit: number
	/** Why these two: evidence from both sides. */
	why: Claim[]
	/** The problem they would solve together. */
	problem: Claim
	risks: Claim[]
}

/** The Matchmaker's explicit "no good match" outcome for a challenge. */
export interface NoMatch {
	challengeId: string
	reason: string
}

// ---------------------------------------------------------------------------
// Proposals and review
// ---------------------------------------------------------------------------

export type ProposalKind = "industrial-phd" | "joint-project"

export interface Proposal {
	id: string
	/** PairCandidate.id */
	pairId: string
	kind: ProposalKind
	title: string
	markdown: string
	/** Every factual statement in `markdown`, with its sources, for the Critic. */
	claims: Claim[]
	/** 0 for the first draft, +1 for each rewrite after a Critic verdict. */
	revision: number
}

export interface RejectedClaim {
	claim: Claim
	reason: string
}

export interface CriticVerdict {
	proposalId: string
	/** The Proposal.revision this verdict is about. */
	revision: number
	ok: boolean
	rejected: RejectedClaim[]
}

// ---------------------------------------------------------------------------
// Tasks and budget
// ---------------------------------------------------------------------------

export type AgentRole = "orchestrator" | "profiler" | "analyst" | "matchmaker" | "writer" | "critic"

export type TaskKind = "profile" | "analyze" | "match" | "write" | "critique" | "demo"

export type TaskStatus = "queued" | "running" | "done" | "failed"

/** One unit of work. Each attempt runs as its own Mozaik loop. */
export interface Task {
	/** `${kind}-${n}`, e.g. `profile-12`. */
	id: string
	kind: TaskKind
	/** Mozaik participant id of the agent that runs it. */
	assignee: string
	status: TaskStatus
	attempts: number
	/** The dataset id the task is about: a researcher, challenge, pair or proposal id. */
	subjectId?: string
	/** The model's final answer text (JSON when the task used structured output). */
	output?: string
	error?: string
	/** Epoch ms. */
	createdAt: number
	startedAt?: number
	finishedAt?: number
	tokens: number
	costUsd: number
}

export interface BudgetLimits {
	maxTokens: number
	maxCostUsd: number
	maxWallMs: number
	/** Per task. */
	maxAttempts: number
}

export interface Budget extends BudgetLimits {
	tokensUsed: number
	/** Sum of known costs. Models without a price add tokens but no cost. */
	costUsd: number
	/** Epoch ms. */
	startedAt: number
}

// ---------------------------------------------------------------------------
// Trace
// ---------------------------------------------------------------------------

/** One line of `out/<run-id>/trace.jsonl`: one Mozaik event. */
export interface TraceRecord {
	/** ISO time of the event. */
	t: string
	/** Ms since the run started. */
	ms: number
	runId: string
	/** Mozaik event type: `inference.started`, `model.answer`, `task.completed`, ... */
	kind: string
	/** Mozaik participant id of the producer. */
	agentId: string
	/** Participant name, e.g. `profiler-2`. */
	agent?: string
	loopId?: string
	taskId?: string
	model?: string
	tokens?: { input: number; output: number; total: number }
	/** Null when the model has no known price. */
	costUsd?: number | null
	/** Small, event-specific summary. Never the full model context. */
	data?: unknown
}
