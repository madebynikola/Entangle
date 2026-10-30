import { motion } from "motion/react"
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type * as React from "react"
import { RoleSquare } from "@/components/ui/role"
import { StatusDot, type StatusTone } from "@/components/ui/status"
import * as format from "@/lib/format"
import { ROLE_INFO, roleColor, type RoleKey } from "@/lib/roles"
import { cn } from "@/lib/utils"
import type { AgentView, LoopView, RunView } from "@/run/fold"
import { runClock, useRunStore } from "@/run/hooks"
import { kindLabel, laneGeometry, tickStep, viewWindow, type Moment } from "./derive"

/**
 * The swimlanes: one lane per agent, grouped by role. A bar is one model call; a lane splits into tracks when
 * the agent runs several tasks at once. Tool calls are dots, Critic rejections are amber marks on the producer's lane.
 *
 * Speed: React renders the bars when the fold changes. Every frame, `paint` only moves the playhead, grows the
 * open bars and shifts the window. So a run with 50+ agents and thousands of calls stays smooth.
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
	const playheadRef = useRef<HTMLDivElement>(null)
	const worlds = useRef<HTMLElement[]>([])
	const openBars = useRef<HTMLElement[]>([])
	const groups = useMemo(() => groupLanes(lanes), [lanes])
	const visible = follow ? Math.min(span, viewWindow(0, span, true).visible) : span
	const worldWidth = `${(span / visible) * 100}%`

	const paint = useCallback(() => {
		const now = runClock()
		const { start, visible } = viewWindow(now, span, follow)
		const shift = start > 0 ? `translateX(${-(start / span) * 100}%)` : ""
		for (const el of worlds.current) if (el.style.transform !== shift) el.style.transform = shift
		for (const el of openBars.current) {
			const from = Number(el.dataset.open)
			el.style.width = `max(2px, ${(Math.max(0, now - from) / span) * 100}%)`
		}
		if (playheadRef.current) playheadRef.current.style.left = `${Math.min(1, Math.max(0, (now - start) / visible)) * 100}%`
	}, [span, follow])

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

	const flights = useFlights(moments, rootRef, animate, span, follow)
	const hover = useHover(rootRef)
	const scrollRef = useRef<HTMLDivElement>(null)
	const dense = useDense(scrollRef, groups)

	return (
		<div
			ref={scrollRef}
			className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
			onScroll={hover.clear}
		>
			<div
				ref={rootRef}
				className="relative [--label:9.5rem] [--meta:0px] sm:[--label:13.5rem] sm:[--meta:5rem]"
				onPointerOver={hover.onPointerOver}
				onPointerLeave={hover.clear}
				onClick={(event) => {
					const key = (event.target as HTMLElement).closest<HTMLElement>("[data-moment]")?.dataset.moment
					const moment = key && moments.find((m) => String(m.key) === key)
					if (moment) onMoment(moment)
				}}
			>
				<Axis span={span} visible={visible} worldWidth={worldWidth} />
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
				<div className="pointer-events-none absolute inset-y-0 left-[var(--label)] right-[var(--meta)] z-20">
					<div ref={playheadRef} className="absolute inset-y-0 w-px bg-ink/50" />
					{flights.items.map((flight) => (
						<Flight key={flight.key} flight={flight} onDone={flights.remove} />
					))}
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

function Axis({ span, visible, worldWidth }: { span: number; visible: number; worldWidth: string }) {
	const step = tickStep(visible)
	const ticks: number[] = []
	for (let ms = 0; ms <= span; ms += step) ticks.push(ms)
	return (
		<div className={cn(ROW, "sticky top-0 z-10 h-8 border-b border-hairline bg-card text-xs text-ink-subtle")}>
			<div className="flex items-center px-4">Agent</div>
			<div className="relative overflow-hidden border-l border-hairline">
				<div data-world className="absolute inset-y-0 left-0" style={{ width: worldWidth }}>
					{ticks.map((ms) => (
						<span
							key={ms}
							className={cn("tabular absolute top-1/2 -translate-y-1/2 whitespace-nowrap", ms === 0 ? "pl-2" : "-translate-x-1/2")}
							style={{ left: `${(ms / span) * 100}%` }}
						>
							{format.clock(ms)}
						</span>
					))}
				</div>
			</div>
			<div className="hidden items-center justify-end px-4 sm:flex">Tokens</div>
		</div>
	)
}

function GroupHeader({ role, lanes }: { role: RoleKey; lanes: LaneAgent[] }) {
	const working = lanes.filter((lane) => lane.now && lane.now.activity !== "idle").length
	const info = ROLE_INFO[role]
	return (
		<div className="flex h-8 items-center gap-2 border-b border-hairline bg-sunken/60 px-4 text-xs">
			<RoleSquare role={role} />
			<span className="font-medium text-ink">{lanes.length > 1 ? info.plural : info.label}</span>
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

const Lane = memo(function Lane({ lane, span, worldWidth, dense, pulse, hasDispatch, flying, onAgent }: LaneProps) {
	const { agent, now, status, loops, track, tracks, moments } = lane
	const geometry = laneGeometry(tracks, dense)
	const color = roleColor(agent.role)
	const pct = (ms: number) => `${(ms / span) * 100}%`
	const busy = status.tone !== "idle"

	return (
		<div data-lane={agent.id} className={cn(ROW, "border-b border-hairline last:border-b-0")} style={{ height: geometry.height }}>
			{dense ? (
				<button
					type="button"
					onClick={() => onAgent(agent.id)}
					title={status.task ? `${status.label}: ${status.task}` : status.label}
					className="flex h-6 min-w-0 items-center gap-2 px-4 text-left text-xs outline-none transition-colors duration-150 hover:bg-hover focus-visible:bg-hover"
				>
					<RoleSquare role={agent.role} />
					<span className={cn("min-w-0 flex-1 truncate text-sm", now ? "text-ink" : "text-ink-subtle")}>{agent.name}</span>
					<StatusDot tone={status.tone} pulse={pulse && busy} className="size-1.5" />
					<span className="hidden w-16 shrink-0 truncate text-ink-muted sm:block">{status.label}</span>
				</button>
			) : (
				<button
					type="button"
					onClick={() => onAgent(agent.id)}
					className="flex h-11 min-w-0 flex-col justify-center gap-0.5 px-4 text-left outline-none transition-colors duration-150 hover:bg-hover focus-visible:bg-hover"
				>
					<span className={cn("truncate text-sm", now ? "text-ink" : "text-ink-subtle")}>{agent.name}</span>
					<span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-muted">
						<StatusDot tone={status.tone} pulse={pulse && busy} className="size-1.5" />
						<span className="shrink-0">{status.label}</span>
						{status.task && <span className="truncate font-mono text-2xs text-ink-subtle">{status.task}</span>}
					</span>
				</button>
			)}

			<div className="relative overflow-hidden border-l border-hairline">
				<div data-world className="absolute inset-y-0 left-0" style={{ width: worldWidth }}>
					{hasDispatch &&
						waits(loops).map(([from, to]) => (
							<div
								key={from}
								data-open={to == null ? from : undefined}
								className="absolute h-0.5 rounded-full"
								style={{
									left: pct(from),
									bottom: dense ? 1 : 3,
									width: to == null ? undefined : pct(to - from),
									background: `color-mix(in oklab, ${color} 40%, transparent)`,
								}}
							/>
						))}
					{loops.flatMap((loop) => {
						const top = geometry.top + (track.get(loop.id) ?? 0) * geometry.pitch
						const mid = top + geometry.bar / 2
						const parts: React.ReactNode[] = []
						loop.inferences.forEach((call, i) => {
							const start = call.dispatchedMs ?? (hasDispatch ? undefined : call.startMs)
							if (start == null) return
							const open = call.endMs == null
							parts.push(
								<div
									key={`c${i}`}
									data-span={`${loop.id}:${i}`}
									data-open={open ? start : undefined}
									className="absolute rounded-[2px]"
									style={{
										left: pct(start),
										top,
										height: geometry.bar,
										width: open ? undefined : `max(2px, ${pct(call.endMs! - start)})`,
										background: open ? color : `color-mix(in oklab, ${color} 72%, transparent)`,
									}}
								/>,
							)
						})
						loop.calls.forEach((call, i) => {
							parts.push(
								<span
									key={`t${i}`}
									data-tool={`${loop.id}:${i}`}
									className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-panel"
									style={{ left: pct(call.startMs), top: mid, boxShadow: `0 0 0 1.5px ${color}` }}
								/>,
							)
						})
						return <Fragment key={loop.id}>{parts}</Fragment>
					})}
					{moments.map((moment) => (
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
							style={{ left: pct(moment.ms) }}
						>
							<MarkPin className="mt-px transition-transform duration-150 group-hover/mark:scale-125 group-focus-visible/mark:scale-125" />
						</button>
					))}
				</div>
			</div>

			<div className={cn("tabular hidden flex-col items-end justify-center self-start px-4 text-xs sm:flex", dense ? "h-6" : "h-11")}>
				<span className={cn(busy ? "text-ink" : "text-ink-muted")}>{now?.tokens ? format.tokens(now.tokens) : "—"}</span>
				{!dense && now && now.costUsd > 0 && <span className="text-ink-subtle">{format.usd(now.costUsd)}</span>}
			</div>
		</div>
	)
}, sameLaneProps)

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

function useFlights(moments: Moment[], rootRef: React.RefObject<HTMLDivElement | null>, animate: boolean, span: number, follow: boolean) {
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
		const { start, visible } = viewWindow(now, span, follow)
		const lane = (id?: string) => (id ? root.querySelector<HTMLElement>(`[data-lane="${CSS.escape(id)}"]`) : null)
		const next = fresh.flatMap((moment): FlightItem[] => {
			const critic = lane(moment.criticId)
			const producer = lane(moment.producerId)
			// From the middle of the Critic's lane to the pin at the top of the producer's.
			const from = critic ? critic.offsetTop + critic.offsetHeight / 2 : null
			const to = producer ? producer.offsetTop + 6 : null
			if (from == null || to == null) return []
			const first = moment.rejected[0]?.claim.text
			return [
				{
					key: moment.key,
					x: Math.min(1, Math.max(0, (moment.ms - start) / visible)),
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
	kind: "span" | "tool" | "moment"
	ref: string
	x: number
	y: number
}

function useHover(rootRef: React.RefObject<HTMLDivElement | null>) {
	const [target, setTarget] = useState<HoverTarget | null>(null)
	const onPointerOver = useCallback((event: React.PointerEvent) => {
		const el = (event.target as HTMLElement).closest<HTMLElement>("[data-span],[data-tool],[data-moment]")
		if (!el || !rootRef.current?.contains(el)) return setTarget(null)
		const box = el.getBoundingClientRect()
		const kind = el.dataset.moment != null ? "moment" : el.dataset.tool != null ? "tool" : "span"
		const ref = el.dataset.moment ?? el.dataset.tool ?? el.dataset.span ?? ""
		setTarget((prev) => (prev?.ref === ref && prev.kind === kind ? prev : { kind, ref, x: event.clientX, y: box.top }))
	}, [rootRef])
	const clear = useCallback(() => setTarget(null), [])
	return { target, onPointerOver, clear }
}

function HoverInfo({ target, view, moments }: { target: HoverTarget; view: RunView; moments: Moment[] }) {
	let title: React.ReactNode = null
	let lines: React.ReactNode[] = []
	if (target.kind === "moment") {
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
			lines = [call.endMs == null ? "running" : format.duration(call.endMs - call.startMs), loop.taskId ?? ""]
		} else {
			const call = loop.inferences[Number(index)]
			if (!call) return null
			const start = call.dispatchedMs ?? call.startMs
			const wait = call.dispatchedMs != null ? call.dispatchedMs - call.startMs : 0
			title = loop.taskId ?? "Model call"
			lines = [
				[call.model ?? loop.model, call.endMs == null ? "in flight" : format.duration(call.endMs - start)].filter(Boolean).join(" · "),
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
