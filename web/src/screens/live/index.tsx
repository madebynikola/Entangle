/**
 * `/runs/:id/live`: the Timeline. Agents at work at the same time, live and in replay.
 * Lanes on the left (one per agent, grouped by role), the blackboard filling on the right, and the Critic's
 * rejections flying back to the lane of the agent that has to fix them. Everything follows the playhead.
 */
import { useReducedMotion } from "motion/react"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type * as React from "react"
import { useShallow } from "zustand/react/shallow"
import { useCommands } from "@/components/shell/command-palette"
import { Pane } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty"
import { Segmented } from "@/components/ui/segmented"
import { StatusDot } from "@/components/ui/status"
import * as format from "@/lib/format"
import { sortAgents, type AgentView, type LoopView, type RunView } from "@/run/fold"
import { runClock, useFullView, useResults, useRunClock, useRunStore, useRunView } from "@/run/hooks"
import { Blackboard } from "./blackboard"
import { AgentSheet, MomentDialog } from "./details"
import { axisSpan, derive, FOLLOW_MS, nameLookup, pack, type Moment, type Note } from "./derive"
import { Lanes, MarkPin, type LaneAgent, type LaneStatus } from "./lanes"

export function LiveScreen() {
	const view = useRunView()
	const full = useFullView()
	const { duration, liveRun, active, instant } = useRunStore(
		useShallow((state) => ({
			duration: state.duration,
			liveRun: state.runStatus === "live",
			active: state.mode === "live" || state.playing,
			instant: state.speed === "instant",
		})),
	)
	const { results } = useResults()
	const reduced = useReducedMotion()
	const [follow, setFollow] = useState(false)
	const [agentId, setAgentId] = useState<string | null>(null)
	const [moment, setMoment] = useState<Moment | null>(null)

	const ended = view.endedMs != null
	const derived = useMemo(() => derive(view.feed, ended), [view.feed, ended])
	const nameOf = useMemo(() => nameLookup(results), [results])
	const agents = useMemo(() => sortAgents(full.agents.values()), [full.agents])
	// Tracks come from the whole run, so lanes keep their height while a replay plays.
	const hasDispatch = useMemo(() => [...full.loops.values()].some((loop) => loop.inferences.some((call) => call.dispatchedMs != null)), [full.loops])
	const packing = usePacking(full.loops, hasDispatch)
	const loopsByAgent = useStableGroups(view.loops, (loop: LoopView) => loop.agentId)
	// derive() builds new moments on every fold: a lane's list counts as the same while its keys and actions are.
	const momentsByAgent = useStableGroups(derived.moments, (m: Moment) => m.producerId, (a, b) => a.key === b.key && a.action === b.action)
	const calls = useMemo(() => callsNow(view.loops, hasDispatch), [view.loops, hasDispatch])
	const stopped = useMemo(() => [...view.loops.values()].some((loop) => loop.inferences.some((call) => call.stopped)), [view.loops])
	const notesByAgent = useStableGroups(derived.notes, (n: Note) => n.agentId, (a, b) => a.key === b.key)
	const span = useAxisSpan(duration, liveRun)
	const canFollow = span > FOLLOW_MS * 1.5
	const following = follow && canFollow

	const lanes = useMemo(
		() =>
			agents.map((agent): LaneAgent => {
				const loops = loopsByAgent.get(agent.id) ?? NONE
				const now = view.agents.get(agent.id)
				const pack = packing.get(agent.id)
				return {
					agent,
					now,
					status: statusOf(now, loops, derived.fixTasks, hasDispatch),
					loops,
					track: pack?.track ?? NO_TRACKS,
					tracks: pack?.tracks ?? 1,
					moments: momentsByAgent.get(agent.id) ?? NONE,
					notes: notesByAgent.get(agent.id) ?? NONE,
				}
			}),
		[agents, loopsByAgent, view.agents, packing, derived.fixTasks, hasDispatch, momentsByAgent, notesByAgent],
	)
	const selected = agentId ? lanes.find((lane) => lane.agent.id === agentId) : undefined
	const openMoment = useCallback((m: Moment) => setMoment(m), [])
	const openAgent = useCallback((id: string) => setAgentId(id), [])

	useCommands(
		"timeline",
		canFollow
			? [
					{
						id: following ? "timeline-whole" : "timeline-follow",
						group: "Timeline",
						label: following ? "Show the whole run" : "Follow the playhead",
						run: () => setFollow(!following),
					},
				]
			: [],
	)

	if (agents.length === 0) {
		return (
			<div className="flex min-h-0 flex-col p-5 lg:h-full">
				<EmptyState title={liveRun ? "No agent has joined yet" : "This run has no agents"} className="py-20">
					Each agent gets a lane. A bar is one model call, so bars stacked in time are agents working at the same time.
				</EmptyState>
			</div>
		)
	}

	return (
		<div className="grid gap-4 p-5 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[minmax(0,1fr)]">
			<Pane
				title="Agents at work"
				description="A bar is one model call. Bars at the same time are agents working at once."
				className="h-[36rem] lg:h-auto"
				bodyClassName="@container flex flex-col"
				action={canFollow && <FollowToggle following={following} onChange={setFollow} />}
			>
				<Metrics view={view} calls={calls} rejections={derived.moments.length} duration={duration} liveRun={liveRun} active={active} />
				<Lanes
					lanes={lanes}
					view={view}
					span={span}
					follow={following}
					animate={!reduced && active && !instant}
					pulse={active}
					hasDispatch={hasDispatch}
					moments={derived.moments}
					onAgent={openAgent}
					onMoment={openMoment}
				/>
				<Legend stopped={stopped} />
			</Pane>
			<Pane title="Blackboard" description="The Critic checks each item." className="h-[28rem] lg:h-auto" bodyClassName="flex flex-col">
				<Blackboard postings={derived.postings} nameOf={nameOf} onMoment={openMoment} />
			</Pane>

			<AgentSheet
				agent={selected?.agent ?? null}
				status={selected?.status}
				view={view}
				moments={derived.moments}
				onOpenChange={(open) => !open && setAgentId(null)}
				onMoment={openMoment}
			/>
			<MomentDialog moment={moment} agents={full.agents} onOpenChange={(open) => !open && setMoment(null)} />
		</div>
	)
}

/**
 * Memoized on purpose: Segmented animates with a layout id, and Motion measures layout on every render.
 * The screen re-renders on each frame of a replay; this must not.
 */
const FollowToggle = memo(function FollowToggle({ following, onChange }: { following: boolean; onChange: (follow: boolean) => void }) {
	return (
		<Segmented
			aria-label="Time range"
			value={following ? "follow" : "run"}
			onValueChange={(value) => onChange(value === "follow")}
			items={[
				{ value: "run", label: "Whole run", title: "Fit the whole run in the lanes" },
				{ value: "follow", label: "Follow", title: "Show the two minutes around the playhead" },
			]}
		/>
	)
})

const NONE: never[] = []
const NO_TRACKS = new Map<string, number>()

/** The numbers at the playhead. They tick while a replay plays; the header above has the run's totals. */
function Metrics({
	view,
	calls,
	rejections,
	duration,
	liveRun,
	active,
}: {
	view: RunView
	calls: { flying: number; waiting: number }
	rejections: number
	duration: number
	liveRun: boolean
	active: boolean
}) {
	const clock = useRunClock()
	const { totals } = view
	return (
		<div className="grid shrink-0 grid-cols-3 gap-x-4 gap-y-2 border-b border-hairline px-4 py-2.5 @2xl:grid-cols-6">
			<Metric label="Run time" value={format.clock(clock)} extra={liveRun ? undefined : `/ ${format.clock(duration)}`} />
			<Metric
				label="In flight"
				value={calls.flying}
				dot={calls.flying > 0 ? (active ? "pulse" : "still") : undefined}
				extra={calls.waiting > 0 ? `${calls.waiting} waiting` : undefined}
				title="Model calls out now. Waiting: held back by the rate limits."
			/>
			<Metric label="Tokens" value={format.tokens(totals.tokens)} />
			<Metric label="Cost" value={totals.costUsd > 0 ? `${format.usd(totals.costUsd)}${totals.costKnown ? "" : "+"}` : "—"} />
			<Metric label="Retries" value={totals.retries} title="Model calls tried again after a 429, a 5xx or a network error" />
			<Metric label="Critic rejections" value={rejections} title="Verdicts that sent claims back to be fixed, or dropped them" />
		</div>
	)
}

function Metric({
	label,
	value,
	extra,
	dot,
	title,
}: {
	label: string
	value: React.ReactNode
	extra?: string
	dot?: "pulse" | "still"
	title?: string
}) {
	return (
		<div className="min-w-0" title={title}>
			<div className="truncate text-xs text-ink-muted">{label}</div>
			<div className="tabular mt-0.5 flex items-center gap-1.5 whitespace-nowrap text-base font-medium text-ink">
				{value}
				{dot && <StatusDot tone="working" pulse={dot === "pulse"} className="size-1.5" />}
				{extra && <span className="truncate text-sm font-normal text-ink-subtle">{extra}</span>}
			</div>
		</div>
	)
}

function Legend({ stopped }: { stopped: boolean }) {
	return (
		<div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-hairline px-4 py-2 text-xs text-ink-subtle">
			<span className="inline-flex items-center gap-1.5">
				<span className="h-2 w-4 rounded-[2px] bg-ink-subtle/70" />
				Model call
			</span>
			{stopped && (
				<span className="inline-flex items-center gap-1.5">
					<span className="h-2 w-4 rounded-[2px] bg-ink-subtle/10 ring-1 ring-inset ring-ink-subtle/60" />
					Stopped at run end
				</span>
			)}
			<span className="inline-flex items-center gap-1.5">
				<span className="h-0.5 w-4 rounded-full bg-ink-subtle/50" />
				Waiting for a slot
			</span>
			<span className="inline-flex items-center gap-1.5">
				<span className="size-1.5 rounded-full bg-panel ring-[1.5px] ring-ink-subtle" />
				Tool call
			</span>
			<span className="inline-flex items-center gap-1.5">
				<span className="h-2.5 w-0.5 rounded-full bg-ink-subtle" />
				Event
			</span>
			<span className="inline-flex items-center gap-1.5 text-ink-subtle">
				<MarkPin className="text-needs" />
				Sent back by the Critic
			</span>
			<span className="ml-auto hidden xl:inline">Click for details</span>
		</div>
	)
}

/** Model calls out now, and calls held back by the rate limits (started, not yet sent). */
function callsNow(loops: Map<string, LoopView>, hasDispatch: boolean): { flying: number; waiting: number } {
	let flying = 0
	let waiting = 0
	for (const loop of loops.values()) {
		if (loop.endMs != null) continue
		for (const call of loop.inferences) {
			if (call.endMs != null) continue
			if (!hasDispatch || call.dispatchedMs != null) flying++
			else waiting++
		}
	}
	return { flying, waiting }
}

/** What an agent does at the playhead, in a word, and the task it works on. */
function statusOf(now: AgentView | undefined, loops: LoopView[], fixTasks: Set<string>, hasDispatch: boolean): LaneStatus {
	if (!now) return { tone: "idle", label: "Not started" }
	if (now.activity === "idle") {
		const stopped = loops.some((loop) => loop.inferences.some((call) => call.stopped))
		return { tone: "idle", label: stopped ? "Stopped" : now.leftMs != null ? "Left" : "Idle" }
	}
	const open = loops.filter((loop) => loop.endMs == null)
	const task = now.taskId && open.length > 1 ? `${now.taskId} +${open.length - 1}` : now.taskId
	if (now.taskId && fixTasks.has(now.taskId)) return { tone: "needs", label: "Sent back", task }
	if (now.activity === "tool") return { tone: "info", label: "Tool call", task }
	const waiting =
		hasDispatch &&
		open.length > 0 &&
		open.every((loop) => {
			const call = loop.inferences.at(-1)
			return call != null && call.endMs == null && call.dispatchedMs == null
		})
	if (waiting) return { tone: "idle", label: "Waiting", task }
	return { tone: "working", label: "Thinking", task }
}

/** Pack each agent's loops into tracks. An agent's map is reused while its packing stays the same. */
function usePacking(loops: Map<string, LoopView>, hasDispatch: boolean) {
	const cache = useRef(new Map<string, { track: Map<string, number>; tracks: number }>())
	return useMemo(() => {
		const byAgent = new Map<string, LoopView[]>()
		for (const loop of loops.values()) byAgent.set(loop.agentId, [...(byAgent.get(loop.agentId) ?? []), loop])
		const next = new Map<string, { track: Map<string, number>; tracks: number }>()
		for (const [agentId, list] of byAgent) {
			const packed = pack(list, (loop) => {
				const first = loop.inferences[0]
				return hasDispatch ? first?.dispatchedMs : (first?.startMs ?? loop.startMs)
			})
			const old = cache.current.get(agentId)
			const same = old && old.tracks === packed.tracks && old.track.size === packed.track.size && [...packed.track].every(([id, t]) => old.track.get(id) === t)
			next.set(agentId, same ? old : packed)
		}
		cache.current = next
		return next
	}, [loops, hasDispatch])
}

/** Group items by a key. A group's array is reused while its items are the same, so memoized lanes skip work. */
function useStableGroups<T>(
	items: Iterable<T> | Map<string, T>,
	keyOf: (item: T) => string | undefined,
	same: (a: T, b: T) => boolean = Object.is,
): Map<string, T[]> {
	const cache = useRef(new Map<string, T[]>())
	return useMemo(() => {
		const groups = new Map<string, T[]>()
		const values = items instanceof Map ? items.values() : items
		for (const item of values) {
			const key = keyOf(item)
			if (key == null) continue
			let list = groups.get(key)
			if (!list) groups.set(key, (list = []))
			list.push(item)
		}
		for (const [key, list] of groups) {
			const old = cache.current.get(key)
			if (old && old.length === list.length && old.every((item, i) => same(item, list[i]))) groups.set(key, old)
		}
		cache.current = groups
		return groups
		// keyOf and same are plain functions; the items decide.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [items])
}

/** The axis length, kept in state: it changes when the duration grows or a live run passes a round mark. */
function useAxisSpan(duration: number, liveRun: boolean): number {
	const [span, setSpan] = useState(() => axisSpan(liveRun ? runClock() : 0, duration, liveRun))
	useEffect(() => {
		const update = () => {
			const next = axisSpan(liveRun ? runClock() : 0, duration, liveRun)
			setSpan((prev) => (prev === next ? prev : next))
		}
		update()
		return useRunStore.subscribe(update)
	}, [duration, liveRun])
	return span
}
