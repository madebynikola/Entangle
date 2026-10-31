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
 * Real published work from OpenAlex, outside the dataset, is cited by its work id: `W4293154696`.
 * Join on ids only, never on names (see docs/dataset.md, "Name traps").
 */
export type SourceId = string

/** Every factual statement the system makes. A claim with no source is not a fact. */
export interface Claim {
	text: string
	sourceIds: SourceId[]
}

/**
 * `work`: a real OpenAlex work, outside the dataset, that links no dataset researcher or company (src/data/openalex.ts).
 * `call`: an open or upcoming EU funding call, cited as `CALL:<topic id>` (src/data/eucalls.ts).
 * `eu-project`: a real EU-funded project from CORDIS, cited as `CORDIS:<project id>` (src/data/cordis.ts).
 */
export type SourceKind = "researcher" | "publication" | "project" | "patent" | "company" | "challenge" | "page" | "work" | "call" | "eu-project"

/** One dataset record as a citable source. Built by src/data/. */
export interface SourceRecord {
	/** Canonical id. A merged duplicate's alias (e.g. R0139) resolves to its main profile (R0539). */
	id: SourceId
	kind: SourceKind
	/** Researcher or company name, or the record's title. */
	title: string
	/** The text a claim can be checked against: abstract, summary, challenge text + detail, page text, profile. */
	text: string
	/** Canonical ids of the dataset researchers linked to the record: authors, participants, inventors, or the researcher. */
	researcherIds: string[]
	/** For a company, challenge or page. */
	companyId?: string
	year?: number
	/** For a record outside the dataset: where to read it, e.g. `https://openalex.org/W4293154696`. */
	url?: string
}

/** Look up any cited id. The Critic checks every `Claim.sourceIds` entry with it. */
export interface SourceStore {
	get(id: SourceId): SourceRecord | undefined
	has(id: SourceId): boolean
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

/**
 * Which Critic check failed. By code: `no-source` (empty sourceIds), `unknown-source` (id not in the SourceStore),
 * `wrong-subject` (the record belongs to another researcher or company), `name-mismatch` (name does not fit the id),
 * `uncited-detail` (a name or number of the claim is not in its records but in another record of the artifact),
 * `misquote` (an original the claim quotes, in quote marks or in brackets after a translated term, is not in its records).
 * By the model: `unsupported` (the source text does not back the claim), `unchecked` (the review gave no answer for it),
 * `free-text` (a sentence of a proposal's free text states a fact that no claim or source gives; `claim.text` quotes it).
 */
export type RejectCheck =
	| "no-source"
	| "unknown-source"
	| "wrong-subject"
	| "name-mismatch"
	| "uncited-detail"
	| "misquote"
	| "unsupported"
	| "unchecked"
	| "free-text"

export interface RejectedClaim {
	claim: Claim
	reason: string
	check?: RejectCheck
	/** For a model check by two reviewers: the names of those that rejected the claim. One name means they disagreed. */
	reviewers?: string[]
}

/** One reviewer's model check in a two-reviewer verdict. Both reviewers get the same claims, each in its own context. */
export interface ReviewerVote {
	/** Participant name: `critic` or `critic-2`. */
	reviewer: string
	model: string
	/** The reviewer's critique task. */
	taskId: string
	/** Claims this reviewer rejected. */
	rejected: number
}

export interface CriticVerdict {
	/** The reviewed artifact's id. For kinds other than "proposal", this is the profile, challenge or pair id. */
	proposalId: string
	/** The Proposal.revision this verdict is about. For other kinds, the review round: 0 first, +1 per send-back. */
	revision: number
	ok: boolean
	rejected: RejectedClaim[]
	/** What was reviewed. Absent means a proposal. */
	kind?: ArtifactKind
	/** The critique task that ran the model check, if one ran. */
	taskId?: string
	/**
	 * What the Critic did with the artifact. `human-review`: two reviewers checked it, the fixes ran out and
	 * it still failed, so it stays on the blackboard for a person to decide.
	 */
	action?: "accept" | "send-back" | "drop" | "human-review"
	/** When two reviewers ran the model check: each one's part. The artifact passes only if both pass. */
	reviewers?: ReviewerVote[]
	/**
	 * Claims the Critic cut out when the fixes ran out, so the rest of a need, profile or pair could pass
	 * (`action` is then `accept`). Without the cut the whole artifact would have been dropped.
	 */
	trimmed?: RejectedClaim[]
}

// ---------------------------------------------------------------------------
// Funding (src/agents/scout)
// ---------------------------------------------------------------------------

/**
 * One open or upcoming EU call from the Funding & Tenders portal (src/data/eucalls.ts).
 * Every field comes from the portal's API, none from a model.
 */
export interface FundingCall {
	/** `CALL:` + the portal's topic identifier, e.g. `CALL:HORIZON-CL4-2027-05-DIGITAL-EMERGING-03`. */
	id: string
	/** The portal's topic identifier. */
	identifier: string
	title: string
	/** Horizon Europe, Digital Europe, ... From the identifier's prefix. */
	programme: string
	/** The call it belongs to, e.g. `HORIZON-CL4-2027-05`, or a cascade call's own name. */
	call?: string
	/** "Research and Innovation Actions", ... */
	action?: string
	/** A cascade call: an EU project that funds third parties with its own open call, e.g. I3FLOAT. */
	openCallBy?: string
	status: "open" | "forthcoming"
	/** The next deadline still ahead, YYYY-MM-DD. */
	deadline: string
	/** When a forthcoming call opens, YYYY-MM-DD. */
	opens?: string
	/** EU contribution per grant in euros, when the portal gives it. */
	grant?: { min?: number; max?: number; expected?: number }
	keywords: string[]
	url: string
}

/** A real EU-funded project from CORDIS. Every field comes from CORDIS; it names organisations, never people. */
export interface EuProject {
	/** `CORDIS:` + the project id, e.g. `CORDIS:101225653`. */
	id: string
	projectId: string
	acronym: string
	title: string
	/** CORDIS's teaser, clipped. */
	summary: string
	status: "ongoing" | "closed"
	/** YYYY-MM-DD */
	start: string
	end: string
	/** Horizon Europe or Horizon 2020. */
	programme: string
	/** The call topic that funded it, e.g. `HORIZON-CL3-2024-CS-01-01`. */
	topic?: string
	coordinator?: { name: string; country: string }
	/** Organisations in the consortium. */
	organisations: number
	/** Organisations from Serbia, by legal name. */
	serbian: string[]
	url: string
}

/** A CORDIS project the Funding Scout shows a pair: work already funded on the same problem, and who did it. */
export interface ProjectFit {
	project: EuProject
	/** The Scout's reasoning: what the project shares with the pair's problem. A judgement, not a claim. */
	reason: string
}

/** A call the Funding Scout points a pair to. */
export interface FundingFit {
	call: FundingCall
	/** The Scout's reasoning: which part of the pair's problem the call's topic covers. A judgement, not a claim. */
	reason: string
	/** What the pair should check on the call page first, e.g. whether the action type suits a two-partner project. */
	check?: string
}

/**
 * The Funding Scout's answer for one chosen pair, keyed by pair id on `MatchState.funding`.
 * Code checks that each call came from the portal's answer and that its deadline is still ahead.
 */
export interface FundingMatch {
	pairId: string
	challengeId: string
	companyId: string
	researcherId: string
	/** Up to 3 calls, the best fit first. Empty when none fits. */
	calls: FundingFit[]
	/** Why no call fits, when `calls` is empty. */
	noneReason?: string
	/** Up to 3 EU-funded projects from CORDIS on the same problem. Absent in runs from before CORDIS. */
	projects?: ProjectFit[]
	/** The search strings sent to the portal. */
	queries: string[]
	/** Calls with a deadline ahead that the Scout read. */
	considered: number
	/** Why the search failed, if it did. */
	error?: string
	/** The Scout's task. */
	taskId?: string
}

// ---------------------------------------------------------------------------
// Review protocol (src/agents/critic)
// ---------------------------------------------------------------------------

/** An artifact the Critic reviews. Each kind lives in its MatchState map: profiles, needs, candidates, proposals. */
export type ArtifactKind = "profile" | "need" | "pair" | "proposal"

/**
 * Payload of `artifact.posted`. A producer sends it (with `postArtifact()`) after it writes or rewrites an
 * artifact on MatchState. The Critic starts its review at once, while the other agents keep working.
 */
export interface ArtifactPosted {
	kind: ArtifactKind
	/** The artifact's key in its map: researcherId, challengeId, pair id or proposal id. */
	id: string
	/** The producer's task that wrote it. */
	taskId?: string
}

/**
 * Payload of `critic.sent_back`. The Critic rejected claims and created a new task for the producer.
 * The producer runs that task, fixes only the rejected claims, writes the artifact again and posts it again.
 */
export interface SentBack {
	/** The new task, assigned to the producer. */
	taskId: string
	kind: ArtifactKind
	id: string
	/** Mozaik participant id of the producer. */
	producerId: string
	/** 1 for the first send-back. After `maxAttempts` send-backs, the next rejection drops the artifact. */
	attempt: number
	maxAttempts: number
	rejected: RejectedClaim[]
}

// ---------------------------------------------------------------------------
// Tasks and budget
// ---------------------------------------------------------------------------

export type AgentRole = "orchestrator" | "profiler" | "analyst" | "matchmaker" | "writer" | "critic" | "scout"

/** `translate`: the Critic's English for the Serbian lines of a record, for the review of the artifact in `subjectId`. */
export type TaskKind = "screen" | "profile" | "analyze" | "match" | "write" | "critique" | "translate" | "demo" | "scout"

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
	/** The model of the latest attempt. */
	model?: string
	inputTokens?: number
	outputTokens?: number
	/** Model calls over all attempts. */
	inferences?: number
	/** Model calls retried after a 429, 5xx or network error, over all attempts. */
	retries?: number
}

/** Payload of `task.completed` (plus `output`) and `task.failed` (plus `error`): what one task cost and took. */
export interface TaskStats {
	taskId: string
	kind: TaskKind
	attempts: number
	model?: string
	/** From the start of the latest attempt to the end. */
	ms: number
	tokens: number
	inputTokens: number
	outputTokens: number
	costUsd: number
	inferences: number
	retries: number
}

/**
 * Payload of the runner's events, one per model call attempt:
 * `inference.dispatched` (the call left the rate limits and went out), `inference.retry`,
 * `inference.failed` (no retry left, or not retryable) and `inference.refused` (not sent: task settled or budget spent).
 * Mozaik's own `inference.started` comes before the rate-limit wait; draw a call's bar from `inference.dispatched`.
 */
export interface InferenceAttempt {
	taskId?: string
	loopId?: string
	model: string
	provider: string
	/** 1 for the first try of a call. */
	attempt: number
	/** dispatched: ms the call waited for rate-limit tokens and a free slot. */
	waitMs?: number
	/** dispatched: calls in flight now, this one included. */
	inFlight?: number
	/** retry, failed: the provider's HTTP status, if it sent one. */
	status?: number
	error?: string
	/** retry: ms until the next attempt. */
	delayMs?: number
	/** refused: why the call was not made. */
	reason?: string
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
	/** Model calls retried in the run. */
	retries?: number
	/** The limit the run passed, once it did (see the `budget.exhausted` event). From then on new tasks are refused. */
	exhausted?: string
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
