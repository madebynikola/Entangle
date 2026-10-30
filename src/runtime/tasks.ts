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
import type { Task, TaskKind } from "../types"
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
	}
	s.tasks.set(task.id, task)
	return task
}

/**
 * Start one attempt of a task as its own Mozaik loop. Fire-and-forget like runLoop:
 * the task tracker marks it done on `model.answer`; await whenSettled() for the result.
 * Each attempt gets a fresh context (instruction + this message), so parallel tasks on one agent never share memory.
 */
export function runTask(task: Task, message: string, run: TaskRun): void {
	const s = state()
	const agent = resolveParticipant(task.assignee)
	if (!(agent instanceof Agent)) throw new Error(`Task ${task.id}: ${task.assignee} is not an agent`)

	const context = ModelContext.create().addContextItem(DeveloperMessageItem.create(agent.getDeveloperMessage()))
	s.contextTasks.set(context.id, task.id)
	task.status = "running"
	task.attempts++
	task.startedAt = Date.now()
	task.error = undefined
	sendEvent(
		SemanticEvent.create("task.started", agent.getId(), { taskId: task.id, kind: task.kind, attempt: task.attempts }),
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
	task.status = "failed"
	task.error = error
	task.finishedAt = Date.now()
	sendEvent(SemanticEvent.create("task.failed", task.assignee, { taskId: task.id, error }), task.assignee)
	notify()
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
 * Emits `task.completed` with `{ taskId, kind, output }` when a task's loop answers.
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
		const usage = (event.payload as InferenceOutput).tokenUsage
		if (!usage) return
		const cost = costUsd(loop.model, usage.inputTokens, usage.outputTokens) ?? 0
		s.budget.tokensUsed += usage.totalTokens
		s.budget.costUsd += cost
		if (task) {
			task.tokens += usage.totalTokens
			task.costUsd += cost
		}
	} else if (event.type === "model.answer" && task && task.status === "running") {
		task.status = "done"
		task.output = (event.payload as { answer: ModelMessageItem }).answer.content.text
		task.finishedAt = Date.now()
		// After the model.answer fan-out, so every participant sees the answer first.
		queueMicrotask(() => {
			sendEvent(
				SemanticEvent.create("task.completed", task.assignee, { taskId: task.id, kind: task.kind, output: task.output }),
				task.assignee,
			)
			notify()
		})
	}
}
