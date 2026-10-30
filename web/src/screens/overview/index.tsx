import type { Claim } from "@shared/types"
import { ArrowRight, FileText } from "lucide-react"
import { useMemo } from "react"
import { Link } from "react-router"
import { useShallow } from "zustand/react/shallow"
import { ClaimText } from "@/components/shell/source"
import { Button } from "@/components/ui/button"
import { Pane } from "@/components/ui/card"
import { Chip } from "@/components/ui/chip"
import { EmptyState } from "@/components/ui/empty"
import { StatusDot, type StatusTone } from "@/components/ui/status"
import * as format from "@/lib/format"
import { cn } from "@/lib/utils"
import { useFullView, useRunStore } from "@/run/hooks"
import { concurrency, pipeline, type Stage, type StageState } from "@/run/metrics"

/**
 * `/runs/:id/overview`: what the run did, in one screen that fits the window. The run's totals sit in the header.
 * Reads the whole run, whatever the replay shows.
 */
export function OverviewScreen() {
	const { records, results, live, duration } = useRunStore(
		useShallow((state) => ({
			records: state.records,
			results: state.results,
			live: state.runStatus === "live",
			duration: state.duration,
		})),
	)
	const view = useFullView()
	const load = useMemo(() => concurrency(records, duration), [records, duration])
	const stages = useMemo(() => pipeline(records, view, results, live), [records, view, results, live])
	const rejections = useMemo(() => latestRejections(records), [records])

	if (records.length === 0 && !live) {
		return (
			<EmptyState className="h-full" title="This run has no events">
				Its trace is empty. It may have stopped before any agent started.
			</EmptyState>
		)
	}

	return (
		// Wide screens: three bands that share the height, so the whole story fits without scrolling. Narrow: one column.
		<div className="flex flex-col gap-4 p-4 sm:p-5 lg:grid lg:h-full lg:min-h-[34rem] lg:grid-cols-2 lg:grid-rows-[auto_minmax(0,1fr)_minmax(0,1fr)]">
			<Pipeline stages={stages} className="lg:col-span-2" />

			<Pane
				className="h-64 lg:col-span-2 lg:h-auto"
				title="Agents at work"
				description="Model calls in flight over time. Where it is tall, many agents work at once."
				action={
					<Button size="sm" variant="ghost" asChild>
						<Link to="../live">
							Open the timeline
							<ArrowRight />
						</Link>
					</Button>
				}
				bodyClassName="flex flex-col px-4 pb-3 pt-7"
			>
				<LoadChart series={load.series} peak={load.peak} peakMs={load.peakMs} duration={duration} />
			</Pane>

			<Pane
				className="max-h-96 lg:max-h-none"
				title="What the Critic caught"
				count={rejections.total || undefined}
				description="Claims with no source behind them"
				scroll
			>
				{rejections.items.length === 0 ? (
					<p className="p-4 text-sm text-ink-muted">{stages[4].count ? "Every claim it checked had a source." : "No reviews yet."}</p>
				) : (
					rejections.items.map((item, i) => (
						<div key={i} className="border-b border-hairline px-4 py-3 last:border-b-0">
							<div className="mb-1.5 flex items-center gap-2 text-xs text-ink-muted">
								<StatusDot tone="needs" />
								<span>
									{item.kind} <span className="font-mono">{item.id}</span> · at {format.clock(item.ms)}
								</span>
							</div>
							<ClaimText claim={item.claim} struck className="text-sm" />
							<p className="mt-1 line-clamp-2 text-sm text-ink-muted">{item.reason}</p>
						</div>
					))
				)}
			</Pane>

			<Pane
				className="max-h-96 lg:max-h-none"
				title="Proposals"
				count={results?.proposals.length || undefined}
				description="What each pair would work on together"
				scroll
				action={
					results?.proposals.length ? (
						<Button size="sm" variant="ghost" asChild>
							<Link to="../results">
								All results
								<ArrowRight />
							</Link>
						</Button>
					) : undefined
				}
			>
				{!results?.proposals.length ? (
					<p className="p-4 text-sm text-ink-muted">{live ? "Writers post proposals here as pairs are chosen." : "This run wrote no proposals."}</p>
				) : (
					results.proposals.map((proposal) => (
						<Link
							key={proposal.id}
							to="../results"
							className="flex items-start gap-3 border-b border-hairline px-4 py-3 transition-colors last:border-b-0 hover:bg-hover"
						>
							<FileText className="mt-0.5 size-4 shrink-0 text-ink-subtle" />
							<div className="min-w-0 flex-1">
								<div className="line-clamp-2 text-base text-ink">{proposal.title}</div>
								<div className="mt-0.5 font-mono text-xs text-ink-subtle">{proposal.pairId || proposal.id}</div>
							</div>
							<Chip className="shrink-0">{proposal.kind === "industrial-phd" ? "Industrial PhD" : "Joint project"}</Chip>
						</Link>
					))
				)}
			</Pane>
		</div>
	)
}

const STAGE_TONE: Record<StageState, { tone: StatusTone; label: string; pulse?: boolean }> = {
	done: { tone: "idle", label: "Done" },
	working: { tone: "working", label: "Working", pulse: true },
	waiting: { tone: "idle", label: "Waiting" },
	skipped: { tone: "idle", label: "Not run" },
}

/** Five steps in order. Numbers here are a real sequence: each step feeds the next. */
function Pipeline({ stages, className }: { stages: Stage[]; className?: string }) {
	return (
		<div
			className={cn(
				"grid shrink-0 overflow-hidden rounded-lg border border-hairline bg-card shadow-card sm:grid-cols-5 sm:divide-x sm:divide-hairline",
				className,
			)}
		>
			{stages.map((stage, i) => {
				const tone = STAGE_TONE[stage.state]
				const idle = stage.state === "skipped" || stage.state === "waiting"
				return (
					<div key={stage.key} className="min-w-0 border-b border-hairline px-4 py-3.5 last:border-b-0 sm:border-b-0">
						<div className="flex items-center justify-between gap-2 text-sm">
							<span className="truncate text-ink-muted">
								<span className="tabular mr-2 text-ink-subtle">{i + 1}</span>
								{stage.label}
							</span>
							<StatusDot tone={stage.state === "done" ? "working" : tone.tone} pulse={tone.pulse} className="size-1.5" />
						</div>
						<div className="mt-2 flex items-baseline gap-1.5">
							<span className={cn("tabular text-2xl font-semibold tracking-tight", idle ? "text-ink-subtle" : "text-ink")}>
								{idle && stage.count === 0 ? "—" : stage.count}
							</span>
							<span className="truncate text-sm text-ink-muted">{stage.unit}</span>
						</div>
						<div className="mt-0.5 truncate text-xs text-ink-subtle" title={stage.detail}>
							{stage.detail || tone.label}
						</div>
					</div>
				)
			})}
		</div>
	)
}

/** An area chart of calls in flight, with the peak marked and a time axis. */
function LoadChart({ series, peak, peakMs, duration }: { series: number[]; peak: number; peakMs: number; duration: number }) {
	const top = Math.max(peak, 1)
	const w = 100
	const h = 40
	const step = w / series.length
	const points = series.map((n, i) => `${(i + 0.5) * step},${h - (n / top) * h}`)
	const area = `M0,${h} L${points.join(" L")} L${w},${h} Z`
	const line = `M${points.join(" L")}`
	const peakX = duration > 0 ? (peakMs / duration) * 100 : 0
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="relative min-h-0 flex-1">
				<svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
					{[0.25, 0.5, 0.75].map((y) => (
						<line key={y} x1="0" x2={w} y1={h * y} y2={h * y} stroke="var(--hairline)" strokeWidth="0.15" vectorEffect="non-scaling-stroke" />
					))}
					<path d={area} fill="color-mix(in oklab, var(--ink) 8%, transparent)" />
					<path d={line} fill="none" stroke="var(--ink)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
				</svg>
				{peak > 1 && (
					<div className="pointer-events-none absolute inset-y-0" style={{ left: `${peakX}%` }}>
						<div className="h-full border-l border-dashed border-strong" />
						<div className="absolute top-0 -translate-x-1/2 -translate-y-full whitespace-nowrap pb-1 text-xs font-medium text-ink">
							{peak} at once
						</div>
					</div>
				)}
				<div className="tabular absolute left-0 top-0 -translate-y-full pb-1 text-xs text-ink-subtle">{peak}</div>
			</div>
			<div className="tabular mt-2 flex justify-between text-xs text-ink-subtle">
				<span>0:00</span>
				<span>{format.clock(duration / 2)}</span>
				<span>{format.clock(duration)}</span>
			</div>
		</div>
	)
}

interface Rejection {
	kind: string
	id: string
	ms: number
	claim: Claim
	reason: string
}

/** Every claim the Critic rejected (`total`), and the newest of them to list. */
function latestRejections(records: { kind: string; ms: number; data?: unknown }[], limit = 50): { items: Rejection[]; total: number } {
	const items: Rejection[] = []
	let total = 0
	for (let i = records.length - 1; i >= 0; i--) {
		const record = records[i]
		if (record.kind !== "critic.verdict") continue
		const data = record.data as { kind?: string; id?: string; rejected?: { claim: Claim; reason: string }[] } | undefined
		for (const item of data?.rejected ?? []) {
			total++
			if (items.length < limit) items.push({ kind: data?.kind ?? "", id: data?.id ?? "", ms: record.ms, claim: item.claim, reason: item.reason })
		}
	}
	return { items, total }
}
