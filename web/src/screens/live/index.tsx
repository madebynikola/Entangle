/**
 * STUB from #12. Card #20 owns this folder and replaces this screen with the real live run view.
 * It shows how to read the run: useRunView() for agents, loops, tasks and the feed; useRunClock() for time.
 */
import type { TraceRecord } from "@shared/types"
import { AnimatePresence, motion } from "motion/react"
import { useMemo } from "react"
import { Card, Lane, Meta } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty"
import { RoleSquare, RoleTag } from "@/components/ui/role"
import { Status } from "@/components/ui/status"
import { Tooltip } from "@/components/ui/tooltip"
import * as format from "@/lib/format"
import { roleColor, roleOf } from "@/lib/roles"
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
		return <EmptyState title="Waiting for agents" className="py-20">Agents appear here as they join the run.</EmptyState>
	}
	const span = Math.max(duration, clock, 1)

	return (
		<div className="grid gap-4 px-6 pb-28 pt-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
			<Lane title="Timeline" count={format.clock(clock)}>
				<Card className="p-0">
					{agents.map((agent) => (
						<Row key={agent.id} agent={agent} loops={loopsByAgent.get(agent.id) ?? []} clock={clock} span={span} />
					))}
				</Card>
			</Lane>
			<Lane title="Blackboard" count={view.feed.length}>
				<Feed records={view.feed} />
			</Lane>
		</div>
	)
}

function Row({ agent, loops, clock, span }: { agent: AgentView; loops: LoopView[]; clock: number; span: number }) {
	const x = (ms: number) => `${(ms / span) * 100}%`
	const w = (start: number, end: number | undefined) => `${(Math.max(0, (end ?? clock) - start) / span) * 100}%`
	const color = roleColor(agent.role)
	return (
		<div className="flex h-9 items-center border-b border-hairline last:border-b-0">
			<div className="flex w-40 shrink-0 items-center gap-2 px-3 text-sm">
				<RoleTag role={agent.role} className={agent.activity === "idle" ? "text-ink-muted" : "text-ink"}>
					{agent.name}
				</RoleTag>
			</div>
			<div className="relative h-full min-w-0 flex-1 border-l border-hairline">
				{loops.map((loop) => (
					<Tooltip key={loop.id} content={`${loop.taskId ?? "loop"} · ${format.duration((loop.endMs ?? clock) - loop.startMs)}`}>
						<div
							className="absolute top-2 h-5 rounded-xs"
							style={{ left: x(loop.startMs), width: w(loop.startMs, loop.endMs), background: `color-mix(in oklab, ${color} 16%, transparent)` }}
						>
							{loop.inferences.map((span, i) => (
								<div
									key={i}
									className="absolute inset-y-1 rounded-[2px]"
									style={{ left: `${((span.startMs - loop.startMs) / Math.max(1, (loop.endMs ?? clock) - loop.startMs)) * 100}%`, width: `${((Math.max(0, (span.endMs ?? clock) - span.startMs)) / Math.max(1, (loop.endMs ?? clock) - loop.startMs)) * 100}%`, background: color }}
								/>
							))}
						</div>
					</Tooltip>
				))}
			</div>
		</div>
	)
}

function Feed({ records }: { records: TraceRecord[] }) {
	// The feed only grows, so a record's index in it is a stable key.
	const first = Math.max(0, records.length - 14)
	const recent = records.slice(first).map((record, i) => ({ record, key: first + i })).reverse()
	if (!recent.length) return <p className="px-2.5 pb-2 text-sm text-ink-muted">Results land here as agents finish tasks.</p>
	return (
		<AnimatePresence initial={false} mode="popLayout">
			{recent.map(({ record, key }) => (
				<motion.div
					key={key}
					layout
					initial={{ opacity: 0, y: -8 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
				>
					<Card className="p-3">
						<div className="flex items-center gap-2 text-sm">
							<RoleSquare role={roleOf(record.agent)} />
							<span className="text-ink">{record.agent}</span>
							<span className="ml-auto tabular text-xs text-ink-subtle">{format.clock(record.ms)}</span>
						</div>
						<FeedLine record={record} />
					</Card>
				</motion.div>
			))}
		</AnimatePresence>
	)
}

function FeedLine({ record }: { record: TraceRecord }) {
	const data = record.data as { ok?: boolean; kind?: string; id?: string; error?: string } | undefined
	const subject = `${data?.kind ?? ""} ${data?.id ?? ""}`.trim()
	switch (record.kind) {
		case "task.completed":
			return <Meta className="mt-1" items={[`finished ${record.taskId}`]} />
		case "task.failed":
			return <Status tone="failed" className="mt-1 text-sm">{`${record.taskId} failed: ${data?.error ?? ""}`}</Status>
		case "artifact.posted":
			return <Meta className="mt-1" items={[`posted ${subject}`]} />
		case "critic.reviewing":
			return <Meta className="mt-1" items={[`reviewing ${subject}`]} />
		case "critic.verdict":
			return (
				<Status tone={data?.ok ? "working" : "needs"} className="mt-1 text-sm">
					{data?.ok ? `${subject} passed review` : `${subject} rejected`}
				</Status>
			)
		case "critic.sent_back":
			return <Status tone="needs" className="mt-1 text-sm">{`${subject} sent back to its writer`}</Status>
		default:
			return <Meta className="mt-1" items={[record.kind]} />
	}
}
