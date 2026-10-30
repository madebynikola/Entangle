/**
 * STUB from #12. Card #20 owns this folder and replaces this screen with the real Timeline.
 * It shows how to read the run: useRunView() for agents, loops, tasks and the feed; useRunClock() for time.
 */
import type { TraceRecord } from "@shared/types"
import { useMemo } from "react"
import { Card, Section } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty"
import { RoleSquare } from "@/components/ui/role"
import { StatusDot, type StatusTone } from "@/components/ui/status"
import { Tooltip } from "@/components/ui/tooltip"
import * as format from "@/lib/format"
import { roleColor, roleOf } from "@/lib/roles"
import { cn } from "@/lib/utils"
import { sortAgents, type AgentView, type LoopView } from "@/run/fold"
import { useRun, useRunClock, useRunView } from "@/run/hooks"

export function LiveScreen() {
	const view = useRunView()
	const duration = useRun((state) => state.duration)
	const clock = useRunClock()
	const agents = useMemo(() => sortAgents(view.agents.values()), [view.agents])
	const loopsByAgent = useMemo(() => {
		const map = new Map<string, LoopView[]>()
		for (const loop of view.loops.values()) map.set(loop.agentId, [...(map.get(loop.agentId) ?? []), loop])
		return map
	}, [view.loops])

	if (agents.length === 0) {
		return (
			<EmptyState title={clock > 0 ? "No agent has joined yet" : "Press play to watch the run"} className="py-20">
				Each agent gets a lane. A bar is one model call, so stacked bars are agents working at the same time.
			</EmptyState>
		)
	}
	const span = Math.max(duration, clock, 1)
	const working = agents.filter((agent) => agent.activity !== "idle").length

	return (
		<div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_18rem]">
			<Section
				title="Agents"
				description={`${format.plural(agents.length, "agent")} · ${working} working now · a bar is one model call`}
			>
				<Card className="overflow-hidden p-0">
					<div className="relative">
						{agents.map((agent) => (
							<Lane key={agent.id} agent={agent} loops={loopsByAgent.get(agent.id) ?? []} clock={clock} span={span} />
						))}
						<div
							className="pointer-events-none absolute inset-y-0 w-px bg-ink/50"
							style={{ left: `calc(10rem + (100% - 10rem) * ${Math.min(1, clock / span)})` }}
						/>
					</div>
					<div className="tabular flex justify-between border-t border-hairline py-2 pl-40 pr-3 text-xs text-ink-subtle">
						<span>0:00</span>
						<span>{format.clock(span / 2)}</span>
						<span>{format.clock(span)}</span>
					</div>
				</Card>
			</Section>
			<Section title="Events" description="The newest at the top.">
				<Events records={view.feed} />
			</Section>
		</div>
	)
}

function Lane({ agent, loops, clock, span }: { agent: AgentView; loops: LoopView[]; clock: number; span: number }) {
	const pct = (ms: number) => `${(ms / span) * 100}%`
	const color = roleColor(agent.role)
	const busy = agent.activity !== "idle"
	return (
		<div className="flex h-9 items-center border-b border-hairline last:border-b-0">
			<div className="flex w-40 shrink-0 items-center gap-2 px-4 text-sm">
				<RoleSquare role={agent.role} />
				<span className={cn("truncate", busy ? "text-ink" : "text-ink-muted")}>{agent.name}</span>
			</div>
			<div className="relative h-full min-w-0 flex-1 border-l border-hairline">
				{loops.flatMap((loop) =>
					loop.inferences.map((call, i) => {
						const end = call.endMs ?? clock
						return (
							<Tooltip key={`${loop.id}-${i}`} content={`${loop.taskId ?? "loop"} · ${format.duration(end - call.startMs)}`}>
								<div
									className="absolute top-1/2 h-3.5 -translate-y-1/2 rounded-[3px]"
									style={{
										left: pct(call.startMs),
										width: `max(2px, ${pct(Math.max(0, end - call.startMs))})`,
										background: color,
										opacity: call.endMs == null ? 1 : 0.85,
									}}
								/>
							</Tooltip>
						)
					}),
				)}
			</div>
		</div>
	)
}

function Events({ records }: { records: TraceRecord[] }) {
	const recent = records.slice(-12).reverse()
	if (!recent.length) return <p className="text-sm text-ink-muted">Results and Critic verdicts appear here as they happen.</p>
	return (
		<ol className="flex flex-col">
			{recent.map((record, i) => {
				const line = describe(record)
				return (
					// The feed only grows, so a record's index in it is a stable key.
					<li key={records.length - i} className="flex gap-3 border-b border-hairline py-2.5 text-sm last:border-b-0">
						<StatusDot tone={line.tone} className="mt-1.5" />
						<div className="min-w-0 flex-1">
							<div className="truncate text-ink">{line.text}</div>
							<div className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-subtle">
								<RoleSquare role={roleOf(record.agent)} className="size-2" />
								{record.agent} · {format.clock(record.ms)}
							</div>
						</div>
					</li>
				)
			})}
		</ol>
	)
}

function describe(record: TraceRecord): { text: string; tone: StatusTone } {
	const data = record.data as { ok?: boolean; kind?: string; id?: string; error?: string } | undefined
	const subject = `${data?.kind ?? ""} ${data?.id ?? ""}`.trim()
	switch (record.kind) {
		case "task.completed":
			return { text: `Finished ${record.taskId}`, tone: "idle" }
		case "task.failed":
			return { text: `${record.taskId} failed`, tone: "failed" }
		case "artifact.posted":
			return { text: `Posted ${subject}`, tone: "idle" }
		case "critic.reviewing":
			return { text: `Reviewing ${subject}`, tone: "idle" }
		case "critic.verdict":
			return data?.ok ? { text: `${subject} passed review`, tone: "working" } : { text: `${subject} rejected`, tone: "needs" }
		case "critic.sent_back":
			return { text: `${subject} sent back to its writer`, tone: "needs" }
		default:
			return { text: record.kind, tone: "idle" }
	}
}
