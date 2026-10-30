import {
	RuntimeState,
	SemanticEvent,
	defineRuntime,
	type InferenceInput,
	type InferenceOutput,
	type InferenceRunner,
} from "@mozaik-ai/core"
import type { InferenceAttempt, TaskKind } from "../types"
import { ClaudeCodeRunner } from "./claude-code-runner"
import { providerLimits, providerOf, runnerSettings, type RunnerSettings } from "./config"
import { Semaphore, TokenBucket, sleep } from "./limits"
import { sendEvent, state } from "./mozaik"
import { budgetSpent, failTask } from "./tasks"

class SpareState extends RuntimeState {}

/** Mozaik 4.1.0 does not export its request validator, so take its default runner from a spare runtime that never runs. */
export function defaultInferenceRunner(): InferenceRunner {
	return defineRuntime<SpareState>().initializeRuntime({ state: new SpareState() }).getInferenceRunner()
}

interface Call {
	model: string
	provider: string
	/** Estimated as chars / 4, for the input-token bucket. */
	inputTokens: number
	taskId?: string
	loopId?: string
	/** Sender of the call's events: the task's agent, else the loop's agent, else the task tracker. */
	senderId: string
	/** Its place in the queue for a slot: see RANK. */
	rank: number
}

interface ProviderGate {
	requests: TokenBucket
	inputTokens: TokenBucket
}

type AttemptData = Omit<InferenceAttempt, "taskId" | "loopId" | "model" | "provider">

/**
 * A freed slot goes to the call furthest down the pipeline, so a company that is almost done does not wait behind
 * the profiles of companies that just started. A review ranks with the work it reviews, and so does the fix it sends back.
 * Reviews of needs and their fixes rank just under the writes: only the company's decision waits on them, and they are few.
 * Ranked with the analyses, they wait behind every profile, and every company is decided at the end again.
 * Within one rank, calls go in arrival order.
 */
const RANK: Record<TaskKind, number> = { write: 5, match: 3, profile: 2, screen: 1, analyze: 0, demo: 0, critique: 0 }
const NEED_REVIEW = 4

/**
 * Wraps another InferenceRunner (Mozaik's default, or the mock) with what many parallel loops need:
 * - a global semaphore: at most `maxInFlight` calls at once, and no more than the local Claude Code sessions;
 *   a freed slot goes to the call furthest down the pipeline (RANK);
 * - a token bucket per provider, for requests and input tokens per minute; a 429 pauses the whole provider;
 * - retries with exponential backoff and jitter on 429, 5xx and network errors, each one a trace event;
 * - a stop: no call goes out for a task that is already settled (timeout, budget, failed by an agent),
 *   nor once the run is past its budget plus the slack.
 *
 * Mozaik 4.1.0 cannot end a loop and does not await it, so a throw here only becomes an unhandled rejection.
 * A call that ends its task (fatal error, stop) therefore fails the task and never settles: the loop is dropped.
 */
export class ResilientRunner implements InferenceRunner {
	private readonly slots: Semaphore
	private readonly gates = new Map<string, ProviderGate>()

	constructor(
		/** The wrapped runner. Agents reach a mock's `responders` through it. */
		readonly inner: InferenceRunner,
		private readonly settings: RunnerSettings = runnerSettings(),
	) {
		// Local Claude Code serves its sessions first come first served. More slots here would only queue calls there, out of rank.
		this.slots = new Semaphore(Math.min(settings.maxInFlight, sessionsOf(inner)))
	}

	async run(input: InferenceInput): Promise<InferenceOutput> {
		const call = this.begin(input)
		const request = this.withDefaults(input)
		for (let attempt = 1; ; attempt++) {
			await this.admit(call, attempt)
			let failure: unknown
			try {
				return await this.inner.run(request)
			} catch (error) {
				failure = error
			} finally {
				this.slots.release()
			}
			await this.backoff(call, attempt, failure)
		}
	}

	async *stream(input: InferenceInput): AsyncGenerator<SemanticEvent> {
		const call = this.begin(input)
		const request = this.withDefaults(input)
		for (let attempt = 1; ; attempt++) {
			await this.admit(call, attempt)
			let failure: unknown
			let started = false
			try {
				for await (const event of this.inner.stream(request)) {
					started = true
					yield event
				}
				return
			} catch (error) {
				failure = error
			} finally {
				this.slots.release()
			}
			// Part of the answer is out already, so a retry would send it twice.
			if (started) await this.fail(call, attempt, failure)
			await this.backoff(call, attempt, failure)
		}
	}

	/** Mozaik 4.1.0 sends no `max_tokens` to Anthropic when it is unset, and Anthropic answers 400. */
	private withDefaults(input: InferenceInput): InferenceInput {
		if (input.maxOutputTokens !== undefined) return input
		return { ...input, maxOutputTokens: this.settings.maxOutputTokens }
	}

	private begin(input: InferenceInput): Call {
		const s = state()
		const taskId = s.contextTasks.get(input.context.id)
		const loopId = s.contextLoops.get(input.context.id)
		const senderId =
			(taskId && s.tasks.get(taskId)?.assignee) || (loopId && s.loops.get(loopId)?.agentId) || s.trackerId
		return {
			model: input.model,
			provider: providerOf(input.model),
			inputTokens: estimateInputTokens(input),
			taskId,
			loopId,
			senderId,
			rank: rankOf(taskId),
		}
	}

	/** Wait for the provider's rate limits and a free slot, unless the call should not go out at all. */
	private async admit(call: Call, attempt: number): Promise<void> {
		const queuedAt = Date.now()
		let reason = this.stopReason(call)
		if (reason) await this.refuse(call, attempt, reason)
		const gate = this.gate(call.provider)
		await gate.requests.take(1)
		await gate.inputTokens.take(call.inputTokens)
		await this.slots.acquire(call.rank)
		// The wait can be long; the task may have settled or the budget run out meanwhile.
		reason = this.stopReason(call)
		if (reason) {
			this.slots.release()
			await this.refuse(call, attempt, reason)
		}
		this.emit("inference.dispatched", call, { attempt, waitMs: Date.now() - queuedAt, inFlight: this.slots.inFlight })
	}

	private stopReason(call: Call): string | null {
		const s = state()
		const task = call.taskId ? s.tasks.get(call.taskId) : undefined
		if (task && task.status !== "running") return `task ${task.status}${task.error ? `: ${task.error}` : ""}`
		budgetSpent()
		const over = s.budgetExceeded(this.settings.budgetSlack)
		return over ? `budget: ${over}` : null
	}

	/** Wait before the next attempt, or fail the call if the error is not worth a retry or none is left. */
	private async backoff(call: Call, attempt: number, error: unknown): Promise<void> {
		if (attempt > this.settings.maxRetries || !isRetryable(error)) return this.fail(call, attempt, error)
		const status = statusOf(error)
		const exponential = this.settings.baseBackoffMs * 2 ** (attempt - 1) * (0.5 + Math.random() / 2)
		const delayMs = Math.round(Math.min(this.settings.maxBackoffMs, retryAfterMs(error) ?? exponential))
		// A 429 means the provider is over our limit for every call, not just this one.
		if (status === 429) this.gate(call.provider).requests.pause(delayMs)

		const s = state()
		s.budget.retries = (s.budget.retries ?? 0) + 1
		const task = call.taskId ? s.tasks.get(call.taskId) : undefined
		if (task) task.retries = (task.retries ?? 0) + 1
		this.emit("inference.retry", call, { attempt, status, error: describe(error), delayMs })
		await sleep(delayMs)
	}

	/** No retry: fail the task and drop the loop. A call with no task has nobody to tell, so it throws. */
	private fail(call: Call, attempt: number, error: unknown): Promise<never> {
		const status = statusOf(error)
		const message = describe(error)
		this.emit("inference.failed", call, { attempt, status, error: message })
		const task = call.taskId ? state().tasks.get(call.taskId) : undefined
		if (!task) return Promise.reject(error)
		failTask(task, `${call.model}${status ? ` ${status}` : ""}: ${message}`)
		return dropped()
	}

	private refuse(call: Call, attempt: number, reason: string): Promise<never> {
		this.emit("inference.refused", call, { attempt, reason })
		const task = call.taskId ? state().tasks.get(call.taskId) : undefined
		if (task) failTask(task, reason)
		return dropped()
	}

	private gate(provider: string): ProviderGate {
		let gate = this.gates.get(provider)
		if (!gate) {
			const limits = providerLimits(provider)
			gate = { requests: new TokenBucket(limits.rpm), inputTokens: new TokenBucket(limits.itpm) }
			this.gates.set(provider, gate)
		}
		return gate
	}

	private emit(type: string, call: Call, data: AttemptData): void {
		if (!call.senderId || !state().getParticipant(call.senderId)) return
		const payload: InferenceAttempt = {
			taskId: call.taskId,
			loopId: call.loopId,
			model: call.model,
			provider: call.provider,
			...data,
		}
		sendEvent(SemanticEvent.create(type, call.senderId, payload), call.senderId)
	}
}

/** A call's rank from its task (see RANK). A call with no task is not pipeline work, so nothing holds it up. */
function rankOf(taskId: string | undefined): number {
	const s = state()
	const task = taskId ? s.tasks.get(taskId) : undefined
	if (!task) return RANK.write
	const subject = task.subjectId ?? ""
	// An Analyst's first task is about a company; a fix it is sent back is about one of the company's needs.
	if ((task.kind === "critique" || task.kind === "analyze") && s.needs.has(subject)) return NEED_REVIEW
	if (task.kind !== "critique") return RANK[task.kind]
	if (s.proposals.has(subject)) return RANK.write
	if (s.candidates.has(subject)) return RANK.match
	return RANK.profile
}

/** The local Claude Code sessions under `runner`, if it wraps that backend. */
function sessionsOf(runner: InferenceRunner | undefined): number {
	for (; runner; runner = (runner as { inner?: InferenceRunner }).inner) {
		if (runner instanceof ClaudeCodeRunner) return runner.settings.sessions
	}
	return Infinity
}

/** Never settles. Mozaik keeps no handle on its loops, so a loop that waits on this is just garbage-collected. */
function dropped(): Promise<never> {
	return new Promise(() => {})
}

function estimateInputTokens(input: InferenceInput): number {
	const tools = (input.tools ?? []).map((tool) => tool.name + tool.description + JSON.stringify(tool.parameters))
	return Math.ceil((JSON.stringify(input.context.getItems()).length + tools.join("").length) / 4)
}

/** The provider SDKs (Anthropic, OpenAI, Google) all put the HTTP status on `error.status`. */
function statusOf(error: unknown): number | undefined {
	const status = (error as { status?: unknown } | undefined)?.status
	return typeof status === "number" ? status : undefined
}

const RETRY_STATUSES = new Set([408, 409, 425, 429])

function isRetryable(error: unknown): boolean {
	const status = statusOf(error)
	if (status !== undefined) {
		// Out of credit: waiting does not help.
		if (status === 429 && /insufficient_quota|billing/i.test(describe(error))) return false
		return RETRY_STATUSES.has(status) || status >= 500
	}
	// No status: a network error is worth a retry; a bad request or a bug is not.
	const e = error as { name?: string; message?: string; cause?: unknown } | undefined
	const text = `${e?.name} ${e?.message} ${String(e?.cause ?? "")}`
	return /connection|timeout|timed out|fetch failed|socket|network|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(text)
}

function retryAfterMs(error: unknown): number | undefined {
	const headers = (error as { headers?: unknown } | undefined)?.headers
	if (!headers) return undefined
	const read = (name: string): string | null | undefined =>
		typeof (headers as Headers).get === "function"
			? (headers as Headers).get(name)
			: (headers as Record<string, string | undefined>)[name]
	const ms = Number(read("retry-after-ms"))
	if (ms > 0) return ms
	const after = read("retry-after")
	if (!after) return undefined
	const seconds = Number(after)
	if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
	const date = Date.parse(after)
	return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now())
}

function describe(error: unknown): string {
	const text = error instanceof Error ? error.message : String(error)
	return text.length > 300 ? `${text.slice(0, 300)}…` : text
}
