import {
	Agent,
	SemanticEvent,
	SituationSpecification,
	createAgent,
	type SituationContext,
} from "@mozaik-ai/core"
import {
	MockInferenceRunner,
	SnapRunner,
	createTask,
	innerOf,
	join,
	providerOf,
	providersWithKeys,
	resolveRuntime,
	runTask,
	sendEvent,
	state,
	subq,
	subqSettings,
	whenSettled,
	type Decider,
	type MockResponder,
} from "../../runtime"
import type {
	ArtifactKind,
	ArtifactPosted,
	Claim,
	CriticVerdict,
	Proposal,
	RejectedClaim,
	ReviewerVote,
	SentBack,
	SourceRecord,
	SourceStore,
} from "../../types"
import { ROUTES } from "../../../config/models"
import { checkByCode, claimsOf, freeTextOf, maskedText, readArtifact, removeArtifact, type Artifact } from "./checks"
import { lexicalReview, strictReview } from "./mock"
import {
	CRITIC_INSTRUCTION,
	REVIEW_SCHEMA,
	TEXT_REVIEW_SCHEMA,
	parseReview,
	parseTextReview,
	reviewDecision,
	reviewMessage,
	textReviewMessage,
	type ReviewCheck,
} from "./prompt"
import {
	ARTIFACT_POSTED,
	CRITIC_DROPPED,
	CRITIC_ERROR,
	CRITIC_ESCALATED,
	CRITIC_REVIEWING,
	CRITIC_SENT_BACK,
	CRITIC_SPLIT,
	CRITIC_STALE,
	CRITIC_VERDICT,
	PRODUCER_TASK,
} from "./protocol"
import { clip } from "./text"

export interface CriticOptions {
	store: SourceStore
	/** Model for the support check, or a function that picks one per review (e.g. `() => modelFor("critic")`). */
	model: string | (() => string)
	/**
	 * Kinds a second reviewer checks too, with the same rubric, another model and its own context.
	 * Such an artifact passes only if both pass; when its fixes run out it goes to human review instead of
	 * being dropped. Default `["proposal"]`; `[]` turns the second reviewer off.
	 */
	dualReview?: ArtifactKind[]
	/** The second reviewer's model. Default: `secondCriticModel()` of the first one's; a decision model with SUBQ on. */
	secondModel?: string | (() => string)
	/** Send-backs per artifact. The next rejection after the last one drops the artifact (or escalates it). Default 2. */
	maxAttempts?: number
	/** Participant name. Default `critic`; the second reviewer is `<name>-2`. */
	name?: string
}

export type ReviewStatus = "reviewing" | "accepted" | "sent-back" | "dropped" | "needs-human" | "error"

export interface CriticStats {
	reviews: number
	accepted: number
	sentBack: number
	dropped: number
	/** Two-reviewer artifacts left for a person. */
	escalated: number
	/** Reviews where the two reviewers disagreed on a claim. */
	splits: number
	errors: number
	rejectedClaims: number
}

export interface Critic {
	agent: Agent
	/** The second reviewer, for the kinds in `dualReview`. createCritic joins it; it has no handlers. */
	second?: Agent
	/** Where an artifact stands. Undefined if it was never posted. */
	status(kind: ArtifactKind, id: string): ReviewStatus | undefined
	/** Resolves when no review is running. A sent-back artifact waits for its producer, not for the Critic. */
	idle(): Promise<void>
	stats(): CriticStats
	/**
	 * Mock answers for critique tasks: lexicalReview for the first reviewer, the stricter strictReview for the
	 * second, so they can disagree. createCritic registers it on the runtime's runner when that is a
	 * MockInferenceRunner; register it yourself if you wrap the mock.
	 */
	mockResponder: MockResponder
}

interface Review {
	kind: ArtifactKind
	id: string
	producerId: string
	producerTaskId?: string
	status: ReviewStatus
	/** Finished reviews. */
	round: number
	sendBacks: number
	/** Bumped on every post. A review that ends on an older version is stale. */
	version: number
	/** A proposal's free text as it last passed the free-text check; unchanged text is not checked again. */
	checkedText?: string
}

interface Job {
	/** The review message the task was run with. */
	message: string
	claims: Claim[]
	sources: Map<string, SourceRecord>
	subjectLine: string
	mock: MockReview
	/** The free-text check of a proposal, not a claim check. */
	text?: boolean
}

/** A reviewer's answer in mock runs, in place of its model. */
type MockReview = (claims: Claim[], sources: Map<string, SourceRecord>, subjectLine: string) => ReviewCheck[]

interface Reviewer {
	name: string
	agent: Agent
	model: () => string
	mock: MockReview
	/** Claims this reviewer already found supported, so a re-post only re-checks what changed. */
	supported: Set<string>
}

/** One reviewer's model check. `rejected` is undefined when it gave no usable answer. */
interface Vote {
	reviewer: string
	model: string
	taskId: string
	rejected?: RejectedClaim[]
	error: string
}

/** Tries per critique task: a failed call or an answer that is not the review JSON is run once more. */
const MODEL_TRIES = 2

class WhenArtifactPosted extends SituationSpecification {
	isSatisfiedBy({ event, participant }: SituationContext): boolean {
		return event.type === ARTIFACT_POSTED && event.producerId !== participant.getId()
	}
}

/**
 * The Critic: reviews every artifact as soon as a producer posts it, in parallel with the rest of the team.
 * Per claim it checks by code that every source id exists and belongs to the artifact's researcher or company,
 * then asks the model whether the source text supports the claim. On a reject it writes a CriticVerdict and
 * sends the artifact back to its producer as a new task; after `maxAttempts` send-backs it drops the artifact.
 *
 * For the kinds in `dualReview` (proposals by default) a second reviewer runs the same model check at the
 * same time, on another model and in its own context. Both must pass. Their rejected claims go back as one
 * send-back, and when the fixes run out the artifact goes to human review (the "santa method").
 *
 * A proposal's free text (research questions, approach, plan, reasoning, terms) gets one more task on the first reviewer,
 * whenever it changed since it last passed: every sentence that states as true what no claim or source states goes back
 * to the Writer as a `free-text` reject, beside the rejected claims.
 *
 * Every step is a trace event (see protocol.ts). It does not join itself: `join(critic.agent)` after the trace observer.
 */
export function createCritic(options: CriticOptions): Critic {
	const { store } = options
	const name = options.name ?? "critic"
	const pickModel = typeof options.model === "function" ? options.model : () => options.model as string
	const pickSecond =
		typeof options.secondModel === "function"
			? options.secondModel
			: () => (options.secondModel as string | undefined) ?? secondCriticModel(pickModel())
	const dualKinds = new Set(options.dualReview ?? ["proposal"])
	const maxAttempts = options.maxAttempts ?? 2
	const reviews = new Map<string, Review>()
	const jobs = new Map<string, Job>()
	let splits = 0
	let inFlight = 0
	let idleWaiters: Array<() => void> = []

	const agent = createAgent({
		name,
		capabilities: ["inference", "review"],
		instruction: CRITIC_INSTRUCTION,
		tools: [],
		handlers: [
			{
				specification: new WhenArtifactPosted(),
				processor: { apply: ({ event }) => onPosted(event.producerId, event.payload as ArtifactPosted) },
			},
		],
	})
	const primary: Reviewer = { name, agent, model: pickModel, mock: lexicalReview, supported: new Set() }
	let second: Reviewer | undefined
	if (dualKinds.size) {
		const secondName = `${name}-2`
		const secondAgent = createAgent({
			name: secondName,
			capabilities: ["inference", "review"],
			instruction: CRITIC_INSTRUCTION,
			tools: [],
			handlers: [],
		})
		join(secondAgent)
		second = { name: secondName, agent: secondAgent, model: pickSecond, mock: strictReview, supported: new Set() }
	}

	const emit = (type: string, payload: object, from: Agent = agent) =>
		sendEvent(SemanticEvent.create(type, from.getId(), payload), from.getId())

	function onPosted(producerId: string, { kind, id, taskId }: ArtifactPosted): void {
		const key = `${kind}:${id}`
		const review = reviews.get(key) ?? { kind, id, producerId, status: "reviewing", round: 0, sendBacks: 0, version: 0 }
		reviews.set(key, review)
		review.producerId = producerId
		review.producerTaskId = taskId
		review.status = "reviewing"
		const version = ++review.version
		inFlight++
		// Start after this event's fan-out, so every participant sees the post before the review.
		queueMicrotask(() => {
			reviewOnce(review, version)
				.catch((error) => {
					review.status = "error"
					emit(CRITIC_ERROR, { kind, id, error: error instanceof Error ? error.message : String(error) })
				})
				.finally(() => {
					if (--inFlight > 0) return
					const waiters = idleWaiters
					idleWaiters = []
					waiters.forEach((resolve) => resolve())
				})
		})
	}

	async function reviewOnce(review: Review, version: number): Promise<void> {
		const s = state()
		const { kind, id } = review
		const artifact = readArtifact(s, kind, id)
		if (!artifact) {
			review.status = "error"
			emit(CRITIC_ERROR, { kind, id, producerTaskId: review.producerTaskId, error: `${kind} ${id} is not on the blackboard` })
			return
		}

		const code = checkByCode(kind, artifact, s, store)
		const panel = second && dualKinds.has(kind) ? [primary, second] : [primary]
		const fresh = code.passed.filter((claim) => panel.some((reviewer) => !reviewer.supported.has(claimKey(claim))))
		const rejected: RejectedClaim[] = [...code.rejected]
		const header = {
			kind,
			id,
			round: review.round,
			claims: claimsOf(kind, artifact).length,
			codeRejected: code.rejected.length,
			alreadySupported: code.passed.length - fresh.length,
			producerTaskId: review.producerTaskId,
		}

		// A proposal's free text gets its own check by the first reviewer, whenever it changed since it last passed.
		const freeText = kind === "proposal" ? freeTextOf(artifact as Proposal) : undefined
		const checkText = freeText !== undefined && freeText !== review.checkedText

		let votes: Vote[] = []
		let textVote: Vote | undefined
		if (!fresh.length && !checkText) {
			emit(CRITIC_REVIEWING, { ...header, modelCheck: 0 })
		} else {
			const sources = new Map(
				[...code.sources].filter(([cited]) => fresh.some((claim) => claim.sourceIds.includes(cited))),
			)
			const message = reviewMessage(kind, id, code.subject, fresh, sources)
			// Each reviewer runs its own task at the same time: same claims and rubric, its own model and context.
			const claimVotes = fresh.length
				? panel.map((reviewer) => vote(reviewer, id, message, { claims: fresh, sources, subjectLine: code.subject.line }, header))
				: []
			const textCheck = checkText
				? vote(
						primary,
						id,
						textReviewMessage(id, code.subject, maskedText(artifact as Proposal), claimsOf(kind, artifact), code.sources),
						{ claims: [], sources: code.sources, subjectLine: code.subject.line, text: true },
						header,
					)
				: undefined
			;[votes, textVote] = await Promise.all([Promise.all(claimVotes), textCheck])
			const failed = [...votes, ...(textVote ? [textVote] : [])].find((v) => !v.rejected)
			if (failed) {
				if (version === review.version) review.status = "error"
				emit(CRITIC_ERROR, { taskId: failed.taskId, kind, id, reviewer: failed.reviewer, error: failed.error })
				return
			}
			votes.forEach((v, i) => {
				for (const claim of fresh) {
					if (!v.rejected!.some((r) => r.claim === claim)) panel[i].supported.add(claimKey(claim))
				}
			})
			rejected.push(...mergeVotes(fresh, votes))
			if (textVote) rejected.push(...textVote.rejected!)
		}

		const ran = votes.length ? votes : textVote ? [textVote] : []
		const taskId = ran[0]?.taskId
		if (version !== review.version) {
			emit(CRITIC_STALE, { taskId, kind, id, reason: "a newer version was posted during the review" })
			return
		}
		if (textVote?.rejected?.length === 0) review.checkedText = freeText
		const split = rejected.filter((r) => r.reviewers && r.reviewers.length < votes.length)
		if (split.length) {
			splits++
			emit(CRITIC_SPLIT, {
				taskId,
				kind,
				id,
				reviewers: votes.map(({ reviewer, model, taskId }) => ({ reviewer, model, taskId })),
				claims: split.map(({ claim, reason, reviewers }) => ({
					claim: { text: clip(claim.text, 300), sourceIds: claim.sourceIds },
					rejectedBy: reviewers,
					reason: clip(reason, 300),
				})),
			})
		}
		decide(review, artifact, rejected, ran)
	}

	/**
	 * One reviewer's model check, as its own critique task: of the claims, or with `job.text` of a proposal's free text.
	 * A failed call or an unusable answer is tried once more.
	 */
	async function vote(reviewer: Reviewer, id: string, message: string, job: Omit<Job, "mock" | "message">, header: object): Promise<Vote> {
		const task = createTask("critique", reviewer.agent, id)
		const model = reviewer.model()
		const freeText = job.text ? { freeText: true } : {}
		emit(CRITIC_REVIEWING, { taskId: task.id, ...header, modelCheck: job.claims.length, ...freeText, reviewer: reviewer.name, model }, reviewer.agent)
		jobs.set(task.id, { ...job, message, mock: reviewer.mock })
		let rejected: RejectedClaim[] | undefined
		let error = ""
		for (let attempt = 0; attempt < MODEL_TRIES && !rejected; attempt++) {
			runTask(task, message, { model, structuredOutput: job.text ? TEXT_REVIEW_SCHEMA : REVIEW_SCHEMA })
			await whenSettled([task.id])
			try {
				if (task.status !== "done") throw new Error(task.error ?? `critique task ${task.status}`)
				rejected = job.text ? parseTextReview(task.output) : parseReview(task.output, job.claims)
			} catch (e) {
				error = e instanceof Error ? e.message : String(e)
			}
		}
		jobs.delete(task.id)
		return { reviewer: reviewer.name, model, taskId: task.id, rejected, error }
	}

	function decide(review: Review, artifact: Artifact, rejected: RejectedClaim[], votes: Vote[]): void {
		const s = state()
		const { kind, id } = review
		const ok = rejected.length === 0
		const action: CriticVerdict["action"] = ok
			? "accept"
			: review.sendBacks < maxAttempts
				? "send-back"
				: dualKinds.has(kind)
					? "human-review"
					: "drop"
		const revision = kind === "proposal" ? ((artifact as Proposal).revision ?? 0) : review.round
		const taskId = votes[0]?.taskId
		review.round++

		const verdict: CriticVerdict = { proposalId: id, revision, ok, rejected, kind, taskId, action }
		if (votes.length > 1) {
			verdict.reviewers = votes.map(
				({ reviewer, model, taskId, rejected }): ReviewerVote => ({ reviewer, model, taskId, rejected: rejected!.length }),
			)
		}
		s.verdicts.push(verdict)
		emit(CRITIC_VERDICT, {
			taskId,
			kind,
			id,
			revision,
			ok,
			action,
			producerId: review.producerId,
			producerTaskId: review.producerTaskId,
			reviewers: verdict.reviewers,
			rejected: rejected.map(({ claim, reason, check, reviewers }) => ({
				claim: { text: clip(claim.text, 300), sourceIds: claim.sourceIds },
				reason: clip(reason, 300),
				check,
				reviewers,
			})),
		})

		if (action === "accept") {
			review.status = "accepted"
		} else if (action === "send-back") {
			review.sendBacks++
			review.status = "sent-back"
			const task = createTask(PRODUCER_TASK[kind], review.producerId, id)
			const sentBack: SentBack = {
				taskId: task.id,
				kind,
				id,
				producerId: review.producerId,
				attempt: review.sendBacks,
				maxAttempts,
				rejected,
			}
			emit(CRITIC_SENT_BACK, { ...sentBack, reviewTaskId: taskId })
		} else if (action === "drop") {
			removeArtifact(s, kind, id)
			review.status = "dropped"
			emit(CRITIC_DROPPED, {
				taskId,
				kind,
				id,
				sendBacks: review.sendBacks,
				reasons: rejected.map(({ reason }) => clip(reason, 200)),
			})
		} else if (action === "human-review") {
			review.status = "needs-human"
			emit(CRITIC_ESCALATED, {
				taskId,
				kind,
				id,
				sendBacks: review.sendBacks,
				reasons: rejected.map(({ reason }) => clip(reason, 200)),
			})
		}
	}

	const jobOf = (contextId: string) => {
		const taskId = state().contextTasks.get(contextId)
		return taskId ? jobs.get(taskId) : undefined
	}
	const mockResponder: MockResponder = (input) => {
		const job = jobOf(input.context.id)
		if (!job) return undefined
		// The mock has no reader for free text: it passes.
		if (job.text) return JSON.stringify({ statements: [] })
		return JSON.stringify({ checks: job.mock(job.claims, job.sources, job.subjectLine) })
	}
	// A reviewer on a decision model (subq-snap, Jev) gets the review as one yes/no question per claim.
	const decider: Decider = (input) => {
		const job = jobOf(input.context.id)
		return job && !job.text ? reviewDecision(job.message, job.claims, subqSettings().threshold) : undefined
	}
	const runner = resolveRuntime().getInferenceRunner()
	innerOf(runner, MockInferenceRunner)?.responders.push(mockResponder)
	innerOf(runner, SnapRunner)?.deciders.push(decider)

	return {
		agent,
		second: second?.agent,
		mockResponder,
		status: (kind, id) => reviews.get(`${kind}:${id}`)?.status,
		idle: () => (inFlight === 0 ? Promise.resolve() : new Promise((resolve) => idleWaiters.push(resolve))),
		stats() {
			const all = [...reviews.values()]
			const mine = state().verdicts.filter((v) => v.kind !== undefined)
			return {
				reviews: mine.length,
				accepted: all.filter((r) => r.status === "accepted").length,
				sentBack: mine.filter((v) => v.action === "send-back").length,
				dropped: all.filter((r) => r.status === "dropped").length,
				escalated: all.filter((r) => r.status === "needs-human").length,
				splits,
				errors: all.filter((r) => r.status === "error").length,
				rejectedClaims: mine.reduce((sum, v) => sum + v.rejected.length, 0),
			}
		},
	}
}

function claimKey(claim: Claim): string {
	return `${claim.text}\u0000${[...claim.sourceIds].sort().join(",")}`
}

/**
 * The reviewers' rejected claims as one list, for one send-back. A claim is rejected when any reviewer
 * rejects it. With two reviewers each reason names its reviewer, and `reviewers` lists who rejected it.
 */
function mergeVotes(claims: Claim[], votes: Vote[]): RejectedClaim[] {
	if (votes.length === 1) return votes[0].rejected!
	return claims.flatMap((claim) => {
		const against = votes.flatMap((v) => v.rejected!.filter((r) => r.claim === claim).map((r) => ({ reviewer: v.reviewer, ...r })))
		if (!against.length) return []
		return [
			{
				claim,
				reason: against.map(({ reviewer, reason }) => `${reviewer}: ${reason}`).join(" "),
				check: against.some((r) => r.check === "unsupported") ? "unsupported" : "unchecked",
				reviewers: against.map(({ reviewer }) => reviewer),
			},
		]
	})
}

/** Models for the second reviewer after the critic route's own, so one key is enough. */
const SECOND_FALLBACK = ["claude-haiku-4-5", "gpt-5.5", "gemini-3.5-flash"]

/**
 * The second reviewer's model [MODEL_CRITIC_2]: else the decision model with SUBQ on [SUBQ_MODEL],
 * else the first usable model on the critic route (config/models.ts)
 * from another provider than `primary`, else another usable model. Usable: its provider has a key, or no key is set.
 */
export function secondCriticModel(primary: string): string {
	const pinned = process.env.MODEL_CRITIC_2
	if (pinned) return pinned
	if (subq()) return subqSettings().model
	const keyed = providersWithKeys()
	const usable = [...ROUTES.critic.models, ...SECOND_FALLBACK].filter(
		(model) => model !== primary && (!keyed.length || keyed.includes(providerOf(model))),
	)
	return usable.find((model) => providerOf(model) !== providerOf(primary)) ?? usable[0] ?? primary
}
