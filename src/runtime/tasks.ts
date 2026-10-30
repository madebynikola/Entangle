import {
	Agent,
	DeveloperMessageItem,
	ModelContext,
	SemanticEvent,
	SituationSpecification,
	createHuman,
	type Human,
	type InferenceOutput,
	type InterceptionHandler,
	type ModelMessageItem,
	type StructuredOutputFormat,
	type Tool,
} from "@mozaik-ai/core"
import type { Task, TaskKind, TaskStats } from "../types"
import { costUsd } from "./pricing"
import { resolveParticipant, runLoop, sendEvent, state } from "./mozaik"
import type { LoopInfo, MatchState } from "./state"

export interface TaskRun {
	model: string
	/** Defaults to the agent's own tools. */
	tools?: Tool[]
	structuredOutput?: StructuredOutputFormat
	maxOutputTokens?: number
	interception?: InterceptionHandler
}

export function createTask(kind: TaskKind, assignee: Agent | string, subjectId?: string): Task {
	const s = state()
	const task: Task = {
		id: `${kind}-${++s.taskSeq}`,
		kind,
		assignee: typeof assignee === "string" ? assignee : assignee.getId(),
		status: "queued",
		attempts: 0,
		subjectId,
		createdAt: Date.now(),
		tokens: 0,
		costUsd: 0,
		inputTokens: 0,
		outputTokens: 0,
		inferences: 0,
		retries: 0,
	}
	s.tasks.set(task.id, task)
	return task
}

/**
 * Start one attempt of a task as its own Mozaik loop. Fire-and-forget like runLoop:
 * the task tracker marks it done on `model.answer`; await whenSettled() for the result.
 * Each attempt gets a fresh context (instruction + this message), so parallel tasks on one agent never share memory.
 * With the budget spent or the task's attempts used up, the task fails at once and no loop starts.
 */
export function runTask(task: Task, message: string, run: TaskRun): void {
	const s = state()
	const agent = resolveParticipant(task.assignee)
	if (!(agent instanceof Agent)) throw new Error(`Task ${task.id}: ${task.assignee} is not an agent`)

	const refused =
		budgetSpent() ?? (task.attempts >= s.budget.maxAttempts ? `attempts: all ${s.budget.maxAttempts} used` : null)
	if (refused) {
		settleFailed(task, refused)
		return
	}

	const context = ModelContext.create().addContextItem(DeveloperMessageItem.create(agent.getDeveloperMessage()))
	s.contextTasks.set(context.id, task.id)
	task.status = "running"
	task.attempts++
	task.startedAt = Date.now()
	task.finishedAt = undefined
	task.error = undefined
	task.model = run.model
	sendEvent(
		SemanticEvent.create("task.started", agent.getId(), {
			taskId: task.id,
			kind: task.kind,
			attempt: task.attempts,
			model: run.model,
		}),
		agent.getId(),
	)
	runLoop(
		agent.getId(),
		message,
		{
			model: run.model,
			context,
			tools: run.tools ?? agent.getTools(),
			structuredOutput: run.structuredOutput,
			maxOutputTokens: run.maxOutputTokens,
		},
		run.interception,
	)
}

/** Mark a task failed (e.g. by the orchestrator, or on timeout) and tell everyone. */
export function failTask(task: Task, error: string): void {
	if (task.status === "done" || task.status === "failed") return
	settleFailed(task, error)
}

function settleFailed(task: Task, error: string): void {
	task.status = "failed"
	task.error = error
	task.finishedAt = Date.now()
	sendEvent(SemanticEvent.create("task.failed", task.assignee, { ...taskStats(task), error }), task.assignee)
	notify()
}

/** What a task cost and took so far, summed from `inference.completed` by the task tracker. */
export function taskStats(task: Task): TaskStats {
	return {
		taskId: task.id,
		kind: task.kind,
		attempts: task.attempts,
		model: task.model,
		ms: (task.finishedAt ?? Date.now()) - (task.startedAt ?? task.createdAt),
		tokens: task.tokens,
		inputTokens: task.inputTokens ?? 0,
		outputTokens: task.outputTokens ?? 0,
		costUsd: task.costUsd,
		inferences: task.inferences ?? 0,
		retries: task.retries ?? 0,
	}
}

/**
 * The budget limit the run has passed, or null. The first time, tells everyone with `budget.exhausted`.
 * Check it before creating more work: runTask refuses new tasks from then on.
 */
export function budgetSpent(): string | null {
	const s = state()
	const reason = s.budgetExceeded()
	if (reason && !s.budget.exhausted) {
		s.budget.exhausted = reason
		const { tokensUsed, costUsd } = s.budget
		const ms = Date.now() - s.budget.startedAt
		// After the current fan-out (often the inference.completed that crossed the limit), so the trace stays in order.
		queueMicrotask(() => {
			if (!s.trackerId) return
			sendEvent(SemanticEvent.create("budget.exhausted", s.trackerId, { reason, tokensUsed, costUsd, ms }), s.trackerId)
		})
	}
	return reason
}

const waiters = new Set<() => void>()

function notify(): void {
	for (const check of [...waiters]) check()
}

/**
 * Resolve when every listed task is done or failed. Tasks still open after `timeoutMs`
 * (default: what is left of the wall-clock budget) are failed with "timeout".
 */
export function whenSettled(taskIds: string[], timeoutMs?: number): Promise<Task[]> {
	const s = state()
	const tasks = taskIds.map((id) => {
		const task = s.tasks.get(id)
		if (!task) throw new Error(`Unknown task ${id}`)
		return task
	})
	const settled = () => tasks.every((t) => t.status === "done" || t.status === "failed")
	const wait = timeoutMs ?? Math.max(0, s.budget.startedAt + s.budget.maxWallMs - Date.now())

	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			for (const task of tasks) failTask(task, "timeout")
		}, wait)
		const check = () => {
			if (!settled()) return
			waiters.delete(check)
			clearTimeout(timer)
			resolve(tasks)
		}
		waiters.add(check)
		check()
	})
}

/** The loop an event belongs to. Binds new loops to their task through the context id. */
export function loopOf(s: MatchState, event: SemanticEvent): LoopInfo | undefined {
	const payload = event.payload as { loopId?: string; input?: { context?: ModelContext }; context?: ModelContext }
	if (!payload?.loopId) return undefined
	let loop = s.loops.get(payload.loopId)
	if (!loop) {
		const contextId = payload.input?.context?.id ?? payload.context?.id
		loop = {
			loopId: payload.loopId,
			agentId: event.producerId,
			taskId: contextId ? s.contextTasks.get(contextId) : undefined,
		}
		s.loops.set(loop.loopId, loop)
		if (contextId) s.contextLoops.set(contextId, loop.loopId)
	}
	return loop
}

class AnyEvent extends SituationSpecification {
	isSatisfiedBy(): boolean {
		return true
	}
}

/**
 * Observer that keeps tasks, loops and the budget in step with Mozaik events.
 * Join it first, so every later participant sees the updated state.
 * Emits `task.completed` with TaskStats and `output` when a task's loop answers.
 */
export function createTaskTracker(): Human {
	return createHuman({
		name: "task-tracker",
		capabilities: ["observer"],
		handlers: [{ specification: new AnyEvent(), processor: { apply: ({ event }) => track(event) } }],
	})
}

function track(event: SemanticEvent): void {
	const s = state()
	const loop = loopOf(s, event)
	if (!loop) return
	const task = loop.taskId ? s.tasks.get(loop.taskId) : undefined

	if (event.type === "inference.started") {
		loop.model = (event.payload as { model: string }).model
	} else if (event.type === "inference.completed") {
		if (task) task.inferences = (task.inferences ?? 0) + 1
		const usage = (event.payload as InferenceOutput).tokenUsage
		if (!usage) return
		const cost = costUsd(loop.model, usage.inputTokens, usage.outputTokens) ?? 0
		s.budget.tokensUsed += usage.totalTokens
		s.budget.costUsd += cost
		if (task) {
			task.tokens += usage.totalTokens
			task.inputTokens = (task.inputTokens ?? 0) + usage.inputTokens
			task.outputTokens = (task.outputTokens ?? 0) + usage.outputTokens
			task.costUsd += cost
		}
		budgetSpent()
	} else if (event.type === "model.answer" && task && task.status === "running") {
		task.status = "done"
		task.output = (event.payload as { answer: ModelMessageItem }).answer.content.text
		task.finishedAt = Date.now()
		// After the model.answer fan-out, so every participant sees the answer first.
		queueMicrotask(() => {
			sendEvent(
				SemanticEvent.create("task.completed", task.assignee, { ...taskStats(task), output: task.output }),
				task.assignee,
			)
			notify()
		})
	}
}
