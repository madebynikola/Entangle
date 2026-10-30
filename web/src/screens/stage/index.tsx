import { List as ListIcon, X } from "lucide-react"
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
 * to everyone; the speaker says it in a bubble, the Critic stamps what it checks, and the faces nod, flinch and cheer.
 */

/** Each face's role, for its label. You is the person who approves pairs. */
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

/** Where each face sits, as a share of the stage: a loose ring, a little off true so it does not look ruled. */
const SEAT: Record<FaceId, [number, number]> = {
	deneb: [0.5, 0.15],
	tycho: [0.795, 0.265],
	fides: [0.885, 0.585],
	you: [0.665, 0.865],
	tinta: [0.335, 0.855],
	amity: [0.115, 0.605],
	spica: [0.21, 0.28],
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
		<div ref={ref} className="relative h-full overflow-hidden bg-sunken">
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
		const bus: Point = [left + boxWidth / 2, top + boxHeight / 2]
		const seats = Object.fromEntries(
			ORDER.map((face) => [face, [left + SEAT[face][0] * boxWidth, top + SEAT[face][1] * boxHeight]]),
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
								place={PLACE[face]}
								shift={Math.min(Math.max(x, safe.left + BUBBLE_HALF), safe.left + width - BUBBLE_HALF) - x}
								waiting={face === "you" ? waiting : 0}
								glide={glide}
							/>
						)
					})}
					<AnimatePresence>
						{beats
							.filter((beat) => beat.stamp)
							.slice(-2)
							.map((beat) => (
								<Stamp key={beat.id} ok={beat.stamp!.ok} x={seats[beat.stamp!.on][0]} y={seats[beat.stamp!.on][1]} />
							))}
					</AnimatePresence>
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
		<div className={cn("absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center", glide && SETTLE)} style={{ left: x, top: y }}>
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
			<div className="mt-2 text-2xs text-ink-subtle">event bus</div>
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
	place,
	shift,
	waiting,
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
	place: Place
	/** Moves the bubble sideways (px) so the stage edge does not cut it. */
	shift: number
	waiting: number
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
		<div className={cn("absolute flex w-36 -translate-x-1/2 -translate-y-1/2 flex-col items-center", glide && SETTLE)} style={{ left: x, top: y }}>
			<div className="relative">
				<div ref={scope} className="origin-bottom">
					<AgentFace
						face={face}
						state={state}
						gaze={gaze}
						label={`${FACE_NAME[face]}, ${label}: ${state}`}
						className={cn(small ? "size-14" : "size-[76px]", talking && "face-talk")}
					/>
				</div>
				<AnimatePresence>
					{state === "working" && face !== "you" && face !== "deneb" && (
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
				<AnimatePresence>{beat && <Bubble key={beat.id} text={beat.text} place={place} shift={shift} />}</AnimatePresence>
			</div>
			<div className="mt-1 flex items-baseline gap-1">
				<span className="text-sm font-semibold text-ink">{FACE_NAME[face]}</span>
				{count && <span className="tabular text-xs text-ink-subtle">{count}</span>}
			</div>
			<span className="text-2xs text-ink-muted">{label}</span>
			{(working || waiting > 0) && <span className="tabular text-2xs text-working">{waiting > 0 ? `${waiting} to approve` : working}</span>}
		</div>
	)
}

/** Half the widest bubble, to keep bubbles inside the stage. */
const BUBBLE_HALF = 120

type Place = "above" | "below"

/**
 * Where each face speaks, so bubbles land in open space: Deneb (no room above) and the two at mid height (Spica
 * and Tycho sit above them) below their names, the rest above.
 */
const PLACE: Record<FaceId, Place> = { deneb: "below", tycho: "above", fides: "below", you: "above", tinta: "above", amity: "below", spica: "above" }

/** A speech bubble that rises out of its speaker and sinks back into it. */
function Bubble({ text, place, shift }: { text: string; place: Place; shift: number }) {
	const above = place === "above"
	return (
		<div
			className={cn(
				"absolute left-1/2 z-10 w-max -translate-x-1/2",
				above ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+52px)]",
			)}
			style={{ marginLeft: shift }}
		>
			<motion.div
				className="max-w-60 rounded-[18px] border border-hairline bg-panel px-3 py-2 text-xs leading-snug text-ink shadow-soft"
				style={{ transformOrigin: `calc(50% - ${shift}px) ${above ? "100%" : "0%"}` }}
				initial={{ opacity: 0, scale: 0.86, y: above ? 8 : -8 }}
				animate={{ opacity: 1, scale: 1, y: 0, transition: SPRING }}
				exit={{ opacity: 0, scale: 0.82, transition: { duration: 0.18, ease: "easeIn" } }}
			>
				<Ids text={text} />
			</motion.div>
		</div>
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

/** The Critic's verdict, slammed onto the face it judged: it drops in large, overshoots, settles, then fades. */
function Stamp({ ok, x, y }: { ok: boolean; x: number; y: number }) {
	return (
		<motion.div
			className={cn(
				"pointer-events-none absolute z-20 rounded-md border-[2.5px] bg-panel/90 px-2.5 py-0.5 text-xs font-bold uppercase tracking-[0.08em]",
				ok ? "border-working text-working" : "border-failed text-failed",
			)}
			style={{ left: x + 6, top: y - 50 }}
			initial={{ opacity: 0, scale: 1.9, rotate: -16 }}
			animate={{ opacity: 1, scale: 1, rotate: -10, transition: { type: "spring", stiffness: 560, damping: 16, delay: STAMP_AT / 1000 } }}
			exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.35 } }}
		>
			{ok ? "Passed" : "Sent back"}
		</motion.div>
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
