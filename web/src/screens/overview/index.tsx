import type { Claim } from "@shared/types"
import { FileText } from "lucide-react"
import { useMemo } from "react"
import { Link } from "react-router"
import { useShallow } from "zustand/react/shallow"
import { ClaimText } from "@/components/shell/source"
import { Button } from "@/components/ui/button"
import { Card, Section, Stat } from "@/components/ui/card"
import { Chip } from "@/components/ui/chip"
import { EmptyState } from "@/components/ui/empty"
import { StatusDot, type StatusTone } from "@/components/ui/status"
import * as format from "@/lib/format"
import { cn } from "@/lib/utils"
import { useFullView, useRunStore } from "@/run/hooks"
import { concurrency, pipeline, type Stage, type StageState } from "@/run/metrics"

/** `/runs/:id/overview`: what the run did, in one screen. Reads the whole run, whatever the replay shows. */
export function OverviewScreen() {
	const { records, results, info, live, duration } = useRunStore(
		useShallow((state) => ({
			records: state.records,
			results: state.results,
			info: state.info,
			live: state.runStatus === "live",
			duration: state.duration,
		})),
	)
	const view = useFullView()
	const load = useMemo(() => concurrency(records, duration), [records, duration])
	const stages = useMemo(() => pipeline(records, view, results, live), [records, view, results, live])
	const rejections = useMemo(() => latestRejections(records), [records])
	const { totals } = view

	if (records.length === 0 && !live) {
		return <EmptyState title="This run has no events">Its trace is empty. It may have stopped before any agent started.</EmptyState>
	}

	return (
		<div className="flex flex-col gap-10">
			<Card className="grid grid-cols-2 gap-x-6 gap-y-5 p-5 sm:grid-cols-3 lg:grid-cols-5 lg:divide-x lg:divide-hairline lg:p-0">
				<Stat className="lg:p-5" label="Duration" value={format.duration(view.lastMs)} />
				<Stat className="lg:p-5" label="Agents" value={view.agents.size} hint={`${totals.done} of ${format.plural(totals.tasks, "task")} done`} />
				<Stat className="lg:p-5" label="Most at once" value={`${load.peak} model calls`} hint={load.peak > 1 ? `at ${format.clock(load.peakMs)}` : undefined} />
				<Stat className="lg:p-5" label="Tokens" value={format.tokens(totals.tokens)} />
				<Stat
					className="lg:p-5"
					label="Cost"
					value={totals.costUsd > 0 ? `${format.usd(totals.costUsd)}${totals.costKnown ? "" : "+"}` : "—"}
					hint={info?.mock ? "simulated, no API calls" : undefined}
				/>
			</Card>

			<Section title="How the run went" description="Each step starts as soon as its input exists, so they overlap.">
				<Pipeline stages={stages} />
			</Section>

			<Section
				title="Agents at work"
				description="Model calls in flight over time. Where the area is tall, many agents work at once."
				action={
					<Button size="sm" asChild>
						<Link to="../live">Open the timeline</Link>
					</Button>
				}
			>
				<Card className="p-5">
					<LoadChart series={load.series} peak={load.peak} peakMs={load.peakMs} duration={duration} />
				</Card>
			</Section>

			<div className="grid gap-10 lg:grid-cols-2">
				<Section title="What the Critic caught" description="Every claim needs a source that supports it. Unsupported claims go back to their writer.">
					<Card className="p-0">
						{rejections.length === 0 ? (
							<p className="p-5 text-sm text-ink-muted">{stages[4].count ? "Every claim it checked had support." : "No reviews yet."}</p>
						) : (
							rejections.map((item, i) => (
								<div key={i} className="border-b border-hairline p-5 last:border-b-0">
									<div className="mb-2 flex items-center gap-2 text-xs text-ink-muted">
										<StatusDot tone="needs" />
										<span>
											{item.kind} <span className="font-mono">{item.id}</span> · at {format.clock(item.ms)}
										</span>
									</div>
									<ClaimText claim={item.claim} struck className="text-sm" />
									<p className="mt-1.5 line-clamp-3 text-sm text-ink-muted">{item.reason}</p>
								</div>
							))
						)}
					</Card>
				</Section>

				<Section
					title="Proposals"
					description="What a company and a researcher would sit down over."
					action={
						results?.proposals.length ? (
							<Button size="sm" asChild>
								<Link to="../results">All results</Link>
							</Button>
						) : undefined
					}
				>
					<Card className="p-0">
						{!results?.proposals.length ? (
							<p className="p-5 text-sm text-ink-muted">{live ? "Writers post proposals here as pairs are chosen." : "This run wrote no proposals."}</p>
						) : (
							results.proposals.slice(0, 5).map((proposal) => (
								<Link
									key={proposal.id}
									to="../results"
									className="flex items-start gap-3 border-b border-hairline p-5 transition-colors last:border-b-0 hover:bg-hover"
								>
									<FileText className="mt-0.5 size-4 shrink-0 text-ink-subtle" />
									<div className="min-w-0 flex-1">
										<div className="line-clamp-2 font-medium text-ink">{proposal.title}</div>
										<div className="mt-1 font-mono text-xs text-ink-subtle">{proposal.pairId || proposal.id}</div>
									</div>
									<Chip>{proposal.kind === "industrial-phd" ? "Industrial PhD" : "Joint project"}</Chip>
								</Link>
							))
						)}
					</Card>
				</Section>
			</div>
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
function Pipeline({ stages }: { stages: Stage[] }) {
	return (
		<div className="grid overflow-hidden rounded-lg border border-hairline bg-panel shadow-card sm:grid-cols-2 lg:grid-cols-5 lg:divide-x lg:divide-hairline">
			{stages.map((stage, i) => {
				const tone = STAGE_TONE[stage.state]
				const idle = stage.state === "skipped" || stage.state === "waiting"
				return (
					<div key={stage.key} className="border-b border-hairline p-5 last:border-b-0 lg:border-b-0">
						<div className="flex items-center justify-between gap-2 text-sm">
							<span className="text-ink-muted">
								<span className="tabular mr-2 text-ink-subtle">{i + 1}</span>
								{stage.label}
							</span>
							<span className="inline-flex items-center gap-1.5 text-xs text-ink-subtle">
								<StatusDot tone={stage.state === "done" ? "working" : tone.tone} pulse={tone.pulse} className="size-1.5" />
								{tone.label}
							</span>
						</div>
						<div className={cn("tabular mt-4 text-3xl font-semibold tracking-tight", idle ? "text-ink-subtle" : "text-ink")}>
							{idle && stage.count === 0 ? "—" : stage.count}
						</div>
						<div className="mt-1 text-sm text-ink-muted">{stage.unit}</div>
						{stage.detail && <div className="mt-0.5 text-xs text-ink-subtle">{stage.detail}</div>}
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
		<div>
			<div className="relative h-44">
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

/** The last few claims the Critic rejected, newest first. */
function latestRejections(records: { kind: string; ms: number; data?: unknown }[], limit = 3): Rejection[] {
	const found: Rejection[] = []
	for (let i = records.length - 1; i >= 0 && found.length < limit; i--) {
		const record = records[i]
		if (record.kind !== "critic.verdict") continue
		const data = record.data as { kind?: string; id?: string; rejected?: { claim: Claim; reason: string }[] } | undefined
		for (const item of data?.rejected ?? []) {
			if (found.length >= limit) break
			found.push({ kind: data?.kind ?? "", id: data?.id ?? "", ms: record.ms, claim: item.claim, reason: item.reason })
		}
	}
	return found
}
