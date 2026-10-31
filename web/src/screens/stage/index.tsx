import { Check, List as ListIcon, Undo2, X } from "lucide-react"
import { AnimatePresence, motion, useAnimate, useReducedMotion } from "motion/react"
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react"
import { useShallow } from "zustand/react/shallow"
import { useFloatInsets } from "@/components/shell/float"
import { Button } from "@/components/ui/button"
import { Pane } from "@/components/ui/card"
import { AgentFace } from "@/components/ui/face"
import { FACE_NAME, type FaceId, type FaceState } from "@/lib/faces"
import * as format from "@/lib/format"
import { ROLE_INFO, type RoleKey } from "@/lib/roles"
import { cn } from "@/lib/utils"
import { useResults, useRunClock, useRunStore, useRunView } from "@/run/hooks"
import { cast, ORDER, useLines, type Cast, type Line } from "./derive"
import { MOOD_MS, STAMP_AT, useDirector, type Beat } from "./director"
import "./stage.css"
import { namesOf, sayOne, VERB, type Names } from "./words"

/**
 * /runs/:runId/stage: the run as a conversation. The seven faces from the brand kit sit round the event bus, which is
 * the Entangle mark. The run clock says what has happened; the director (director.ts) paces it into beats at a human
 * speed. Each beat travels from its speaker along a curved wire into the bus (the indigo tile hops one slot) and out
 * to everyone; the speaker says it in a bubble, the Critic's verdict lands as a badge on the face whose work it checked,
 * and the faces nod, flinch and cheer.
 */

/** Each face's role, for its label. You is the person who approves pairs. */
const ROLE: Record<FaceId, RoleKey | null> = {
	deneb: "orchestrator",
	spica: "analyst",
	libra: "shortlist",
	tycho: "profiler",
	amity: "matchmaker",
	tinta: "writer",
	fides: "critic",
	ceres: "scout",
	you: null,
}

const COLOR: Record<FaceId, string> = {
	deneb: "var(--role-orchestrator)",
	spica: "var(--role-analyst)",
	libra: "var(--role-shortlist)",
	tycho: "var(--role-profiler)",
	amity: "var(--role-matchmaker)",
	tinta: "var(--role-writer)",
	fides: "var(--role-critic)",
	ceres: "var(--role-scout)",
	you: "var(--idle)",
}

/** Where each face and its labels sit, as a share of the stage: a loose ring, a little off true so it does not look ruled. */
const SEAT: Record<FaceId, [number, number]> = {
	deneb: [0.5, 0.14],
	tycho: [0.765, 0.235],
	fides: [0.895, 0.475],
	ceres: [0.83, 0.74],
	you: [0.63, 0.88],
	tinta: [0.37, 0.875],
	amity: [0.165, 0.735],
	libra: [0.1, 0.48],
	spica: [0.235, 0.235],
}

/** The kit's motion: a quick start, a small overshoot, a long rest. */
const SPRING = { type: "spring", stiffness: 420, damping: 26 } as const
const GLIDE = [0.45, 0, 0.2, 1] as const

/** The most lines the log keeps on the page. */
const LOG_MAX = 80

export function StageScreen() {
	const view = useRunView()
	const clock = useRunClock()
	const lines = useLines(view.feed)
	const { results } = useResults()
	const names = useMemo(() => namesOf(results), [results])
	const { active, speed, duration, live } = useRunStore(
		useShallow((state) => ({
			active: state.mode === "live" || state.playing,
			speed: state.mode === "live" ? 1 : state.speed === "instant" ? Infinity : state.speed,
			duration: state.duration,
			live: state.runStatus === "live" || state.mode === "live",
		})),
	)
	const beats = useDirector({ lines, clock, active, speed, names })

	const waiting = useMemo(() => {
		if (!results) return 0
		const decided = results.approvals ?? {}
		return results.proposals.filter((proposal) => !decided[proposal.pairId]).length
	}, [results])
	let upTo = 0
	while (upTo < lines.length && lines[upTo].ms <= clock) upTo++
	const finished = (!live && clock >= duration) || lines.slice(0, upTo).some((line) => line.act === "done")
	const faces = cast(view, finished, finished && waiting > 0)

	// The stage fills the panel. The run's header and replay bar float over it (see run-layout), and so does the log.
	const float = useFloatInsets()
	const [logOpen, setLogOpen] = useState(() => window.matchMedia("(min-width: 1024px)").matches)
	const ref = useRef<HTMLDivElement>(null)
	const size = useSize(ref)
	const top = float.top + GAP
	const bottom = float.bottom + GAP
	const safe = { top, bottom, left: GAP, right: logOpen ? LOG_WIDTH + GAP * 2 : GAP }
	// The header is only as wide as its content: the log goes beside it when there is room, else below it.
	const logTop = float.headRight + GAP + LOG_WIDTH + GAP <= size.width ? GAP : top

	return (
		<div ref={ref} className="stage-canvas relative h-full overflow-hidden">
			<div
				aria-hidden
				className="absolute inset-0 opacity-70 [background-image:radial-gradient(var(--strong)_1px,transparent_1.2px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_80%)]"
			/>
			<Arena size={size} faces={faces} beats={beats} waiting={finished ? waiting : 0} safe={safe} />
			<AnimatePresence initial={false}>
				{logOpen ? (
					<motion.div
						key="log"
						className="absolute right-3 z-20 flex"
						style={{ top: logTop, bottom, width: `min(${LOG_WIDTH}px, calc(100% - 24px))` }}
						initial={{ opacity: 0, x: 24 }}
						animate={{ opacity: 1, x: 0 }}
						exit={{ opacity: 0, x: 24 }}
						transition={{ type: "spring", stiffness: 380, damping: 34 }}
					>
						<Log lines={lines} upTo={upTo} names={names} onClose={() => setLogOpen(false)} />
					</motion.div>
				) : (
					<motion.div
						key="open"
						className="absolute right-3 z-20"
						style={{ top: logTop }}
						initial={{ opacity: 0, scale: 0.9 }}
						animate={{ opacity: 1, scale: 1 }}
						exit={{ opacity: 0, scale: 0.9 }}
						transition={{ type: "spring", stiffness: 420, damping: 30 }}
					>
						<Button variant="outline" size="sm" onClick={() => setLogOpen(true)} className="bg-panel/80 shadow-soft backdrop-blur-xl">
							<ListIcon />
							Events
							{upTo > 0 && <span className="tabular text-ink-subtle">{upTo}</span>}
						</Button>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	)
}

/** Space between the floating cards, and between them and the panel's edge. */
const GAP = 12
const LOG_WIDTH = 320

/** The open space the faces sit in: px kept clear at each edge, for the floating cards. */
type Safe = { top: number; bottom: number; left: number; right: number }

/** The ring keeps its shape: at most this much wider than tall, centred in the open space. */
const ASPECT = 1.4

/**
 * Px under a face for its name, role and status lines, and under the bus for its name. They hang below, so a seat's
 * point is its face's centre and the bus's point is its tile's: the wires meet the faces, not the middle of their labels.
 */
const LABELS = 55
const BUS_LABEL = 22
/** A glow of the stage's own colour round the labels, so a wire on its way to a face goes under the words, not through them. */
const HALO = "[text-shadow:0_0_2px_var(--stage-bg),0_0_4px_var(--stage-bg),0_0_6px_var(--stage-bg)]"

type Size = { width: number; height: number }

function useSize(ref: RefObject<HTMLElement | null>): Size {
	const [size, setSize] = useState<Size>({ width: 0, height: 0 })
	useLayoutEffect(() => {
		const node = ref.current
		if (!node) return
		const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
		observer.observe(node)
		return () => observer.disconnect()
	}, [ref])
	return size
}

/** Ease for the ring sliding when the open space changes (the log opens or closes). */
const SETTLE = "transition-[left,top] duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)]"

type Point = [number, number]
type Wire = { out: string; back: string }

/** A wire from the bus to a seat, bowed to one side, so the seven wires swirl like a pinwheel. */
function wire([bx, by]: Point, [sx, sy]: Point, bow = 0.16): Wire {
	const cx = (bx + sx) / 2 - (sy - by) * bow
	const cy = (by + sy) / 2 + (sx - bx) * bow
	return { out: `M${bx} ${by}Q${cx} ${cy} ${sx} ${sy}`, back: `M${sx} ${sy}Q${cx} ${cy} ${bx} ${by}` }
}

function Arena({ size, faces, beats, waiting, safe }: { size: Size; faces: Map<FaceId, Cast>; beats: Beat[]; waiting: number; safe: Safe }) {
	const still = useReducedMotion() ?? false
	// Slide only after the first layout, so the ring does not drift in while the floating cards are measured.
	const [settled, setSettled] = useState(false)
	useEffect(() => {
		const timer = window.setTimeout(() => setSettled(true), 600)
		return () => window.clearTimeout(timer)
	}, [])
	const width = Math.max(0, size.width - safe.left - safe.right)
	const height = Math.max(0, size.height - safe.top - safe.bottom)
	const boxWidth = Math.min(width, height * ASPECT)
	const boxHeight = boxWidth / ASPECT
	const small = boxWidth < 640
	const { bus, seats, wires } = useMemo(() => {
		const left = safe.left + (width - boxWidth) / 2
		const top = safe.top + (height - boxHeight) / 2
		// The centres of the bus tile and the faces, each raised by half its labels so the group, labels included, keeps its spot.
		const bus: Point = [left + boxWidth / 2, top + boxHeight / 2 - BUS_LABEL / 2]
		const seats = Object.fromEntries(
			ORDER.map((face) => [face, [left + SEAT[face][0] * boxWidth, top + SEAT[face][1] * boxHeight - LABELS / 2]]),
		) as Record<FaceId, Point>
		const wires = Object.fromEntries(ORDER.map((face) => [face, wire(bus, seats[face])])) as Record<FaceId, Wire>
		return { bus, seats, wires }
	}, [safe.left, safe.top, width, height, boxWidth, boxHeight])
	const glide = settled && !still

	const now = performance.now()
	const speaker = beats.at(-1)?.from ?? null
	const link = beats.findLast((beat) => beat.link)

	return (
		<div className="absolute inset-0 overflow-hidden">
			{size.width > 0 && (
				<>
					<svg className="pointer-events-none absolute inset-0 size-full" aria-hidden>
						{ORDER.map((face) => (
							<motion.path
								key={face}
								initial={false}
								animate={{ d: wires[face].out }}
								transition={glide ? { duration: 0.5, ease: [0.2, 0.8, 0.2, 1] } : { duration: 0 }}
								fill="none"
								stroke="var(--strong)"
								strokeOpacity={0.6}
								strokeWidth={1}
							/>
						))}
						<AnimatePresence>
							{link && <Thread key={link.id} from={seats.spica} to={seats.tycho} bus={bus} />}
						</AnimatePresence>
						{!still && beats.map((beat) => <Pulse key={beat.id} beat={beat} wires={wires} />)}
					</svg>
					<BusMark x={bus[0]} y={bus[1]} hops={beats.at(-1)?.id ?? 0} small={small} still={still} glide={glide} />
					{ORDER.map((face) => {
						const [x, y] = seats[face]
						return (
							<Seat
								key={face}
								face={face}
								entry={faces.get(face)!}
								mood={moodOf(face, beats, now)}
								kick={still ? null : kickOf(face, beats)}
								x={x}
								y={y}
								small={small}
								gaze={speaker && speaker !== face ? toward(seats[face], seats[speaker]) : null}
								beat={beats.findLast((beat) => beat.from === face)}
								waiting={face === "you" ? waiting : 0}
								verdict={verdictOf(face, beats)}
								glide={glide}
							/>
						)
					})}
					<div className="pointer-events-none absolute inset-0 z-20">
							<AnimatePresence>
								{layoutBubbles(beats, seats, bus, small, {
									left: safe.left + 8,
									top: safe.top + 8,
									right: size.width - safe.right - 8,
									bottom: size.height - safe.bottom - 8,
								}).map((bubble) => (
									<Bubble key={bubble.beat.from} bubble={bubble} />
								))}
							</AnimatePresence>
						</div>
				</>
			)}
		</div>
	)
}

/** A face's reaction right now: from when the Critic's verdict lands, for MOOD_MS. */
function moodOf(face: FaceId, beats: Beat[], now: number): FaceState | null {
	for (let i = beats.length - 1; i >= 0; i--) {
		const beat = beats[i]
		const age = now - beat.at
		if (age < STAMP_AT * 0.8 || age > STAMP_AT + MOOD_MS) continue
		if (beat.mood?.face === face) return beat.mood.state
		if (face === "fides" && beat.stamp) return beat.stamp.ok ? "done" : "reject"
	}
	return null
}

/** The Critic's latest verdict on this face's work, while its beat is on stage. */
function verdictOf(face: FaceId, beats: Beat[]): Verdict | null {
	const beat = beats.findLast((candidate) => candidate.stamp?.on === face)
	return beat ? { id: beat.id, ok: beat.stamp!.ok } : null
}

type Verdict = { id: number; ok: boolean }

type Kick = { id: number; type: "nod" | "flinch" | "squash"; delay: number }

/** The body reaction a face owes the latest beat: squash when it passes, flinch when sent back, nod when addressed. */
function kickOf(face: FaceId, beats: Beat[]): Kick | null {
	const beat = beats.at(-1)
	if (!beat || beat.from === face) return null
	if (beat.stamp?.on === face) return { id: beat.id, type: beat.stamp.ok ? "squash" : "flinch", delay: STAMP_AT }
	if (beat.to !== "all" && beat.to.includes(face)) return { id: beat.id, type: "nod", delay: 900 }
	return null
}

function toward([x1, y1]: Point, [x2, y2]: Point): [number, number] {
	const length = Math.hypot(x2 - x1, y2 - y1) || 1
	return [(x2 - x1) / length, (y2 - y1) / length]
}

/**
 * A beat in flight: a short comet rides the speaker's wire into the bus, then out along every other wire, bright on
 * the wires it is addressed to and faint on the rest, the way Mozaik delivers every event to every participant.
 */
const Pulse = memo(function Pulse({ beat, wires }: { beat: Beat; wires: Record<FaceId, Wire> }) {
	const color = COLOR[beat.from]
	const comet = (d: string, delay: number, strong: boolean, key: string) => (
		<g key={key}>
			<motion.path
				d={d}
				fill="none"
				stroke={color}
				strokeWidth={strong ? 1.5 : 1}
				initial={{ opacity: 0 }}
				animate={{ opacity: [0, strong ? 0.5 : 0.2, 0] }}
				transition={{ duration: 1.2, delay, ease: "easeOut" }}
			/>
			<motion.path
				d={d}
				fill="none"
				stroke={color}
				strokeWidth={strong ? 3.5 : 2}
				strokeLinecap="round"
				initial={{ pathLength: 0.001, pathOffset: 0, opacity: 0 }}
				animate={{ pathLength: [0.001, 0.28, 0.001], pathOffset: [0, 0.4, 1], opacity: [0, strong ? 1 : 0.45, 0] }}
				transition={{ duration: 0.64, delay, ease: GLIDE }}
			/>
		</g>
	)
	return (
		<g>
			{comet(wires[beat.from].back, 0, true, "in")}
			{ORDER.filter((face) => face !== beat.from).map((face) => comet(wires[face].out, 0.48, beat.to === "all" || beat.to.includes(face), face))}
		</g>
	)
})

/** Amity's thread between the company side and the researcher side: it draws, knots in the middle, then lets go. */
function Thread({ from, to, bus }: { from: Point; to: Point; bus: Point }) {
	const mid: Point = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]
	const control: Point = [mid[0] + (bus[0] - mid[0]) * 0.5, mid[1] + (bus[1] - mid[1]) * 0.5]
	const knot: Point = [0.25 * from[0] + 0.5 * control[0] + 0.25 * to[0], 0.25 * from[1] + 0.5 * control[1] + 0.25 * to[1]]
	return (
		<motion.g exit={{ opacity: 0, transition: { duration: 0.5 } }}>
			<motion.path
				d={`M${from[0]} ${from[1]}Q${control[0]} ${control[1]} ${to[0]} ${to[1]}`}
				fill="none"
				stroke="var(--role-matchmaker)"
				strokeWidth={2.5}
				strokeLinecap="round"
				initial={{ pathLength: 0 }}
				animate={{ pathLength: 1 }}
				transition={{ duration: 0.9, delay: 0.45, ease: GLIDE }}
			/>
			<motion.circle
				cx={knot[0]}
				cy={knot[1]}
				r={5}
				fill="var(--role-matchmaker)"
				initial={{ scale: 0 }}
				animate={{ scale: 1 }}
				transition={{ ...SPRING, delay: 1.25 }}
				style={{ transformBox: "fill-box", transformOrigin: "center" }}
			/>
		</motion.g>
	)
}

/** The outer slots of the 3×3 mark, clockwise from the top left, as [column, row]. */
const SLOTS: [number, number][] = [
	[0, 0],
	[1, 0],
	[2, 0],
	[2, 1],
	[2, 2],
	[1, 2],
	[0, 2],
	[0, 1],
]

/**
 * The bus is the Entangle mark. On each beat the indigo tile hops one slot clockwise, lifting over the tile it
 * passes while that one slides under into its place: the logo's own "Hop" motion (design/logo).
 */
const BusMark = memo(function BusMark({
	x,
	y,
	hops,
	small,
	still,
	glide,
}: {
	x: number
	y: number
	hops: number
	small: boolean
	still: boolean
	glide: boolean
}) {
	// slotOf[tile] = slot. Tile 0 is indigo and starts top right, as in the still mark.
	const [tiles, setTiles] = useState(() => ({ hops, slotOf: [2, 0, 1, 3, 4, 5, 6, 7], under: -1 }))
	if (tiles.hops !== hops) {
		const slotOf = tiles.slotOf.slice()
		let under = -1
		if (hops > tiles.hops) {
			const to = (slotOf[0] + 1) % 8
			under = slotOf.indexOf(to)
			slotOf[under] = slotOf[0]
			slotOf[0] = to
		}
		setTiles({ hops, slotOf, under })
	}
	const box = small ? 64 : 88
	const unit = box / 62
	return (
		<div className={cn("absolute -translate-x-1/2 -translate-y-1/2", glide && SETTLE)} style={{ left: x, top: y }}>
			<div
				className="relative grid place-items-center rounded-[30%] border border-hairline bg-panel shadow-soft"
				style={{ width: box * 1.6, height: box * 1.6 }}
			>
				<AnimatePresence>
					{!still && hops > 0 && (
						<motion.span
							key={hops}
							className="absolute inset-0 rounded-[30%] border-2 border-link"
							initial={{ opacity: 0.4, scale: 1 }}
							animate={{ opacity: 0, scale: 1.2 }}
							exit={{ opacity: 0 }}
							transition={{ duration: 0.9, ease: "easeOut" }}
						/>
					)}
				</AnimatePresence>
				<div className="relative" style={{ width: box, height: box }}>
					{tiles.slotOf.map((slot, tile) => {
						const [col, row] = SLOTS[slot]
						const indigo = tile === 0
						const moved = indigo || tile === tiles.under
						return (
							<motion.div
								key={tile}
								className={cn("absolute left-0 top-0", indigo && "z-10")}
								style={{ width: 18 * unit, height: 18 * unit }}
								initial={false}
								animate={{ x: col * 22 * unit, y: row * 22 * unit }}
								transition={{ type: "spring", stiffness: 300, damping: 20 }}
							>
								<motion.div
									key={moved ? tiles.hops : 0}
									className={cn("size-full", indigo ? "bg-link" : "bg-ink")}
									style={{ borderRadius: 4 * unit }}
									initial={false}
									animate={!still && moved && tiles.hops > 0 ? { scale: indigo ? [1, 1.22, 1] : [1, 0.82, 1] } : { scale: 1 }}
									transition={{ duration: 0.52, times: [0, 0.4, 1], ease: "easeOut" }}
								/>
							</motion.div>
						)
					})}
				</div>
			</div>
			<div className={cn("absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap text-2xs text-ink-subtle", HALO)}>event bus</div>
		</div>
	)
})

/** A state shown for at least `ms`, so a face does not flicker between working and idle. */
function useHeld<T>(value: T, ms = 1000): T {
	const [shown, setShown] = useState(value)
	const since = useRef(0)
	useEffect(() => {
		if (value === shown) return
		const show = () => {
			since.current = performance.now()
			setShown(value)
		}
		const wait = ms - (performance.now() - since.current)
		if (wait <= 0) return show()
		const timer = window.setTimeout(show, wait)
		return () => window.clearTimeout(timer)
	}, [value, shown, ms])
	return shown
}

const KICKS = {
	nod: { keyframes: { y: [0, 5, -1, 0], scaleY: [1, 0.94, 1.02, 1] }, duration: 0.55 },
	flinch: { keyframes: { x: [0, -7, 5, -2, 0], rotate: [0, -6, 3, -1, 0] }, duration: 0.6 },
	squash: { keyframes: { scaleX: [1, 1.12, 0.96, 1], scaleY: [1, 0.86, 1.05, 1] }, duration: 0.55 },
} as const

function Seat({
	face,
	entry,
	mood,
	kick,
	x,
	y,
	small,
	gaze,
	beat,
	waiting,
	verdict,
	glide,
}: {
	face: FaceId
	entry: Cast
	mood: FaceState | null
	kick: Kick | null
	x: number
	y: number
	small: boolean
	gaze: [number, number] | null
	/** The last beat this face said, while it is on stage. */
	beat?: Beat
	waiting: number
	/** The Critic's verdict on this face's work: a badge on its shoulder and the word under its role. */
	verdict: Verdict | null
	/** Slide to a new seat instead of jumping. */
	glide: boolean
}) {
	const base = useHeld(entry.state)
	const state = mood ?? base
	const [scope, animate] = useAnimate<HTMLDivElement>()
	useEffect(() => {
		if (!kick) return
		const { keyframes, duration } = KICKS[kick.type]
		const timer = window.setTimeout(() => {
			if (scope.current) void animate(scope.current, keyframes, { duration, ease: "easeOut" })
		}, kick.delay)
		return () => window.clearTimeout(timer)
		// One reaction per beat.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [kick?.id, kick?.type])

	const role = ROLE[face]
	const label = role ? ROLE_INFO[role].label : "Human approver"
	const count = face === "you" ? null : entry.total > 1 ? `×${entry.total}` : null
	const working = entry.working > 0 && entry.total > 1 ? `${entry.working} working` : null
	const talking = beat != null && performance.now() - beat.at < 1400
	return (
		<div className={cn("absolute -translate-x-1/2 -translate-y-1/2", glide && SETTLE)} style={{ left: x, top: y }}>
			<div className="relative">
				<div ref={scope} className="origin-bottom">
					<AgentFace
						face={face}
						state={state}
						gaze={gaze}
						label={`${FACE_NAME[face]}, ${label}: ${state}`}
						className={cn("block", small ? "size-14" : "size-[76px]", talking && "face-talk")}
					/>
				</div>
				<AnimatePresence>
					{verdict && (
						<motion.span
							key={verdict.id}
							aria-hidden
							className={cn(
								"absolute -right-1 -top-1 z-10 grid size-6 place-items-center rounded-full text-white shadow-[0_0_0_3px_var(--stage-bg)] [&_svg]:size-3.5",
								verdict.ok ? "bg-working" : "bg-needs",
							)}
							initial={{ opacity: 0, scale: 0.4 }}
							animate={{ opacity: 1, scale: 1, transition: { ...SPRING, stiffness: 520, damping: 18, delay: STAMP_AT / 1000 } }}
							exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.25 } }}
						>
							{verdict.ok ? <Check strokeWidth={3} /> : <Undo2 strokeWidth={2.6} />}
						</motion.span>
					)}
				</AnimatePresence>
				<AnimatePresence>
					{state === "working" && !verdict && face !== "you" && face !== "deneb" && (
						<motion.span
							className="absolute -right-2 top-0 flex gap-[3px] rounded-full bg-panel px-1.5 py-1 shadow-[0_0_0_1px_var(--hairline)]"
							initial={{ opacity: 0, scale: 0.6 }}
							animate={{ opacity: 1, scale: 1 }}
							exit={{ opacity: 0, scale: 0.6 }}
							transition={SPRING}
						>
							{[0, 150, 300].map((delay) => (
								<i key={delay} className="stage-dot size-1 rounded-full bg-ink-muted" style={{ animationDelay: `${delay}ms` }} />
							))}
						</motion.span>
					)}
				</AnimatePresence>
			</div>
			<div className={cn("absolute left-1/2 top-full flex w-36 -translate-x-1/2 flex-col items-center pt-[9px]", HALO)} style={{ height: LABELS }}>
				<div className="flex items-baseline gap-1">
					<span className="text-sm font-semibold text-ink">{FACE_NAME[face]}</span>
					{count && <span className="tabular text-xs text-ink-subtle">{count}</span>}
				</div>
				<span className="text-2xs text-ink-muted">{label}</span>
				{/* One line that is always there, so a verdict or a count never moves the labels. */}
				<span className="relative h-3.5 text-2xs leading-3.5">
					<AnimatePresence mode="popLayout" initial={false}>
						{verdict ? (
							<motion.span
								key={`v${verdict.id}`}
								className={cn("block font-medium", verdict.ok ? "text-working" : "text-needs")}
								initial={{ opacity: 0, y: -3 }}
								animate={{ opacity: 1, y: 0, transition: { duration: 0.25, delay: STAMP_AT / 1000 } }}
								exit={{ opacity: 0, transition: { duration: 0.2 } }}
							>
								{verdict.ok ? "Passed" : "Sent back"}
							</motion.span>
						) : (
							(working || waiting > 0) && (
								<motion.span key="count" className="tabular block text-working" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
									{waiting > 0 ? `${waiting} to approve` : working}
								</motion.span>
							)
						)}
					</AnimatePresence>
				</span>
			</div>
		</div>
	)
}

type Side = "above" | "below" | "right" | "left"
type Rect = { left: number; top: number; right: number; bottom: number }

/** Where each face prefers to speak: Deneb (no room above) below its name, the rest above. Other sides are tried after. */
const PREFER: Record<FaceId, Side> = {
	deneb: "below",
	tycho: "above",
	fides: "above",
	ceres: "above",
	you: "above",
	tinta: "above",
	amity: "above",
	libra: "above",
	spica: "above",
}

/** A bubble the layout found room for: its box, its side, and where its speaker is, for the spring's origin. */
interface Placed {
	beat: Beat
	side: Side
	box: Rect
	/** The speaker's centre, relative to the box. */
	origin: Point
}

/** The bubble's text box: Inter 12px, padding 12 × 8, lines 16.5px. Measured, so the layout is exact. A crowded stage tries the narrow width. */
const BUBBLE = { widths: [240, 168], padX: 12, padY: 8, line: 16.5, font: 12, gap: 8 }
let measurer: CanvasRenderingContext2D | null = null
function bubbleSize(text: string, max: number): { width: number; height: number } {
	measurer ??= document.createElement("canvas").getContext("2d")
	if (!measurer) return { width: max, height: BUBBLE.line * 3 + BUBBLE.padY * 2 }
	measurer.font = `${BUBBLE.font}px ${getComputedStyle(document.body).fontFamily}`
	const room = max - BUBBLE.padX * 2
	// Ids are drawn as chips, a little wider than the text; 6px each covers their padding.
	const widthOf = (word: string) => measurer!.measureText(word).width + (/\d{3}/.test(word) ? 6 : 0)
	const space = measurer.measureText(" ").width
	let lines = 1
	let line = 0
	let widest = 0
	for (const word of text.split(/\s+/)) {
		const w = widthOf(word)
		if (line > 0 && line + space + w > room) {
			widest = Math.max(widest, line)
			lines++
			line = w
		} else line += (line > 0 ? space : 0) + w
	}
	widest = Math.max(widest, line)
	return { width: Math.ceil(Math.min(room, widest)) + BUBBLE.padX * 2 + 2, height: Math.ceil(lines * BUBBLE.line) + BUBBLE.padY * 2 + 2 }
}

const overlaps = (a: Rect, b: Rect, gap: number) =>
	a.left < b.right + gap && b.left < a.right + gap && a.top < b.bottom + gap && b.top < a.bottom + gap

/**
 * Bubbles for the faces that are speaking, newest first. Each tries its face's usual side, then the opposite one, then
 * beside the face, and takes the first that stays inside the open stage and touches no face, the bus or a newer bubble;
 * with none clear at full width, the same sides at the narrow width.
 * The newest speaker always gets one: with no clear side it takes the side that covers least, drawn above it all.
 * An older line with no room gets none: it is still in the event log, and its face still bobs.
 */
function layoutBubbles(beats: Beat[], seats: Record<FaceId, Point>, bus: Point, small: boolean, open: Rect): Placed[] {
	const face = small ? 56 : 76
	// A seat as drawn: the face round its point, then its name, its role and the status line, about as wide as the role line.
	const seatBox = ([x, y]: Point): Rect => ({ left: x - 54, right: x + 54, top: y - face / 2, bottom: y + face / 2 + LABELS })
	const half = ((small ? 64 : 88) * 1.6) / 2
	const busBox: Rect = { left: bus[0] - half, right: bus[0] + half, top: bus[1] - half, bottom: bus[1] + half + BUS_LABEL }
	const latest = new Map<FaceId, Beat>()
	for (const beat of beats) latest.set(beat.from, beat)
	const placed: Placed[] = []
	const area = (a: Rect, b: Rect) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
	for (const [rank, beat] of [...latest.values()].sort((a, b) => b.at - a.at).entries()) {
		const seat = seats[beat.from]
		const own = seatBox(seat)
		const faceTop = own.top
		const faceMid = seat[1]
		// How much a side covers: faces and the bus by area; leaving the stage or touching a newer bubble rules it out.
		const cost = (box: Rect) => {
			const inside = box.left >= open.left && box.right <= open.right && box.top >= open.top && box.bottom <= open.bottom
			if (!inside || placed.some((other) => overlaps(box, other.box, 6))) return Infinity
			return area(box, busBox) + ORDER.reduce((sum, other) => (other === beat.from ? sum : sum + area(box, seatBox(seats[other]))), 0)
		}
		const order: Side[] = PREFER[beat.from] === "above" ? ["above", "below", "right", "left"] : ["below", "above", "right", "left"]
		let best: { side: Side; box: Rect; cost: number } | null = null
		search: for (const max of BUBBLE.widths) {
			const { width, height } = bubbleSize(beat.text, max)
			const clampX = (left: number) => Math.min(Math.max(left, open.left), open.right - width)
			const lefts: Record<Side, number> = {
				above: clampX(seat[0] - width / 2),
				below: clampX(seat[0] - width / 2),
				right: seat[0] + face / 2 + 14,
				left: seat[0] - face / 2 - 14 - width,
			}
			const tops: Record<Side, number> = {
				above: faceTop - BUBBLE.gap - height,
				below: own.bottom + BUBBLE.gap,
				right: faceMid - height / 2,
				left: faceMid - height / 2,
			}
			for (const side of order) {
				const box = { left: lefts[side], top: tops[side], right: lefts[side] + width, bottom: tops[side] + height }
				const c = cost(box)
				if (c < (best?.cost ?? Infinity)) best = { side, box, cost: c }
				if (c === 0) break search
			}
		}
		if (best && (best.cost === 0 || (rank === 0 && best.cost < Infinity))) {
			placed.push({ beat, side: best.side, box: best.box, origin: [seat[0] - best.box.left, faceMid - best.box.top] })
		}
	}
	return placed
}

/**
 * A face's speech bubble: it grows out of its speaker and sinks back into it. One per face: when the face speaks again,
 * the words change inside it (and it glides if the new line needs another spot), so two lines never cross-fade on one spot.
 */
function Bubble({ bubble }: { bubble: Placed }) {
	const { side, box, origin } = bubble
	const from = { above: { y: 8 }, below: { y: -8 }, right: { x: -8 }, left: { x: 8 } }[side]
	return (
		<motion.div
			layout="position"
			className="absolute rounded-[18px] border border-hairline bg-panel px-3 py-2 text-xs leading-snug text-ink shadow-soft"
			style={{ left: box.left, top: box.top, width: box.right - box.left, transformOrigin: `${origin[0]}px ${origin[1]}px` }}
			initial={{ opacity: 0, scale: 0.86, ...from }}
			animate={{ opacity: 1, scale: 1, x: 0, y: 0, transition: SPRING }}
			exit={{ opacity: 0, scale: 0.82, transition: { duration: 0.18, ease: "easeIn" } }}
			transition={{ layout: { duration: 0.3, ease: GLIDE } }}
		>
			<motion.div key={bubble.beat.id} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.16 } }}>
				<Ids text={bubble.beat.text} />
			</motion.div>
		</motion.div>
	)
}

/** Dataset ids left in a line (when a name is not known), in the kit's id style. */
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

/** The events so far, newest first, in words. A click moves the playhead to that moment. */
const Log = memo(function Log({ lines, upTo, names, onClose }: { lines: Line[]; upTo: number; names: Names; onClose: () => void }) {
	const shown = useMemo(() => lines.slice(Math.max(0, upTo - LOG_MAX), upTo).reverse(), [lines, upTo])
	const list = useRef<HTMLOListElement>(null)
	useEffect(() => {
		list.current?.parentElement?.scrollTo({ top: 0, behavior: "smooth" })
	}, [shown[0]?.key])
	return (
		<Pane
			title="Events"
			count={upTo || undefined}
			scroll
			className="w-full rounded-xl bg-panel/80 shadow-soft backdrop-blur-xl"
			action={
				<Button variant="quiet" size="icon-sm" onClick={onClose} aria-label="Hide the events">
					<X />
				</Button>
			}
		>
			{shown.length === 0 ? (
				<p className="px-4 py-3 text-sm text-ink-subtle">Events appear here as the agents publish them.</p>
			) : (
				<ol ref={list} className="flex flex-col p-1.5">
					{shown.map((line, i) => (
						<motion.li
							key={line.key}
							initial={i === 0 ? { opacity: 0.2, y: -4 } : false}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.2, ease: "easeOut" }}
						>
							<button
								type="button"
								onClick={() => useRunStore.getState().seek(line.ms)}
								className={cn(
									"grid w-full grid-cols-[40px_8px_minmax(0,1fr)] items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-300 hover:bg-hover",
									i === 0 && "bg-sunken",
								)}
							>
								<span className="tabular text-xs text-ink-subtle">{format.clock(line.ms)}</span>
								<span className="size-2 self-center rounded-full" style={{ background: COLOR[line.from] }} />
								<span className="min-w-0">
									<span className="font-medium text-ink">{FACE_NAME[line.from]}</span>{" "}
									<span className="text-xs text-ink-subtle">{VERB[line.act]}</span>
									<span className="block leading-snug text-ink-muted">
										<Ids text={sayOne(line, names, true)} />
									</span>
								</span>
							</button>
						</motion.li>
					))}
				</ol>
			)}
		</Pane>
	)
})
