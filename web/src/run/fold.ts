import type { TaskKind, TaskStatus, TraceRecord } from "@shared/types"
import { roleOf, type RoleKey } from "@/lib/roles"

/**
 * Folds trace records (one per Mozaik event) into what the screens draw: agents, loops, tasks, totals.
 * Records apply in `ms` order. Each apply returns a new view; maps that changed are new Map objects and
 * changed entries are new objects, so React selectors can compare by reference.
 *
 * Event kinds this knows (see src/trace/trace-observer.ts): participant.joined/left, task.started/completed/failed,
 * inference.started/completed, function_call.started/completed, model.answer. Every other kind still lands in
 * `records`, and kinds that are not Mozaik loop plumbing go to `feed`.
 */

export type Activity = "idle" | "thinking" | "tool"

export interface AgentView {
	id: string
	name: string
	role: RoleKey
	joinedMs: number
	leftMs?: number
	/** What the agent does now, over all its open loops. */
	activity: Activity
	/** Open loops (an agent can run several tasks at once). */
	openLoops: number
	/** The task of the most recent open loop. */
	taskId?: string
	tokens: number
	costUsd: number
	tasksDone: number
	tasksFailed: number
	/** Tasks this agent got back for another attempt (Critic send-backs, retries). */
	sentBack: number
	lastMs: number
}

export interface Span {
	startMs: number
	/** Undefined while open: draw it up to the run clock. */
	endMs?: number
	/** Still open when the run ended: `endMs` is the run's end, not a reply. */
	stopped?: boolean
}

export interface InferenceSpan extends Span {
	/** When the hardened runner sent the call (`inference.dispatched`), after any rate-limit wait. */
	dispatchedMs?: number
	model?: string
	tokens?: number
	costUsd?: number | null
}

export interface ToolCall extends Span {
	name: string
}

/** One Mozaik loop: one attempt of one task. */
export interface LoopView extends Span {
	id: string
	agentId: string
	taskId?: string
	model?: string
	inferences: InferenceSpan[]
	calls: ToolCall[]
}

export interface TaskView extends Span {
	id: string
	kind: TaskKind | string
	agentId: string
	status: TaskStatus
	attempt: number
	output?: string
	error?: string
	tokens: number
	costUsd: number
}

export interface Totals {
	tokens: number
	costUsd: number
	/** False when some model had no price, so costUsd is a lower bound. */
	costKnown: boolean
	/** Inference calls in flight right now. */
	inFlight: number
	maxInFlight: number
	tasks: number
	done: number
	failed: number
	/** Attempts after the first: Critic send-backs and retries. */
	sentBack: number
	/** Trace events whose kind mentions a retry (from the hardened runner). */
	retries: number
}

export interface RunView {
	/** Records applied so far. */
	count: number
	/** Epoch ms when the run started (first record's `t` minus its `ms`). */
	startEpoch: number | null
	/** `ms` of the last applied record. */
	lastMs: number
	agents: Map<string, AgentView>
	loops: Map<string, LoopView>
	tasks: Map<string, TaskView>
	totals: Totals
	/** Records that are not loop plumbing: task results, Critic verdicts, custom events. Oldest first. */
	feed: TraceRecord[]
	/** Set by `endRun`: the run is over and nothing is in flight. */
	endedMs?: number
}

/** Mozaik loop plumbing: drawn as loops and spans, kept out of the feed. */
const PLUMBING = /^(participant|message_received|inference|function_call|interception|message)\.|^(model\.answer|task\.started)$/

const OBSERVER_NAMES = new Set(["trace", "task-tracker"])

export function emptyView(): RunView {
	return {
		count: 0,
		startEpoch: null,
		lastMs: 0,
		agents: new Map(),
		loops: new Map(),
		tasks: new Map(),
		totals: {
			tokens: 0,
			costUsd: 0,
			costKnown: true,
			inFlight: 0,
			maxInFlight: 0,
			tasks: 0,
			done: 0,
			failed: 0,
			sentBack: 0,
			retries: 0,
		},
		feed: [],
	}
}

/** Apply a batch of records (already in ms order) to a view. */
export function applyRecords(prev: RunView, records: TraceRecord[]): RunView {
	if (!records.length) return prev
	const next = new Draft(prev)
	for (const record of records) next.apply(record)
	return next.done()
}

/** Fold a whole trace. */
export function foldTrace(records: TraceRecord[]): RunView {
	return applyRecords(emptyView(), records)
}

/**
 * The run is over: calls, tool calls, loops and tasks still open never finished (they hung, or the budget stopped
 * the run). Close them at `ms` (the last record) as stopped, so no agent shows as working and nothing is in flight.
 */
export function endRun(prev: RunView, ms = prev.lastMs): RunView {
	if (prev.endedMs != null) return prev
	const stop = <T extends Span>(span: T): T => (span.endMs == null ? { ...span, endMs: Math.max(ms, span.startMs), stopped: true } : span)
	const loops = new Map(prev.loops)
	for (const [id, loop] of loops) {
		if (loop.endMs != null && loop.inferences.every((s) => s.endMs != null) && loop.calls.every((s) => s.endMs != null)) continue
		loops.set(id, { ...stop(loop), inferences: loop.inferences.map(stop), calls: loop.calls.map(stop) })
	}
	const tasks = new Map(prev.tasks)
	for (const [id, task] of tasks) if (task.status === "running" && task.endMs == null) tasks.set(id, stop(task))
	const agents = new Map(prev.agents)
	for (const [id, agent] of agents) {
		if (agent.activity !== "idle" || agent.openLoops > 0) agents.set(id, { ...agent, activity: "idle", openLoops: 0 })
	}
	return { ...prev, loops, tasks, agents, totals: { ...prev.totals, inFlight: 0 }, endedMs: ms }
}

/** Copy-on-write helper: clones a map and its entries the first time they change in a batch. */
class Draft {
	private agents?: Map<string, AgentView>
	private loops?: Map<string, LoopView>
	private tasks?: Map<string, TaskView>
	private readonly touched = new Set<object>()
	private readonly view: RunView

	constructor(prev: RunView) {
		this.view = { ...prev, totals: { ...prev.totals }, feed: prev.feed }
	}

	done(): RunView {
		if (this.agents) this.view.agents = this.agents
		if (this.loops) this.view.loops = this.loops
		if (this.tasks) this.view.tasks = this.tasks
		return this.view
	}

	private agent(id: string, record?: TraceRecord): AgentView | undefined {
		this.agents ??= new Map(this.view.agents)
		let agent = this.agents.get(id)
		if (!agent) {
			if (!record || OBSERVER_NAMES.has(record.agent ?? "")) return undefined
			agent = {
				id,
				name: record.agent ?? id.slice(0, 8),
				role: roleOf(record.agent),
				joinedMs: record.ms,
				activity: "idle",
				openLoops: 0,
				tokens: 0,
				costUsd: 0,
				tasksDone: 0,
				tasksFailed: 0,
				sentBack: 0,
				lastMs: record.ms,
			}
			this.touched.add(agent)
		} else if (!this.touched.has(agent)) {
			agent = { ...agent }
			this.touched.add(agent)
		}
		this.agents.set(id, agent)
		return agent
	}

	private loop(id: string, record: TraceRecord): LoopView {
		this.loops ??= new Map(this.view.loops)
		let loop = this.loops.get(id)
		if (!loop) {
			loop = { id, agentId: record.agentId, taskId: record.taskId, startMs: record.ms, inferences: [], calls: [] }
			this.touched.add(loop)
			const agent = this.agent(record.agentId, record)
			if (agent) agent.openLoops++
		} else if (!this.touched.has(loop)) {
			loop = { ...loop, inferences: [...loop.inferences], calls: [...loop.calls] }
			this.touched.add(loop)
		}
		if (!loop.taskId && record.taskId) loop.taskId = record.taskId
		if (record.model) loop.model = record.model
		this.loops.set(id, loop)
		return loop
	}

	private task(id: string, record: TraceRecord): TaskView {
		this.tasks ??= new Map(this.view.tasks)
		let task = this.tasks.get(id)
		if (!task) {
			const data = record.data as { kind?: string } | undefined
			task = {
				id,
				kind: data?.kind ?? id.replace(/-\d+$/, ""),
				agentId: record.agentId,
				status: "queued",
				attempt: 0,
				startMs: record.ms,
				tokens: 0,
				costUsd: 0,
			}
			this.view.totals.tasks++
			this.touched.add(task)
		} else if (!this.touched.has(task)) {
			task = { ...task }
			this.touched.add(task)
		}
		this.tasks.set(id, task)
		return task
	}

	/** Recompute an agent's activity from its open loops. */
	private settle(agentId: string): void {
		const agent = this.agent(agentId)
		if (!agent) return
		let activity: Activity = "idle"
		let taskId: string | undefined
		let latest = -1
		for (const loop of (this.loops ?? this.view.loops).values()) {
			if (loop.agentId !== agentId || loop.endMs != null) continue
			const call = loop.calls.at(-1)
			const inference = loop.inferences.at(-1)
			if (call && call.endMs == null) activity = "tool"
			else if (activity !== "tool" && inference && inference.endMs == null) activity = "thinking"
			if (loop.startMs > latest) {
				latest = loop.startMs
				taskId = loop.taskId
			}
		}
		agent.activity = activity
		agent.taskId = taskId
	}

	apply(record: TraceRecord): void {
		const v = this.view
		const totals = v.totals
		v.count++
		v.lastMs = Math.max(v.lastMs, record.ms)
		if (v.startEpoch == null) v.startEpoch = Date.parse(record.t) - record.ms
		if (!PLUMBING.test(record.kind)) v.feed = [...v.feed, record]
		if (/retry/i.test(record.kind)) totals.retries++

		const agent = this.agent(record.agentId, record)
		if (agent) agent.lastMs = record.ms

		switch (record.kind) {
			case "participant.left":
				if (agent) agent.leftMs = record.ms
				break

			case "task.started": {
				const data = record.data as { taskId: string; attempt?: number }
				const task = this.task(data.taskId ?? record.taskId, record)
				// A finished task that starts again (sent back, retried) is open again: it counts once, when it ends.
				const owner = this.agent(task.agentId)
				if (task.status === "done") {
					totals.done--
					if (owner) owner.tasksDone--
				} else if (task.status === "failed") {
					totals.failed--
					if (owner) owner.tasksFailed--
				}
				task.status = "running"
				task.agentId = record.agentId
				task.attempt = data.attempt ?? task.attempt + 1
				task.startMs = record.ms
				task.endMs = undefined
				task.error = undefined
				if (task.attempt > 1) {
					totals.sentBack++
					if (agent) agent.sentBack++
				}
				break
			}
			case "task.completed": {
				const data = record.data as { taskId: string; output?: string }
				const task = this.task(data.taskId ?? record.taskId, record)
				if (task.status !== "done") {
					totals.done++
					if (agent) agent.tasksDone++
				}
				task.status = "done"
				task.output = data.output
				task.endMs = record.ms
				break
			}
			case "task.failed": {
				const data = record.data as { taskId: string; error?: string }
				const task = this.task(data.taskId ?? record.taskId, record)
				if (task.status !== "failed") {
					totals.failed++
					if (agent) agent.tasksFailed++
				}
				task.status = "failed"
				task.error = data.error
				task.endMs = record.ms
				break
			}

			case "inference.started": {
				if (!record.loopId) break
				const loop = this.loop(record.loopId, record)
				loop.inferences.push({ startMs: record.ms, model: record.model })
				totals.inFlight++
				totals.maxInFlight = Math.max(totals.maxInFlight, totals.inFlight)
				this.settle(record.agentId)
				break
			}
			case "inference.dispatched": {
				if (!record.loopId) break
				const loop = this.loop(record.loopId, record)
				const open = loop.inferences.findLast((span) => span.endMs == null)
				if (open) loop.inferences[loop.inferences.indexOf(open)] = { ...open, dispatchedMs: record.ms }
				break
			}
			case "inference.completed": {
				if (!record.loopId) break
				const loop = this.loop(record.loopId, record)
				const open = loop.inferences.findLast((span) => span.endMs == null)
				if (open) {
					loop.inferences[loop.inferences.indexOf(open)] = {
						...open,
						endMs: record.ms,
						tokens: record.tokens?.total,
						costUsd: record.costUsd,
					}
					totals.inFlight = Math.max(0, totals.inFlight - 1)
				}
				const tokens = record.tokens?.total ?? 0
				const cost = record.costUsd ?? 0
				if (record.tokens && record.costUsd == null) totals.costKnown = false
				totals.tokens += tokens
				totals.costUsd += cost
				if (agent) {
					agent.tokens += tokens
					agent.costUsd += cost
				}
				if (record.taskId) {
					const task = this.task(record.taskId, record)
					task.tokens += tokens
					task.costUsd += cost
				}
				this.settle(record.agentId)
				break
			}
			case "function_call.started": {
				if (!record.loopId) break
				const loop = this.loop(record.loopId, record)
				const name = (record.data as { name?: string } | undefined)?.name ?? "tool"
				loop.calls.push({ name, startMs: record.ms })
				this.settle(record.agentId)
				break
			}
			case "function_call.completed": {
				if (!record.loopId) break
				const loop = this.loop(record.loopId, record)
				const open = loop.calls.findLast((call) => call.endMs == null)
				if (open) loop.calls[loop.calls.indexOf(open)] = { ...open, endMs: record.ms }
				this.settle(record.agentId)
				break
			}
			case "model.answer": {
				if (!record.loopId) break
				const loop = this.loop(record.loopId, record)
				if (loop.endMs == null) {
					loop.endMs = record.ms
					if (agent) agent.openLoops = Math.max(0, agent.openLoops - 1)
				}
				this.settle(record.agentId)
				break
			}
			default:
				if (record.loopId && record.kind.startsWith("message_received")) this.loop(record.loopId, record)
		}
	}
}

/** Agents sorted for display: by role order, then by name with numbers in order (profiler-2 before profiler-10). */
export function sortAgents(agents: Iterable<AgentView>): AgentView[] {
	const order: RoleKey[] = ["orchestrator", "analyst", "profiler", "matchmaker", "writer", "scout", "critic", "other"]
	return [...agents].sort(
		(a, b) => order.indexOf(a.role) - order.indexOf(b.role) || a.name.localeCompare(b.name, undefined, { numeric: true }),
	)
}
