import type { TraceRecord } from "@shared/types"
import { Pause, Play, RotateCcw, Zap } from "lucide-react"
import { Slider } from "radix-ui"
import { useMemo } from "react"
import { useShallow } from "zustand/react/shallow"
import { Button } from "@/components/ui/button"
import { Segmented } from "@/components/ui/segmented"
import { StatusDot } from "@/components/ui/status"
import { Tooltip } from "@/components/ui/tooltip"
import * as format from "@/lib/format"
import { cn } from "@/lib/utils"
import { useRunClock, useRunStore, type Speed } from "@/run/hooks"

const BUCKETS = 96

/**
 * The floating player at the bottom of a run: play or pause, 1× / 4× / instant, and a scrubber.
 * Behind the scrubber, a histogram of model calls in flight shows where the agents overlapped.
 * The one element with a shadow, like the Kanbix input.
 */
export function ReplayBar({ className }: { className?: string }) {
	const { mode, playing, speed, duration, runStatus, records } = useRunStore(
		useShallow((state) => ({
			mode: state.mode,
			playing: state.playing,
			speed: state.speed,
			duration: state.duration,
			runStatus: state.runStatus,
			records: state.records,
		})),
	)
	const clock = useRunClock()
	const live = mode === "live"
	const total = live ? Math.max(duration, clock) : duration
	const position = live ? total : Math.min(clock, duration)
	const histogram = useMemo(() => concurrency(records, Math.max(duration, 1)), [records, duration])
	const store = useRunStore.getState()

	return (
		<div
			className={cn(
				"pointer-events-auto flex h-12 w-full max-w-2xl items-center gap-2 rounded-xl border border-hairline bg-card pl-2 pr-2.5 shadow-float",
				className,
			)}
		>
			<Tooltip content={playing && !live ? "Pause (Space)" : live ? "Pause the live view (Space)" : "Play (Space)"}>
				<Button variant="ghost" size="icon" onClick={store.toggle} aria-label={playing || live ? "Pause" : "Play"}>
					{playing || live ? <Pause className="fill-current" /> : <Play className="fill-current" />}
				</Button>
			</Tooltip>

			<span className="tabular w-[5.5rem] shrink-0 text-sm text-ink-muted">
				{format.clock(position)}
				<span className="text-ink-subtle"> / {format.clock(total)}</span>
			</span>

			<Scrubber value={position} max={total} histogram={histogram} onSeek={store.seek} />

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

			<Segmented<SpeedValue>
				aria-label="Replay speed"
				className="hidden shrink-0 sm:inline-flex"
				value={String(speed) as SpeedValue}
				onValueChange={(value) => store.setSpeed(value === "instant" ? "instant" : (Number(value) as Speed))}
				items={[
					{ value: "1", label: "1×", title: "Real time" },
					{ value: "4", label: "4×", title: "Four times faster" },
					{ value: "instant", label: <Zap />, title: "Skip to the end" },
				]}
			/>

			<Tooltip content="Replay from the start">
				<Button variant="quiet" size="icon-sm" onClick={store.restart} aria-label="Replay from the start" className="hidden sm:inline-flex">
					<RotateCcw />
				</Button>
			</Tooltip>
		</div>
	)
}

type SpeedValue = "1" | "4" | "instant"

function Scrubber({
	value,
	max,
	histogram,
	onSeek,
}: {
	value: number
	max: number
	histogram: number[]
	onSeek: (ms: number) => void
}) {
	const played = max > 0 ? (value / max) * 100 : 0
	return (
		<Slider.Root
			className="relative flex h-8 min-w-0 flex-1 cursor-pointer touch-none select-none items-center"
			value={[value]}
			max={Math.max(max, 1)}
			step={10}
			onValueChange={([ms]) => onSeek(ms)}
			aria-label="Playhead"
		>
			<Slider.Track className="relative h-full grow">
				<Bars histogram={histogram} className="text-strong" />
				<div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - played}% 0 0)` }}>
					<Bars histogram={histogram} className="text-ink-muted" />
				</div>
				<div className="absolute inset-x-0 bottom-1 h-px bg-hairline" />
				<Slider.Range className="absolute bottom-1 h-px bg-ink-muted" />
			</Slider.Track>
			<Slider.Thumb className="block h-6 w-0.5 rounded-full bg-ink outline-none ring-primary/30 transition-shadow focus-visible:ring-4" />
		</Slider.Root>
	)
}

function Bars({ histogram, className }: { histogram: number[]; className?: string }) {
	const width = 100 / histogram.length
	return (
		<svg viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden className={cn("absolute inset-x-0 bottom-1.5 h-5 w-full", className)}>
			{histogram.map((h, i) =>
				h > 0 ? <rect key={i} x={i * width + width * 0.15} width={width * 0.7} y={20 - h * 20} height={h * 20} fill="currentColor" /> : null,
			)}
		</svg>
	)
}

/** Model calls in flight over time, in BUCKETS slices, scaled 0..1. */
function concurrency(records: TraceRecord[], duration: number): number[] {
	const load = new Array<number>(BUCKETS).fill(0)
	const size = duration / BUCKETS
	const open = new Map<string, number>()
	const add = (start: number, end: number) => {
		for (let i = Math.floor(start / size); i <= Math.min(BUCKETS - 1, Math.floor(end / size)); i++) {
			const overlap = Math.min(end, (i + 1) * size) - Math.max(start, i * size)
			if (overlap > 0) load[i] += overlap / size
		}
	}
	for (const record of records) {
		if (!record.loopId) continue
		if (record.kind === "inference.started") open.set(record.loopId, record.ms)
		else if (record.kind === "inference.completed") {
			const start = open.get(record.loopId)
			if (start != null) add(start, record.ms)
			open.delete(record.loopId)
		}
	}
	for (const start of open.values()) add(start, duration)
	const peak = Math.max(...load, 1)
	return load.map((n) => (n > 0 ? Math.max(0.08, n / peak) : 0))
}
