import { Pause, Play, RotateCcw, Zap } from "lucide-react"
import { Slider } from "radix-ui"
import { memo, useMemo, useRef } from "react"
import type * as React from "react"
import { useShallow } from "zustand/react/shallow"
import { Button } from "@/components/ui/button"
import { Segmented } from "@/components/ui/segmented"
import { StatusDot } from "@/components/ui/status"
import { Tooltip } from "@/components/ui/tooltip"
import * as format from "@/lib/format"
import { cn } from "@/lib/utils"
import { MIN_ZOOM_MS, useRunClock, useRunStore, type Speed, type TimeRange } from "@/run/hooks"
import { concurrency } from "@/run/metrics"

/**
 * The player docked at the bottom of a run's Timeline: play or pause, 1× / 4× / skip to the end, and a scrubber.
 * Behind the scrubber, a histogram of model calls in flight shows where the agents overlapped.
 *
 * On the Timeline (`ranged`), the lanes' zoomed range shows over the scrubber as a box you can drag.
 *
 * Only `Time` and `Scrubber` read the clock, so only they re-render on each frame of a replay. The rest (the speed
 * control has a Motion layoutId, which measures layout when it renders) re-renders only when the player state changes.
 */
export function ReplayBar({ className, ranged = false }: { className?: string; ranged?: boolean }) {
	const { live, playing, runStatus, records, duration } = useRunStore(
		useShallow((state) => ({
			live: state.mode === "live",
			playing: state.playing,
			runStatus: state.runStatus,
			records: state.records,
			duration: state.duration,
		})),
	)
	const histogram = useMemo(() => {
		const { series } = concurrency(records, duration, 96)
		const top = Math.max(...series, 1)
		return series.map((n) => (n > 0 ? Math.max(0.08, n / top) : 0))
	}, [records, duration])
	const store = useRunStore.getState()

	return (
		<div
			className={cn(
				"flex h-14 w-full items-center gap-3 border-t border-hairline bg-panel pl-3 pr-4 sm:pl-4 sm:pr-6",
				className,
			)}
		>
			<Tooltip content={playing && !live ? "Pause (Space)" : live ? "Pause the live view (Space)" : "Play (Space)"}>
				<Button variant="ghost" size="icon" onClick={store.toggle} aria-label={playing || live ? "Pause" : "Play"}>
					{playing || live ? <Pause className="fill-current" /> : <Play className="fill-current" />}
				</Button>
			</Tooltip>

			<Time />
			<Scrubber histogram={histogram} ranged={ranged} />

			{runStatus === "live" &&
				(live ? (
					<span className="inline-flex shrink-0 items-center gap-1.5 px-1 text-sm text-working">
						<StatusDot tone="working" pulse />
						Live
					</span>
				) : (
					<Tooltip content="Follow the run as it happens (L)">
						<Button variant="quiet" size="sm" onClick={store.goLive}>
							<StatusDot tone="working" />
							Go live
						</Button>
					</Tooltip>
				))}

			<SpeedControl />

			<Tooltip content="Replay from the start">
				<Button variant="quiet" size="icon-sm" onClick={store.restart} aria-label="Replay from the start" className="hidden sm:inline-flex">
					<RotateCcw />
				</Button>
			</Tooltip>
		</div>
	)
}

/** Where the playhead is and how long the run is. Live, the end moves with the clock. */
function usePlayhead(): { position: number; total: number } {
	const clock = useRunClock()
	const live = useRunStore((state) => state.mode === "live")
	const duration = useRunStore((state) => state.duration)
	const total = live ? Math.max(duration, clock) : duration
	return { position: live ? total : Math.min(clock, duration), total }
}

function Time() {
	const { position, total } = usePlayhead()
	return (
		<span className="tabular w-[5.5rem] shrink-0 text-sm text-ink-muted">
			{format.clock(position)}
			<span className="text-ink-subtle"> / {format.clock(total)}</span>
		</span>
	)
}

type SpeedValue = "1" | "4" | "instant"

const SPEEDS = [
	{ value: "1" as const, label: "1×", title: "Real time" },
	{ value: "4" as const, label: "4×", title: "Four times faster" },
	{ value: "instant" as const, label: <Zap />, title: "Skip to the end" },
]

const setSpeed = (value: SpeedValue) => useRunStore.getState().setSpeed(value === "instant" ? "instant" : (Number(value) as Speed))

/** Its own subscription, so it renders only when the speed changes. */
function SpeedControl() {
	const speed = useRunStore((state) => state.speed)
	return (
		<Segmented<SpeedValue>
			aria-label="Replay speed"
			className="hidden shrink-0 sm:inline-flex"
			value={String(speed) as SpeedValue}
			onValueChange={setSpeed}
			items={SPEEDS}
		/>
	)
}

function Scrubber({ histogram, ranged }: { histogram: number[]; ranged: boolean }) {
	const { position: value, total: max } = usePlayhead()
	const played = max > 0 ? (value / max) * 100 : 0
	const trackRef = useRef<HTMLSpanElement>(null)
	return (
		<Slider.Root
			className="relative flex h-8 min-w-0 flex-1 cursor-pointer touch-none select-none items-center"
			value={[value]}
			max={Math.max(max, 1)}
			step={10}
			onValueChange={([ms]) => useRunStore.getState().seek(ms)}
			aria-label="Playhead"
		>
			<Slider.Track ref={trackRef} className="relative h-full grow">
				<Bars histogram={histogram} className="text-strong" />
				<div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - played}% 0 0)` }}>
					<Bars histogram={histogram} className="text-ink-muted" />
				</div>
				<div className="absolute inset-x-0 bottom-1 h-px bg-hairline" />
				<Slider.Range className="absolute bottom-1 h-px bg-ink-muted" />
				{ranged && <RangeBox total={max} trackRef={trackRef} />}
			</Slider.Track>
			<Slider.Thumb className="block h-6 w-0.5 rounded-full bg-ink outline-none ring-link/30 transition-shadow focus-visible:ring-4" />
		</Slider.Root>
	)
}

/**
 * The range the Timeline is zoomed to, as a box over the scrubber: a minimap of the run.
 * Drag the box to move the range, drag an edge to resize it. Its pointer events stop here, so they never move the playhead.
 */
function RangeBox({ total, trackRef }: { total: number; trackRef: React.RefObject<HTMLElement | null> }) {
	const zoom = useRunStore((state) => state.zoom)
	const drag = useRef<{ part: "move" | "start" | "end"; x: number; range: TimeRange; pointer: number } | null>(null)
	if (!zoom || total <= 0) return null

	const begin = (part: "move" | "start" | "end") => (event: React.PointerEvent<HTMLElement>) => {
		if (event.button !== 0 || !event.isPrimary) return
		event.stopPropagation()
		event.currentTarget.setPointerCapture(event.pointerId)
		drag.current = { part, x: event.clientX, range: zoom, pointer: event.pointerId }
	}
	const move = (event: React.PointerEvent) => {
		const d = drag.current
		const width = trackRef.current?.getBoundingClientRect().width
		if (!d || d.pointer !== event.pointerId || !width) return
		const delta = ((event.clientX - d.x) / width) * total
		const { start, end } = d.range
		const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
		let next: TimeRange
		if (d.part === "move") {
			const from = clamp(start + delta, 0, Math.max(0, total - (end - start)))
			next = { start: from, end: from + (end - start) }
		} else if (d.part === "start") {
			next = { start: clamp(start + delta, 0, end - MIN_ZOOM_MS), end }
		} else {
			next = { start, end: clamp(end + delta, start + MIN_ZOOM_MS, Math.max(total, start + MIN_ZOOM_MS)) }
		}
		useRunStore.getState().setZoom(next)
	}
	const finish = (event: React.PointerEvent) => {
		if (drag.current?.pointer === event.pointerId) drag.current = null
	}

	const left = Math.min(100, (zoom.start / total) * 100)
	const right = Math.min(100, (zoom.end / total) * 100)
	return (
		<div
			role="group"
			aria-label={`Zoomed range ${format.clock(zoom.start)} to ${format.clock(zoom.end)}`}
			title="The range in the lanes. Drag it to move, drag an edge to resize."
			className="absolute inset-y-0 min-w-1.5 cursor-grab touch-none rounded-[2px] border border-ink/40 bg-ink/[0.07] active:cursor-grabbing"
			style={{ left: `${left}%`, width: `${Math.max(0, right - left)}%` }}
			onPointerDown={begin("move")}
			onPointerMove={move}
			onPointerUp={finish}
			onPointerCancel={finish}
		>
			<span onPointerDown={begin("start")} className="absolute inset-y-0 -left-1 w-2 cursor-ew-resize" />
			<span onPointerDown={begin("end")} className="absolute inset-y-0 -right-1 w-2 cursor-ew-resize" />
		</div>
	)
}

/** 96 rects; memoised, so a frame of the replay does not redraw them. */
const Bars = memo(function Bars({ histogram, className }: { histogram: number[]; className?: string }) {
	const width = 100 / histogram.length
	return (
		<svg viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden className={cn("absolute inset-x-0 bottom-1.5 h-5 w-full", className)}>
			{histogram.map((h, i) =>
				h > 0 ? <rect key={i} x={i * width + width * 0.15} width={width * 0.7} y={20 - h * 20} height={h * 20} fill="currentColor" /> : null,
			)}
		</svg>
	)
})
