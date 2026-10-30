import { useReducedMotion } from "motion/react"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Pane } from "@/components/ui/card"
import { AgentFace } from "@/components/ui/face"
import { FACE_NAME, type FaceId } from "@/lib/faces"
import * as format from "@/lib/format"
import { ROLE_INFO, type RoleKey } from "@/lib/roles"
import { cn } from "@/lib/utils"
import { useResults, useRunClock, useRunStore, useRunView } from "@/run/hooks"
import "./stage.css"
import { cast, LINK_MS, ORDER, PULSE_MS, recent, SAY_MS, STAMP_MS, useLines, type Cast, type Line } from "./derive"

/**
 * /runs/:runId/stage: the run as a conversation. The seven faces from the brand kit sit round the event bus; every
 * event travels from its author into the bus and out to everyone, and the faces react: they work, talk, get stamped by
 * the Critic, and cheer at the end. It follows the playhead, so the replay bar plays, pauses and seeks it.
 */

/** Each face's role, for its label and colour. You is the person who approves pairs. */
const ROLE: Record<FaceId, RoleKey | null> = {
	deneb: "orchestrator",
	spica: "analyst",
	tycho: "profiler",
	amity: "matchmaker",
	tinta: "writer",
	fides: "critic",
	you: null,
}

const COLOR: Record<FaceId, string> = {
	deneb: "var(--role-orchestrator)",
	spica: "var(--role-analyst)",
	tycho: "var(--role-profiler)",
	amity: "var(--role-matchmaker)",
	tinta: "var(--role-writer)",
	fides: "var(--role-critic)",
	you: "var(--idle)",
}

/** The most lines the log keeps on the page. */
const LOG_MAX = 80

export function StageScreen() {
	const view = useRunView()
	const clock = useRunClock()
	const lines = useLines(view.feed)
	const { results } = useResults()
	const ended = useRunStore((state) => state.runStatus !== "live" && state.mode === "replay" && clock >= state.duration)

	const waiting = useMemo(() => {
		if (!results) return 0
		const decided = results.approvals ?? {}
		return results.proposals.filter((proposal) => !decided[proposal.pairId]).length
	}, [results])
	const finished = ended || lines.some((line) => line.finale && line.ms <= clock)
	const faces = cast(view, lines, clock, ended, finished && waiting > 0)
	const shown = recent(lines, clock, Math.max(SAY_MS, STAMP_MS, LINK_MS))

	return (
		<div className="grid h-full min-h-0 gap-4 p-5 max-lg:h-auto lg:grid-cols-[minmax(0,1fr)_340px]">
			<Pane
				title="Stage"
				description="Every event goes through the bus to every agent. The Critic stamps what it checks."
				className="max-lg:h-[640px]"
			>
				<Arena faces={faces} lines={shown} clock={clock} waiting={finished ? waiting : 0} />
			</Pane>
			<Log lines={lines} clock={clock} />
		</div>
	)
}

/** Where each face sits, as a share of the stage: an ellipse round the bus. */
function seat(face: FaceId): [number, number] {
	const angle = -Math.PI / 2 + (ORDER.indexOf(face) * 2 * Math.PI) / ORDER.length
	return [0.5 + 0.38 * Math.cos(angle), 0.5 + 0.36 * Math.sin(angle)]
}

function Arena({ faces, lines, clock, waiting }: { faces: Map<FaceId, Cast>; lines: Line[]; clock: number; waiting: number }) {
	const ref = useRef<HTMLDivElement>(null)
	const [size, setSize] = useState({ width: 0, height: 0 })
	useLayoutEffect(() => {
		const node = ref.current
		if (!node) return
		const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
		observer.observe(node)
		return () => observer.disconnect()
	}, [])
	const still = useReducedMotion()
	const small = size.width < 640
	const point = (face: FaceId | "bus"): [number, number] => {
		const [x, y] = face === "bus" ? [0.5, 0.5] : seat(face)
		return [x * size.width, y * size.height]
	}

	const latest = lines.at(-1)
	const said = new Map<FaceId, Line>()
	for (const line of lines) if (clock - line.ms <= SAY_MS) said.set(line.from, line)
	const speaker = latest && clock - latest.ms <= SAY_MS ? latest.from : null
	const pulses = still ? [] : lines.filter((line) => clock - line.ms <= PULSE_MS).slice(-6)
	const stamps = lines.filter((line) => line.stamp && clock - line.ms <= STAMP_MS)
	const link = lines.findLast((line) => line.link && clock - line.ms <= LINK_MS)

	return (
		<div ref={ref} className="absolute inset-0 overflow-hidden bg-sunken">
			{size.width > 0 && (
				<>
					<svg className="pointer-events-none absolute inset-0 size-full" aria-hidden>
						{ORDER.map((face) => {
							const [x1, y1] = point("bus")
							const [x2, y2] = point(face)
							return <line key={face} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--hairline)" strokeWidth={1} />
						})}
						{link && <MatchLine from={point("spica")} to={point("tycho")} bus={point("bus")} progress={(clock - link.ms) / LINK_MS} />}
						{pulses.map((line) => (
							<Pulse key={line.key} line={line} progress={(clock - line.ms) / PULSE_MS} point={point} />
						))}
					</svg>
					<Bus line={latest} clock={clock} at={point("bus")} small={small} />
					{ORDER.map((face) => {
						const [x, y] = point(face)
						const entry = faces.get(face)!
						const gaze = speaker && speaker !== face ? toward(point(face), point(speaker)) : null
						return (
							<Seat
								key={face}
								face={face}
								entry={entry}
								x={x}
								y={y}
								small={small}
								gaze={gaze}
								line={said.get(face)}
								above={y > size.height * 0.2}
								side={x < size.width * 0.25 ? "left" : x > size.width * 0.75 ? "right" : "center"}
								waiting={face === "you" ? waiting : 0}
							/>
						)
					})}
					{stamps.map((line) => {
						const [x, y] = point(line.stamp!.on)
						return <Stamp key={line.key} ok={line.stamp!.ok} x={x} y={y} age={clock - line.ms} />
					})}
				</>
			)}
		</div>
	)
}

function toward([x1, y1]: [number, number], [x2, y2]: [number, number]): [number, number] {
	const length = Math.hypot(x2 - x1, y2 - y1) || 1
	return [(x2 - x1) / length, (y2 - y1) / length]
}

/** Quick start, small overshoot, long rest: the kit's spring, as a curve on 0..1. */
function ease(t: number): number {
	const clamped = Math.min(1, Math.max(0, t))
	return 1 - (1 - clamped) ** 3
}

/** An event in flight: author → bus (strong), then bus → every other face (strong if addressed). */
function Pulse({ line, progress, point }: { line: Line; progress: number; point: (face: FaceId | "bus") => [number, number] }) {
	const color = COLOR[line.from]
	const [fx, fy] = point(line.from)
	const [bx, by] = point("bus")
	const inbound = Math.min(1, progress / 0.4)
	const outbound = Math.max(0, (progress - 0.4) / 0.6)
	const fade = 1 - Math.max(0, (progress - 0.7) / 0.3)
	return (
		<g opacity={fade}>
			<line x1={fx} y1={fy} x2={bx} y2={by} stroke={color} strokeWidth={2.5} strokeLinecap="round" opacity={0.5} />
			{inbound < 1 && <circle cx={fx + (bx - fx) * ease(inbound)} cy={fy + (by - fy) * ease(inbound)} r={5} fill={color} />}
			{outbound > 0 &&
				ORDER.filter((face) => face !== line.from).map((face) => {
					const strong = line.to === "all" || line.to.includes(face)
					const [tx, ty] = point(face)
					const t = ease(outbound)
					return (
						<g key={face} opacity={strong ? 1 : 0.35}>
							<line x1={bx} y1={by} x2={tx} y2={ty} stroke={color} strokeWidth={strong ? 2 : 1} strokeLinecap="round" opacity={0.45} />
							{outbound < 1 && <circle cx={bx + (tx - bx) * t} cy={by + (ty - by) * t} r={strong ? 4.5 : 3} fill={color} />}
						</g>
					)
				})}
		</g>
	)
}

/** Amity's thread between the company side and the researcher side, bowed towards the bus. */
function MatchLine({ from, to, bus, progress }: { from: [number, number]; to: [number, number]; bus: [number, number]; progress: number }) {
	const mx = (from[0] + to[0]) / 2
	const my = (from[1] + to[1]) / 2
	const draw = ease(progress / 0.35)
	const fade = 1 - Math.max(0, (progress - 0.75) / 0.25)
	return (
		<path
			d={`M${from[0]} ${from[1]}Q${mx + (bus[0] - mx) * 0.45} ${my + (bus[1] - my) * 0.45} ${to[0]} ${to[1]}`}
			fill="none"
			stroke="var(--role-matchmaker)"
			strokeWidth={3}
			strokeLinecap="round"
			pathLength={100}
			strokeDasharray={100}
			strokeDashoffset={100 - draw * 100}
			opacity={fade}
		/>
	)
}

function Bus({ line, clock, at, small }: { line?: Line; clock: number; at: [number, number]; small: boolean }) {
	const fresh = line ? clock - line.ms : Infinity
	const ring = fresh < 600 ? 1 - fresh / 600 : 0
	return (
		<div
			className={cn(
				"absolute grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-panel text-center",
				small ? "size-24" : "size-32",
			)}
			style={{
				left: at[0],
				top: at[1],
				boxShadow: `0 0 0 1px var(--hairline), 0 0 0 ${(1 - ring) * 18}px color-mix(in oklab, var(--link) ${ring * 30}%, transparent)`,
			}}
		>
			<div className="px-3">
				<div className="text-2xs text-ink-subtle">event bus</div>
				<div className="mt-1 max-w-28 break-words text-xs font-semibold text-ink">{line?.kind ?? "waiting"}</div>
			</div>
		</div>
	)
}

function Seat({
	face,
	entry,
	x,
	y,
	small,
	gaze,
	line,
	above,
	side,
	waiting,
}: {
	face: FaceId
	entry: Cast
	x: number
	y: number
	small: boolean
	gaze: [number, number] | null
	line?: Line
	/** Speak above the face; the top face speaks below it, under its label. */
	above: boolean
	/** Faces near an edge grow their bubble inwards, so the stage does not cut it. */
	side: "left" | "center" | "right"
	waiting: number
}) {
	const role = ROLE[face]
	const label = role ? ROLE_INFO[role].label : "Human approver"
	const count = face === "you" ? null : entry.total > 1 ? `×${entry.total}` : null
	const working = entry.working > 0 && entry.total > 1 ? `${entry.working} working` : null
	return (
		<div className="absolute flex w-32 -translate-x-1/2 -translate-y-1/2 flex-col items-center" style={{ left: x, top: y }}>
			<div className="relative">
				<AgentFace
					face={face}
					state={entry.state}
					gaze={gaze}
					label={`${FACE_NAME[face]}, ${label}: ${entry.state}`}
					className={cn(small ? "size-14" : "size-[76px]", line && "face-talk")}
				/>
				{entry.state === "working" && face !== "you" && face !== "deneb" && <Dots />}
				{line && <Bubble line={line} above={above} side={side} />}
			</div>
			<div className="mt-0.5 flex items-baseline gap-1">
				<span className="text-sm font-semibold text-ink">{FACE_NAME[face]}</span>
				{count && <span className="tabular text-xs text-ink-subtle">{count}</span>}
			</div>
			<span className="text-2xs text-ink-muted">{label}</span>
			{(working || waiting > 0) && (
				<span className="tabular text-2xs text-working">{waiting > 0 ? `${waiting} to approve` : working}</span>
			)}
		</div>
	)
}

/** Thinking dots beside a face while its model call runs. */
function Dots() {
	return (
		<span className="absolute -right-2 top-0 flex gap-[3px] rounded-full bg-panel px-1.5 py-1 shadow-[0_0_0_1px_var(--hairline)]">
			{[0, 150, 300].map((delay) => (
				<i key={delay} className="stage-dot size-1 rounded-full bg-ink-muted" style={{ animationDelay: `${delay}ms` }} />
			))}
		</span>
	)
}

function Bubble({ line, above, side }: { line: Line; above: boolean; side: "left" | "center" | "right" }) {
	return (
		<div
			className={cn(
				"absolute z-10 w-max max-w-56 animate-pop-in rounded-2xl bg-panel px-3 py-1.5 text-xs leading-snug text-ink shadow-float",
				side === "center" ? "left-1/2 -translate-x-1/2" : side === "left" ? "left-0" : "right-0",
				above ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+40px)]",
			)}
		>
			<Ids text={line.text} />
		</div>
	)
}

/** Dataset ids in a line, in the kit's id style: tabular, slashed zero, indigo. */
function Ids({ text }: { text: string }) {
	const parts = text.split(/(\b(?:R\d{3,4}|C\d{3}(?:-CH\d+)?(?:-R\d{3,4})?|SYN-[A-Z]{3}-\d+)\b)/)
	return (
		<>
			{parts.map((part, i) =>
				i % 2 ? (
					<span key={i} className="whitespace-nowrap rounded-xs bg-link/10 px-1 font-mono text-link">
						{part}
					</span>
				) : (
					part
				),
			)}
		</>
	)
}

/** The Critic's verdict, slammed onto the face it judged. */
function Stamp({ ok, x, y, age }: { ok: boolean; x: number; y: number; age: number }) {
	const land = Math.min(1, age / 380)
	const scale = land < 0.55 ? 1.9 - (0.95 * land) / 0.55 : 0.95 + (0.05 * (land - 0.55)) / 0.45
	const fade = age > STAMP_MS - 400 ? (STAMP_MS - age) / 400 : 1
	return (
		<div
			className={cn(
				"pointer-events-none absolute z-20 rounded-md border-[2.5px] bg-panel/90 px-2.5 py-0.5 text-xs font-bold uppercase tracking-[0.08em]",
				ok ? "border-working text-working" : "border-failed text-failed",
			)}
			style={{ left: x + 36, top: y - 30, opacity: Math.min(land * 2, 1) * fade, transform: `translate(-50%, -50%) rotate(-10deg) scale(${scale})` }}
		>
			{ok ? "Passed" : "Sent back"}
		</div>
	)
}

/** The events so far, newest first. A click moves the playhead to that moment. */
function Log({ lines, clock }: { lines: Line[]; clock: number }) {
	const shown = useMemo(() => lines.filter((line) => line.ms <= clock).slice(-LOG_MAX).reverse(), [lines, clock])
	const list = useRef<HTMLOListElement>(null)
	useEffect(() => {
		list.current?.parentElement?.scrollTo({ top: 0 })
	}, [shown[0]?.key])
	return (
		<Pane title="Events" count={lines.length || undefined} scroll className="max-lg:h-[480px]">
			{shown.length === 0 ? (
				<p className="px-4 py-3 text-sm text-ink-subtle">Events appear here as the agents publish them.</p>
			) : (
				<ol ref={list} className="flex flex-col p-1.5">
					{shown.map((line, i) => (
						<li key={line.key}>
							<button
								type="button"
								onClick={() => useRunStore.getState().seek(line.ms)}
								className={cn(
									"grid w-full grid-cols-[40px_8px_minmax(0,1fr)] items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-150 hover:bg-hover",
									i === 0 && "bg-sunken",
								)}
							>
								<span className="tabular text-xs text-ink-subtle">{format.clock(line.ms)}</span>
								<span className="size-2 self-center rounded-full" style={{ background: COLOR[line.from] }} />
								<span className="min-w-0">
									<span className="font-medium text-ink">{FACE_NAME[line.from]}</span>{" "}
									<span className="text-xs text-ink-subtle">{line.kind}</span>
									<span className="block leading-snug text-ink-muted">
										<Ids text={line.text} />
									</span>
								</span>
							</button>
						</li>
					))}
				</ol>
			)}
		</Pane>
	)
}
