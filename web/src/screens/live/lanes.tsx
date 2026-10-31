import { motion } from "motion/react"
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type * as React from "react"
import { RoleFace } from "@/components/ui/face"
import { RoleSquare } from "@/components/ui/role"
import { StatusDot, type StatusTone } from "@/components/ui/status"
import * as format from "@/lib/format"
import { ROLE_INFO, roleColor, type RoleKey } from "@/lib/roles"
import { cn } from "@/lib/utils"
import type { AgentView, LoopView, RunView } from "@/run/fold"
import { MIN_ZOOM_MS, runClock, useRunStore, type TimeRange } from "@/run/hooks"
import { kindLabel, laneGeometry, tickStep, viewWindow, type Moment, type Note } from "./derive"

export type { TimeRange }

/** The part of the axis in view: the zoomed range, else the whole run or the window that follows the playhead. */
function windowOf(now: number, span: number, follow: boolean, zoom: TimeRange | null): { start: number; visible: number } {
	if (zoom) return { start: zoom.start, visible: zoom.end - zoom.start }
	return viewWindow(now, span, follow)
}

/**
 * The swimlanes: one lane per agent, grouped by role. A bar is one model call; a lane splits into tracks when
 * the agent runs several tasks at once. Tool calls are dots, Critic rejections are amber marks on the producer's lane.
 *
 * Speed: React renders the bars when the fold changes. Every frame, `paint` only moves the playhead, grows the
 * open bars and shifts the window. So a run with 50+ agents and thousands of calls stays smooth.
 *
 * Time: drag across the lanes to zoom to a range, ⌘ or pinch scroll to zoom at the pointer, scroll sideways to pan,
 * double-click or Esc for the whole run. A click on a lane (not on a mark) moves the playhead there.
 */

export interface LaneStatus {
	tone: StatusTone
	label: string
	task?: string
}

export interface LaneAgent {
	agent: AgentView
	/** The agent at the playhead; undefined before it joins. */
	now?: AgentView
	status: LaneStatus
	loops: LoopView[]
	track: Map<string, number>
	tracks: number
	moments: Moment[]
	notes: Note[]
}

interface Group {
	role: RoleKey
	lanes: LaneAgent[]
}

export function Lanes({
	lanes,
	view,
	span,
	follow,
	zoom,
	onZoom,
	canSeek,
	animate,
	pulse,
	hasDispatch,
	moments,
	onAgent,
	onMoment,
}: {
	lanes: LaneAgent[]
	view: RunView
	span: number
	follow: boolean
	/** The range in view, or null for the whole run (or the follow window). */
	zoom: TimeRange | null
	onZoom: (range: TimeRange | null) => void
	/** A click on a lane moves the playhead (not while the view tracks a live run). */
	canSeek: boolean
	/** Fly rejected claims (live or playing, not instant, motion allowed). */
	animate: boolean
	/** Pulse the dots of working agents. */
	pulse: boolean
	hasDispatch: boolean
	moments: Moment[]
	onAgent: (id: string) => void
	onMoment: (moment: Moment) => void
}) {
	const rootRef = useRef<HTMLDivElement>(null)
	const trackRef = useRef<HTMLDivElement>(null)
	const playheadRef = useRef<HTMLDivElement>(null)
	const worlds = useRef<HTMLElement[]>([])
	const openBars = useRef<HTMLElement[]>([])
	const groups = useMemo(() => groupLanes(lanes), [lanes])
	const visible = zoom ? zoom.end - zoom.start : follow ? Math.min(span, viewWindow(0, span, true).visible) : span
	const worldWidth = `${(span / visible) * 100}%`

	const paint = useCallback(() => {
		const now = runClock()
		const { start, visible } = windowOf(now, span, follow, zoom)
		const shift = start > 0 ? `translateX(${-(start / span) * 100}%)` : ""
		for (const el of worlds.current) if (el.style.transform !== shift) el.style.transform = shift
		for (const el of openBars.current) {
			const from = Number(el.dataset.open)
			el.style.width = `max(2px, ${(Math.max(0, now - from) / span) * 100}%)`
		}
		// A full-width layer moved by transform: the playhead never triggers layout or a repaint of the lanes.
		const playhead = playheadRef.current
		if (playhead) {
			const at = (now - start) / visible
			playhead.style.transform = `translateX(${Math.min(1, Math.max(0, at)) * 100}%)`
			// Zoomed away from the playhead: hide it rather than pin it to an edge.
			playhead.style.opacity = at < 0 || at > 1 ? "0" : ""
		}
	}, [span, follow, zoom])

	// After each render: find the moving parts again, then paint them once.
	useLayoutEffect(() => {
		const root = rootRef.current
		if (!root) return
		worlds.current = [...root.querySelectorAll<HTMLElement>("[data-world]")]
		openBars.current = [...root.querySelectorAll<HTMLElement>("[data-open]")]
		paint()
	})

	// The store changes every frame while live or playing, and on every seek: paint once per frame.
	useEffect(() => {
		let frame = 0
		const unsubscribe = useRunStore.subscribe(() => {
			if (!frame) frame = requestAnimationFrame(() => {
				frame = 0
				paint()
			})
		})
		return () => {
			unsubscribe()
			cancelAnimationFrame(frame)
		}
	}, [paint])

	const flights = useFlights(moments, rootRef, animate, span, follow, zoom)
	const hover = useHover(rootRef)
	const scrollRef = useRef<HTMLDivElement>(null)
	const dense = useDense(scrollRef, groups)
	const gestures = useTimeGestures({ scrollRef, trackRef, span, follow, zoom, onZoom, canSeek, onDrag: hover.clear })

	return (
		<div
			ref={scrollRef}
			className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
			onScroll={hover.clear}
		>
			<div
				ref={rootRef}
				// Column widths follow the pane, not the window: the sidebar and the blackboard take their share.
				className={cn(
					"relative select-none [--label:8.5rem] [--meta:0px] @lg:[--label:10.5rem] @2xl:[--label:12rem] @2xl:[--meta:4.5rem] @3xl:[--label:13.5rem] @3xl:[--meta:5rem]",
					gestures.brush && "cursor-ew-resize",
				)}
				onPointerOver={(event) => !gestures.brush && hover.onPointerOver(event)}
				onPointerLeave={hover.clear}
				onPointerDown={gestures.onPointerDown}
				onPointerMove={gestures.onPointerMove}
				onPointerUp={gestures.onPointerUp}
				onPointerCancel={gestures.onPointerCancel}
				onDoubleClick={gestures.onDoubleClick}
				onClick={(event) => {
					const key = (event.target as HTMLElement).closest<HTMLElement>("[data-moment]")?.dataset.moment
					const moment = key && moments.find((m) => String(m.key) === key)
					if (moment) onMoment(moment)
				}}
			>
				<Axis span={span} visible={visible} worldWidth={worldWidth} zoom={zoom} />
				{groups.map((group, i) => (
					<Fragment key={group.role}>
						{dense ? (
							i > 0 && <div aria-hidden className="h-1 border-b border-hairline bg-sunken" />
						) : (
							<GroupHeader role={group.role} lanes={group.lanes} />
						)}
						{group.lanes.map((lane) => (
							<Lane
								key={lane.agent.id}
								lane={lane}
								span={span}
								worldWidth={worldWidth}
								dense={dense}
								pulse={pulse}
								hasDispatch={hasDispatch}
								flying={flights.flying}
								onAgent={onAgent}
							/>
						))}
					</Fragment>
				))}
				<div ref={trackRef} className="pointer-events-none absolute inset-y-0 left-[var(--label)] right-[var(--meta)] z-20">
					<div ref={playheadRef} className="absolute inset-0 border-l border-ink/50 will-change-transform" />
					{flights.items.map((flight) => (
						<Flight key={flight.key} flight={flight} onDone={flights.remove} />
					))}
					{gestures.brush && <Brush brush={gestures.brush} span={span} follow={follow} zoom={zoom} />}
				</div>
			</div>
			{hover.target && <HoverInfo target={hover.target} view={view} moments={moments} />}
		</div>
	)
}

/** Dense when the comfortable lanes would not fit the pane's height. */
function useDense(scrollRef: React.RefObject<HTMLDivElement | null>, groups: Group[]): boolean {
	const comfortable = useMemo(
		() => AXIS_HEIGHT + groups.reduce((sum, group) => sum + GROUP_HEIGHT + group.lanes.reduce((h, lane) => h + laneGeometry(lane.tracks).height, 0), 0),
		[groups],
	)
	const [dense, setDense] = useState(false)
	useLayoutEffect(() => {
		const el = scrollRef.current
		if (!el) return
		const check = () => setDense(comfortable > el.clientHeight + 1)
		check()
		const observer = new ResizeObserver(check)
		observer.observe(el)
		return () => observer.disconnect()
	}, [scrollRef, comfortable])
	return dense
}

const AXIS_HEIGHT = 32
const GROUP_HEIGHT = 32

function groupLanes(lanes: LaneAgent[]): Group[] {
	const groups: Group[] = []
	for (const lane of lanes) {
		const last = groups.at(-1)
		if (last?.role === lane.agent.role) last.lanes.push(lane)
		else groups.push({ role: lane.agent.role, lanes: [lane] })
	}
	return groups
}

const ROW = "grid grid-cols-[var(--label)_minmax(0,1fr)_var(--meta)]"

function Axis({ span, visible, worldWidth, zoom }: { span: number; visible: number; worldWidth: string; zoom: TimeRange | null }) {
	// One label per 72 px of track, so labels never run into each other.
	const [width, setWidth] = useState(600)
	const trackRef = useRef<HTMLDivElement>(null)
	useLayoutEffect(() => {
		const el = trackRef.current
		if (!el) return
		const observer = new ResizeObserver(() => setWidth(el.clientWidth))
		observer.observe(el)
		return () => observer.disconnect()
	}, [])
	const step = tickStep(visible, Math.max(2, Math.floor(width / 72)))
	// Zoomed, only the ticks in view: a 15 s range of an hour-long run would otherwise draw hundreds.
	const from = zoom ? Math.floor(zoom.start / step) * step : 0
	const to = zoom ? Math.min(span, zoom.end + step) : span
	// Where a tick sits in view, 0..1: labels near an edge are aligned inwards.
	const at = (ms: number) => (zoom ? (ms - zoom.start) / visible : ms / span)
	const ticks: number[] = []
	// A tick just outside a zoomed range would be pulled into view by that alignment: leave it out.
	for (let ms = from; ms <= to; ms += step) if (!zoom || (at(ms) >= 0 && at(ms) <= 1)) ticks.push(ms)
	return (
		<div className={cn(ROW, "sticky top-0 z-10 h-8 border-b border-hairline bg-card text-xs text-ink-subtle")}>
			<div className="flex items-center px-4">Agent</div>
			<div ref={trackRef} className="relative overflow-hidden border-l border-hairline [contain:strict]">
				<div data-world className="absolute inset-y-0 left-0" style={{ width: worldWidth }}>
					{ticks.map((ms) => (
						<span
							key={ms}
							className={cn(
								"tabular absolute top-1/2 -translate-y-1/2 whitespace-nowrap",
								at(ms) < 0.03 ? "pl-2" : at(ms) > 0.96 ? "-translate-x-full pr-2" : "-translate-x-1/2",
							)}
							style={{ left: `${(ms / span) * 100}%` }}
						>
							{format.clock(ms)}
						</span>
					))}
				</div>
			</div>
			<div className="hidden items-center justify-end px-4 @2xl:flex">Tokens</div>
		</div>
	)
}

function GroupHeader({ role, lanes }: { role: RoleKey; lanes: LaneAgent[] }) {
	const working = lanes.filter((lane) => lane.now && lane.now.activity !== "idle").length
	const info = ROLE_INFO[role]
	return (
		<div className="flex h-8 items-center gap-2 border-b border-hairline bg-sunken/60 pl-3 pr-4 text-xs">
			<RoleFace role={role} state={working > 0 ? "working" : "idle"} className="size-5" />
			{info.name && <span className="font-semibold text-ink">{info.name}</span>}
			<span className={info.name ? "text-ink-muted" : "font-medium text-ink"}>{lanes.length > 1 ? info.plural : info.label}</span>
			{lanes.length > 1 && <span className="tabular text-ink-subtle">{lanes.length}</span>}
			{working > 0 && <span className="tabular text-ink-muted">{working} working</span>}
			{info.job && <span className="ml-auto hidden truncate text-ink-subtle md:block">{info.job}</span>}
		</div>
	)
}

interface LaneProps {
	lane: LaneAgent
	span: number
	worldWidth: string
	/** One-line label and thin bars, so more lanes fit. */
	dense: boolean
	pulse: boolean
	hasDispatch: boolean
	/** Moments whose claim is still in the air: their mark shows when it lands. */
	flying: Set<number>
	onAgent: (id: string) => void
}

/**
 * One agent's lane. Every event of the agent gives it a new AgentView, so the lane itself re-renders often;
 * its parts are memoized on what they show, and a re-render touches only the part that changed.
 */
const Lane = memo(function Lane({ lane, span, worldWidth, dense, pulse, hasDispatch, flying, onAgent }: LaneProps) {
	const { agent, now, status, loops, track, tracks, moments, notes } = lane
	const geometry = laneGeometry(tracks, dense)
	const color = roleColor(agent.role)
	const busy = status.tone !== "idle"

	return (
		<div data-lane={agent.id} className={cn(ROW, "border-b border-hairline last:border-b-0")} style={{ height: geometry.height }}>
			<LaneLabel
				id={agent.id}
				name={agent.name}
				role={agent.role}
				joined={now != null}
				status={status.label}
				tone={status.tone}
				task={status.task}
				dense={dense}
				pulse={pulse && busy}
				onAgent={onAgent}
			/>
			<div className="relative overflow-hidden border-l border-hairline [contain:strict]">
				<div data-world className="absolute inset-y-0 left-0" style={{ width: worldWidth }}>
					{hasDispatch && <WaitBand loops={loops} span={span} bottom={dense ? 1 : 3} color={color} />}
					<LaneBars loops={loops} track={track} top={geometry.top} pitch={geometry.pitch} bar={geometry.bar} span={span} color={color} hasDispatch={hasDispatch} />
					<LaneNotes notes={notes} span={span} />
					<LaneMarks moments={moments} span={span} flying={flying} />
				</div>
			</div>
			<LaneTokens tokens={now?.tokens ?? 0} cost={now?.costUsd ?? 0} busy={busy} dense={dense} />
		</div>
	)
}, sameLaneProps)

const LaneLabel = memo(function LaneLabel({
	id,
	name,
	role,
	joined,
	status,
	tone,
	task,
	dense,
	pulse,
	onAgent,
}: {
	id: string
	name: string
	role: RoleKey
	joined: boolean
	status: string
	tone: StatusTone
	task?: string
	dense: boolean
	pulse: boolean
	onAgent: (id: string) => void
}) {
	if (dense) {
		return (
			<button
				type="button"
				onClick={() => onAgent(id)}
				title={task ? `${status}: ${task}` : status}
				className="flex h-6 min-w-0 items-center gap-2 px-4 text-left text-xs outline-none transition-colors duration-150 hover:bg-hover focus-visible:bg-hover"
			>
				<RoleSquare role={role} />
				<span className={cn("min-w-0 flex-1 truncate text-sm", joined ? "text-ink" : "text-ink-subtle")}>{name}</span>
				<StatusDot tone={tone} pulse={pulse} className="size-1.5" />
				<span className="hidden w-16 shrink-0 truncate text-ink-muted @lg:block">{status}</span>
			</button>
		)
	}
	return (
		<button
			type="button"
			onClick={() => onAgent(id)}
			className="flex h-11 min-w-0 flex-col justify-center gap-0.5 px-4 text-left outline-none transition-colors duration-150 hover:bg-hover focus-visible:bg-hover"
		>
			<span className={cn("truncate text-sm", joined ? "text-ink" : "text-ink-subtle")}>{name}</span>
			<span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-muted">
				<StatusDot tone={tone} pulse={pulse} className="size-1.5" />
				<span className="shrink-0">{status}</span>
				{task && <span className="truncate font-mono text-2xs text-ink-subtle">{task}</span>}
			</span>
		</button>
	)
})

const LaneTokens = memo(function LaneTokens({ tokens, cost, busy, dense }: { tokens: number; cost: number; busy: boolean; dense: boolean }) {
	return (
		<div className={cn("tabular hidden flex-col items-end justify-center self-start px-4 text-xs @2xl:flex", dense ? "h-6" : "h-11")}>
			<span className={cn(busy ? "text-ink" : "text-ink-muted")}>{tokens ? format.tokens(tokens) : "—"}</span>
			{!dense && cost > 0 && <span className="text-ink-subtle">{format.usd(cost)}</span>}
		</div>
	)
})

/** The rate-limit waits of the lane, as one thin band under its bars. */
const WaitBand = memo(function WaitBand({ loops, span, bottom, color }: { loops: LoopView[]; span: number; bottom: number; color: string }) {
	return waits(loops).map(([from, to]) => (
		<div
			key={from}
			data-open={to == null ? from : undefined}
			className="absolute h-0.5 rounded-full"
			style={{
				left: `${(from / span) * 100}%`,
				bottom,
				width: to == null ? undefined : `${((to - from) / span) * 100}%`,
				background: `color-mix(in oklab, ${color} 40%, transparent)`,
			}}
		/>
	))
})

const LaneBars = memo(function LaneBars({
	loops,
	track,
	top,
	pitch,
	bar,
	span,
	color,
	hasDispatch,
}: {
	loops: LoopView[]
	track: Map<string, number>
	top: number
	pitch: number
	bar: number
	span: number
	color: string
	hasDispatch: boolean
}) {
	return loops.map((loop) => (
		<LoopBars key={loop.id} loop={loop} top={top + (track.get(loop.id) ?? 0) * pitch} bar={bar} span={span} color={color} hasDispatch={hasDispatch} />
	))
})

/** Steps without a model call, as small ticks: the Orchestrator handing out work, a shortlist landing. */
const LaneNotes = memo(function LaneNotes({ notes, span }: { notes: Note[]; span: number }) {
	return notes.map((note) => (
		<span
			key={note.key}
			data-note={note.text}
			className="absolute top-1/2 h-2.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-subtle"
			style={{ left: `${(note.ms / span) * 100}%` }}
		/>
	))
})

/** The Critic's rejections on the producer's lane. A mark stays hidden while its claim is in the air. */
const LaneMarks = memo(function LaneMarks({ moments, span, flying }: { moments: Moment[]; span: number; flying: Set<number> }) {
	return moments.map((moment) => (
		<button
			key={moment.key}
			type="button"
			data-moment={moment.key}
			aria-label={`${actionLabel(moment)}: ${kindLabel(moment.kind)} ${moment.id}`}
			className={cn(
				"group/mark absolute top-0 flex h-2.5 w-3 -translate-x-1/2 justify-center outline-none transition-opacity duration-200",
				moment.action === "send-back" ? "text-needs" : "text-failed",
				flying.has(moment.key) && "opacity-0",
			)}
			style={{ left: `${(moment.ms / span) * 100}%` }}
		>
			<MarkPin className="mt-px transition-transform duration-150 group-hover/mark:scale-125 group-focus-visible/mark:scale-125" />
		</button>
	))
})

/**
 * The bars and tool dots of one loop. Memoized on the loop: the fold replaces a loop object only when it changes,
 * so a new event re-renders one loop, not the whole lane.
 */
const LoopBars = memo(function LoopBars({
	loop,
	top,
	bar,
	span,
	color,
	hasDispatch,
}: {
	loop: LoopView
	top: number
	bar: number
	span: number
	color: string
	hasDispatch: boolean
}) {
	const pct = (ms: number) => `${(ms / span) * 100}%`
	const mid = top + bar / 2
	return (
		<>
			{loop.inferences.map((call, i) => {
				const start = call.dispatchedMs ?? (hasDispatch ? undefined : call.startMs)
				if (start == null) return null
				const open = call.endMs == null
				return (
					<div
						key={`c${i}`}
						data-span={`${loop.id}:${i}`}
						data-open={open ? start : undefined}
						data-stopped={call.stopped || undefined}
						className="absolute rounded-[2px]"
						style={{
							left: pct(start),
							top,
							height: bar,
							width: open ? undefined : `max(2px, ${pct(call.endMs! - start)})`,
							// Stopped (still open when the run ended): hollow, so it reads as a call that never answered.
							background: open ? color : call.stopped ? `color-mix(in oklab, ${color} 16%, transparent)` : `color-mix(in oklab, ${color} 72%, transparent)`,
							boxShadow: call.stopped ? `inset 0 0 0 1px color-mix(in oklab, ${color} 60%, transparent)` : undefined,
						}}
					/>
				)
			})}
			{loop.calls.map((call, i) => (
				<span
					key={`t${i}`}
					data-tool={`${loop.id}:${i}`}
					className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-panel"
					style={{ left: pct(call.startMs), top: mid, boxShadow: `0 0 0 1.5px ${color}` }}
				/>
			))}
		</>
	)
})

/**
 * When the agent had calls held back by the rate limits: the waits of all its calls, merged.
 * A wait that has not ended has no end (it grows with the playhead).
 */
function waits(loops: LoopView[]): [number, number | undefined][] {
	const spans: [number, number][] = []
	for (const loop of loops) {
		for (const call of loop.inferences) {
			const end = call.dispatchedMs ?? call.endMs ?? Infinity
			if (end - call.startMs > 250) spans.push([call.startMs, end])
		}
	}
	spans.sort((a, b) => a[0] - b[0])
	const merged: [number, number][] = []
	for (const span of spans) {
		const last = merged.at(-1)
		if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1])
		else merged.push([...span])
	}
	return merged.map(([from, to]) => [from, Number.isFinite(to) ? to : undefined])
}

/** The parent builds lane objects on every fold, so compare what a lane draws. */
function sameLaneProps(a: LaneProps, b: LaneProps): boolean {
	const x = a.lane
	const y = b.lane
	return (
		a.span === b.span &&
		a.worldWidth === b.worldWidth &&
		a.dense === b.dense &&
		a.pulse === b.pulse &&
		a.hasDispatch === b.hasDispatch &&
		a.flying === b.flying &&
		a.onAgent === b.onAgent &&
		x.agent === y.agent &&
		x.now === y.now &&
		x.loops === y.loops &&
		x.track === y.track &&
		x.tracks === y.tracks &&
		x.moments === y.moments &&
		x.notes === y.notes &&
		x.status.tone === y.status.tone &&
		x.status.label === y.status.label &&
		x.status.task === y.status.task
	)
}

/** A Critic moment on a lane: a small pin at the top edge, apart from the bars of any role. */
export function MarkPin({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 10 8" aria-hidden className={cn("h-2 w-2.5 origin-top overflow-visible", className)}>
			<path d="M1 1h8L5 7z" fill="currentColor" stroke="var(--card)" strokeWidth="1.5" strokeLinejoin="round" paintOrder="stroke" />
		</svg>
	)
}

export function actionLabel(moment: Moment): string {
	if (moment.action === "drop") return "Dropped"
	if (moment.action === "human-review") return "Left for a person"
	return "Sent back"
}

// ---------------------------------------------------------------------------
// Zoom and pan: the gestures on the track column, and the range being dragged.
// ---------------------------------------------------------------------------

/** A drag shorter than this is a click. */
const DRAG_PX = 4

interface Drag {
	pointer: number
	x: number
	from: number
	moved: boolean
}

function useTimeGestures({
	scrollRef,
	trackRef,
	span,
	follow,
	zoom,
	onZoom,
	canSeek,
	onDrag,
}: {
	scrollRef: React.RefObject<HTMLDivElement | null>
	trackRef: React.RefObject<HTMLDivElement | null>
	span: number
	follow: boolean
	zoom: TimeRange | null
	onZoom: (range: TimeRange | null) => void
	canSeek: boolean
	onDrag: () => void
}) {
	const [brush, setBrush] = useState<TimeRange | null>(null)
	const drag = useRef<Drag | null>(null)
	// The wheel and key listeners are added once; they read the current values here.
	const latest = useRef({ span, follow, zoom, onZoom })
	useEffect(() => {
		latest.current = { span, follow, zoom, onZoom }
	})

	/** The run ms under a pointer, or null when it is not over the track column. */
	const msAt = useCallback(
		(clientX: number, clamp = false): number | null => {
			const box = trackRef.current?.getBoundingClientRect()
			if (!box || box.width === 0) return null
			let frac = (clientX - box.left) / box.width
			if (frac < 0 || frac > 1) {
				if (!clamp) return null
				frac = Math.min(1, Math.max(0, frac))
			}
			const { span, follow, zoom } = latest.current
			const { start, visible } = windowOf(runClock(), span, follow, zoom)
			return start + frac * visible
		},
		[trackRef],
	)

	const onPointerDown = useCallback(
		(event: React.PointerEvent) => {
			if (event.button !== 0 || !event.isPrimary) return
			// Agent names and Critic marks are buttons with their own click.
			if ((event.target as HTMLElement).closest("button")) return
			const from = msAt(event.clientX)
			if (from == null) return
			drag.current = { pointer: event.pointerId, x: event.clientX, from, moved: false }
		},
		[msAt],
	)

	const onPointerMove = useCallback(
		(event: React.PointerEvent) => {
			const d = drag.current
			if (!d || d.pointer !== event.pointerId) return
			if (!d.moved) {
				if (Math.abs(event.clientX - d.x) < DRAG_PX) return
				d.moved = true
				;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
				onDrag()
			}
			const to = msAt(event.clientX, true)
			if (to != null) setBrush({ start: Math.min(d.from, to), end: Math.max(d.from, to) })
		},
		[msAt, onDrag],
	)

	const onPointerUp = useCallback(
		(event: React.PointerEvent) => {
			const d = drag.current
			drag.current = null
			if (!d || d.pointer !== event.pointerId) return
			if (!d.moved) {
				if (canSeek) useRunStore.getState().seek(d.from)
				return
			}
			setBrush(null)
			const to = msAt(event.clientX, true)
			if (to == null) return
			onZoom(fitRange(Math.min(d.from, to), Math.max(d.from, to), latest.current.span))
		},
		[msAt, canSeek, onZoom],
	)

	const onPointerCancel = useCallback(() => {
		drag.current = null
		setBrush(null)
	}, [])

	const onDoubleClick = useCallback(
		(event: React.MouseEvent) => {
			if (latest.current.zoom && msAt(event.clientX) != null) onZoom(null)
		},
		[msAt, onZoom],
	)

	// ⌘ or Ctrl + scroll, and trackpad pinch (a wheel event with ctrlKey), zoom at the pointer.
	// Sideways scroll (or Shift + scroll) pans a zoomed view. Plain scroll still scrolls the lanes.
	useEffect(() => {
		const el = scrollRef.current
		if (!el) return
		const onWheel = (event: WheelEvent) => {
			const box = trackRef.current?.getBoundingClientRect()
			if (!box || event.clientX < box.left || event.clientX > box.right) return
			const { span, follow, zoom, onZoom } = latest.current
			const { start, visible } = windowOf(runClock(), span, follow, zoom)
			const unit = event.deltaMode === 1 ? 16 : 1
			if (event.ctrlKey || event.metaKey) {
				event.preventDefault()
				const frac = (event.clientX - box.left) / box.width
				const anchor = start + frac * visible
				const delta = Math.min(50, Math.max(-50, event.deltaY * unit))
				const next = Math.max(MIN_ZOOM_MS, visible * Math.exp(delta * 0.01))
				if (next >= span) return onZoom(null)
				const from = Math.min(span - next, Math.max(0, anchor - frac * next))
				onZoom({ start: from, end: from + next })
				return
			}
			const sideways = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX
			if (!zoom || sideways === 0 || (!event.shiftKey && Math.abs(event.deltaX) <= Math.abs(event.deltaY))) return
			event.preventDefault()
			const from = Math.min(span - visible, Math.max(0, start + ((sideways * unit) / box.width) * visible))
			if (from !== start) onZoom({ start: from, end: from + visible })
		}
		el.addEventListener("wheel", onWheel, { passive: false })
		return () => el.removeEventListener("wheel", onWheel)
	}, [scrollRef, trackRef])

	// Esc goes back to the whole run, unless a dialog or sheet is open and Esc is closing it.
	useEffect(() => {
		if (!zoom) return
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented || document.querySelector("[role=dialog]")) return
			latest.current.onZoom(null)
		}
		window.addEventListener("keydown", onKey)
		return () => window.removeEventListener("keydown", onKey)
	}, [zoom])

	return { brush, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onDoubleClick }
}

/** A dragged range, at least MIN_ZOOM_MS long and inside the run. The whole run (or more) is no zoom. */
function fitRange(start: number, end: number, span: number): TimeRange | null {
	const length = Math.max(MIN_ZOOM_MS, end - start)
	if (length >= span) return null
	const from = Math.min(span - length, Math.max(0, (start + end) / 2 - length / 2))
	return { start: from, end: from + length }
}

/** The range being dragged, with its times. */
function Brush({ brush, span, follow, zoom }: { brush: TimeRange; span: number; follow: boolean; zoom: TimeRange | null }) {
	const { start, visible } = windowOf(runClock(), span, follow, zoom)
	const left = (brush.start - start) / visible
	const width = (brush.end - brush.start) / visible
	return (
		<div className="absolute inset-y-0 border-x border-ink/40 bg-ink/[0.06]" style={{ left: `${left * 100}%`, width: `${width * 100}%` }}>
			<span className="tabular absolute left-1/2 top-1.5 -translate-x-1/2 whitespace-nowrap rounded-sm bg-ink px-1.5 py-0.5 text-xs text-panel">
				{format.clock(brush.start)} – {format.clock(brush.end)}
			</span>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Critic moments in flight: the rejected claim, struck through, flies from the Critic's lane to its producer's.
// ---------------------------------------------------------------------------

interface FlightItem {
	key: number
	/** 0..1 across the track column. */
	x: number
	from: number
	to: number
	text: string
	more: number
}

function useFlights(
	moments: Moment[],
	rootRef: React.RefObject<HTMLDivElement | null>,
	animate: boolean,
	span: number,
	follow: boolean,
	zoom: TimeRange | null,
) {
	const [items, setItems] = useState<FlightItem[]>([])
	const seen = useRef(moments.at(-1)?.key ?? -1)

	useEffect(() => {
		const last = moments.at(-1)?.key ?? -1
		const fresh = moments.filter((moment) => moment.key > seen.current)
		seen.current = last
		// Many at once means a seek or a skip, not a moment to watch.
		if (!animate || fresh.length === 0 || fresh.length > 4) return
		const root = rootRef.current
		if (!root) return
		const now = runClock()
		const { start, visible } = windowOf(now, span, follow, zoom)
		const lane = (id?: string) => (id ? root.querySelector<HTMLElement>(`[data-lane="${CSS.escape(id)}"]`) : null)
		const next = fresh.flatMap((moment): FlightItem[] => {
			const critic = lane(moment.criticId)
			const producer = lane(moment.producerId)
			// From the middle of the Critic's lane to the pin at the top of the producer's.
			const from = critic ? critic.offsetTop + critic.offsetHeight / 2 : null
			const to = producer ? producer.offsetTop + 6 : null
			if (from == null || to == null) return []
			const x = (moment.ms - start) / visible
			// Zoomed to another part of the run: nothing to watch here.
			if (zoom && (x < 0 || x > 1)) return []
			const first = moment.rejected[0]?.claim.text
			return [
				{
					key: moment.key,
					x: Math.min(1, Math.max(0, x)),
					from,
					to,
					text: first ?? `${kindLabel(moment.kind)} ${moment.id}`,
					more: Math.max(0, moment.rejected.length - 1),
				},
			]
		})
		if (next.length) setItems((prev) => [...prev, ...next].slice(-3))
		// Only new moments matter; the geometry is read when they arrive.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [moments])

	const remove = useCallback((key: number) => setItems((prev) => prev.filter((item) => item.key !== key)), [])
	const flying = useMemo(() => new Set(items.map((item) => item.key)), [items])
	return { items, flying, remove }
}

function Flight({ flight, onDone }: { flight: FlightItem; onDone: (key: number) => void }) {
	const right = flight.x > 0.55
	return (
		<motion.div
			className="absolute top-0"
			style={{ left: `${flight.x * 100}%` }}
			initial={{ y: flight.from, opacity: 0, scale: 0.94 }}
			animate={{ y: [flight.from, flight.from, flight.to, flight.to], opacity: [0, 1, 1, 0], scale: [0.94, 1, 1, 0.7] }}
			transition={{ duration: 1.3, times: [0, 0.32, 0.82, 1], ease: [0.4, 0, 0.2, 1] }}
			onAnimationComplete={() => onDone(flight.key)}
		>
			<div
				className={cn(
					"flex h-6 max-w-[17rem] -translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border border-needs/50 bg-panel px-2.5 text-xs shadow-float",
					right ? "-translate-x-[calc(100%_+_10px)]" : "translate-x-[10px]",
				)}
			>
				<span className="relative min-w-0 truncate text-ink-muted">
					{flight.text}
					<motion.span
						aria-hidden
						className="absolute inset-x-0 top-1/2 h-px origin-left bg-failed"
						initial={{ scaleX: 0 }}
						animate={{ scaleX: 1 }}
						transition={{ delay: 0.14, duration: 0.26, ease: "easeOut" }}
					/>
				</span>
				{flight.more > 0 && <span className="tabular shrink-0 text-ink-subtle">+{flight.more}</span>}
			</div>
		</motion.div>
	)
}

// ---------------------------------------------------------------------------
// One hover card for every bar, dot and mark (delegated), instead of a tooltip per element.
// ---------------------------------------------------------------------------

interface HoverTarget {
	kind: "span" | "tool" | "moment" | "note"
	ref: string
	x: number
	y: number
}

function useHover(rootRef: React.RefObject<HTMLDivElement | null>) {
	const [target, setTarget] = useState<HoverTarget | null>(null)
	const onPointerOver = useCallback((event: React.PointerEvent) => {
		const el = (event.target as HTMLElement).closest<HTMLElement>("[data-span],[data-tool],[data-moment],[data-note]")
		if (!el || !rootRef.current?.contains(el)) return setTarget(null)
		const box = el.getBoundingClientRect()
		const kind = el.dataset.moment != null ? "moment" : el.dataset.note != null ? "note" : el.dataset.tool != null ? "tool" : "span"
		const ref = el.dataset.moment ?? el.dataset.note ?? el.dataset.tool ?? el.dataset.span ?? ""
		setTarget((prev) => (prev?.ref === ref && prev.kind === kind ? prev : { kind, ref, x: event.clientX, y: box.top }))
	}, [rootRef])
	const clear = useCallback(() => setTarget(null), [])
	return { target, onPointerOver, clear }
}

function HoverInfo({ target, view, moments }: { target: HoverTarget; view: RunView; moments: Moment[] }) {
	let title: React.ReactNode = null
	let lines: React.ReactNode[] = []
	if (target.kind === "note") {
		title = target.ref
	} else if (target.kind === "moment") {
		const moment = moments.find((m) => String(m.key) === target.ref)
		if (!moment) return null
		title = `${actionLabel(moment)} by the Critic`
		lines = [`${kindLabel(moment.kind)} ${moment.id}`, `${format.plural(moment.rejected.length, "claim")} rejected · click to see why`]
	} else {
		const [loopId, index] = target.ref.split(":")
		const loop = view.loops.get(loopId)
		if (!loop) return null
		if (target.kind === "tool") {
			const call = loop.calls[Number(index)]
			if (!call) return null
			title = call.name
			lines = [
				call.endMs == null ? "running" : `${call.stopped ? "stopped at run end after " : ""}${format.duration(call.endMs - call.startMs)}`,
				loop.taskId ?? "",
			]
		} else {
			const call = loop.inferences[Number(index)]
			if (!call) return null
			const start = call.dispatchedMs ?? call.startMs
			const wait = call.dispatchedMs != null ? call.dispatchedMs - call.startMs : 0
			title = loop.taskId ?? "Model call"
			lines = [
				[
					call.model ?? loop.model,
					call.endMs == null ? "in flight" : call.stopped ? `no answer, stopped at run end after ${format.duration(call.endMs - start)}` : format.duration(call.endMs - start),
				]
					.filter(Boolean)
					.join(" · "),
				call.tokens ? `${format.tokens(call.tokens)} tokens${call.costUsd ? ` · ${format.usd(call.costUsd)}` : ""}` : "",
				wait > 250 ? `waited ${format.duration(wait)} for a free slot` : "",
			]
		}
	}
	return (
		<div
			className="pointer-events-none fixed z-50 max-w-72 -translate-x-1/2 -translate-y-[calc(100%+8px)] rounded-sm bg-ink px-2 py-1 text-sm text-panel animate-fade-in"
			style={{ left: target.x, top: target.y }}
		>
			<div className="font-medium">{title}</div>
			{lines.filter(Boolean).map((line, i) => (
				<div key={i} className="tabular text-xs opacity-75">
					{line}
				</div>
			))}
		</div>
	)
}
