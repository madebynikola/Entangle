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
import { concurrency } from "@/run/metrics"

/**
 * The player docked at the bottom of a run's Timeline: play or pause, 1× / 4× / skip to the end, and a scrubber.
 * Behind the scrubber, a histogram of model calls in flight shows where the agents overlapped.
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
			<Slider.Thumb className="block h-6 w-0.5 rounded-full bg-ink outline-none ring-link/30 transition-shadow focus-visible:ring-4" />
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
