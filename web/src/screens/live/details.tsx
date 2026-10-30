import { Undo2 } from "lucide-react"
import { ClaimText } from "@/components/shell/source"
import { Button } from "@/components/ui/button"
import { Stat } from "@/components/ui/card"
import { Chip } from "@/components/ui/chip"
import { Dialog, DialogContent, DialogDescription, DialogTitle, SheetContent } from "@/components/ui/dialog"
import { RoleFace } from "@/components/ui/face"
import { RoleTag } from "@/components/ui/role"
import { Status, StatusDot, type StatusTone } from "@/components/ui/status"
import * as format from "@/lib/format"
import { ROLE_INFO } from "@/lib/roles"
import { cn } from "@/lib/utils"
import type { AgentView, RunView, TaskView } from "@/run/fold"
import { useRunStore } from "@/run/hooks"
import { kindLabel, type Moment } from "./derive"
import type { LaneStatus } from "./lanes"

const CHECK: Record<string, string> = {
	"no-source": "No source",
	"unknown-source": "Unknown source",
	"wrong-subject": "Source is about someone else",
	"name-mismatch": "Name does not match the id",
	"uncited-detail": "Detail from a source it does not cite",
	unsupported: "Source does not back it",
	unchecked: "Not checked",
}

/** One Critic moment: what was rejected, the sources it cited, and why. */
export function MomentDialog({
	moment,
	agents,
	onOpenChange,
}: {
	moment: Moment | null
	agents: Map<string, AgentView>
	onOpenChange: (open: boolean) => void
}) {
	return (
		<Dialog open={moment != null} onOpenChange={onOpenChange}>
			<DialogContent
				className="max-w-xl p-0"
				aria-describedby={undefined}
				// Focus the dialog, not its first source chip: the chip's hover card would pop open.
				onOpenAutoFocus={(event) => {
					event.preventDefault()
					;(event.currentTarget as HTMLElement | null)?.focus()
				}}
			>
				{moment && <MomentBody moment={moment} producer={moment.producerId ? agents.get(moment.producerId) : undefined} onClose={() => onOpenChange(false)} />}
			</DialogContent>
		</Dialog>
	)
}

function MomentBody({ moment, producer, onClose }: { moment: Moment; producer?: AgentView; onClose: () => void }) {
	const subject = `${kindLabel(moment.kind)} ${moment.id}`
	const title =
		moment.action === "drop"
			? `${subject} was dropped`
			: moment.action === "human-review"
				? `${subject} needs a person`
				: `Sent back to ${producer?.name ?? "its writer"}`
	const what =
		moment.action === "drop"
			? "The fixes ran out and claims still had no support, so the Critic took it off the blackboard."
			: moment.action === "human-review"
				? "Both Critics checked it and the fixes ran out. It stays on the blackboard for a person to decide."
				: `${producer?.name ?? "The producer"} gets a new task to fix only these claims, then posts ${subject} again.`
	const jump = () => {
		useRunStore.getState().seek(moment.ms)
		onClose()
	}

	return (
		<>
			<div className="border-b border-hairline px-6 pb-4 pt-5">
				<div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
					<StatusDot tone={moment.action === "send-back" ? "needs" : "failed"} />
					<span>{moment.critic}</span>
					<span className="tabular text-ink-subtle">at {format.clock(moment.ms)}</span>
					{moment.attempt != null && (
						<span className="tabular text-ink-subtle">
							fix {moment.attempt} of {moment.maxAttempts ?? "?"}
						</span>
					)}
				</div>
				<DialogTitle className="text-lg">{title}</DialogTitle>
				<p className="mt-1 text-sm text-ink-muted">{what}</p>
				{moment.split && (
					<p className="mt-2 text-sm text-ink-muted">
						<span className="text-ink">The two Critics disagreed.</span> Both must pass a claim, so a single rejection sends it back.
					</p>
				)}
			</div>
			<ol className="scrollbar-thin max-h-[55dvh] overflow-y-auto">
				{moment.rejected.map((item, i) => (
					<li key={i} className="border-b border-hairline px-6 py-4 last:border-b-0">
						<div className="text-sm leading-relaxed">
							<ClaimText claim={item.claim} struck />
						</div>
						<p className="mt-2 text-sm text-ink">{item.reason}</p>
						{(item.check || item.reviewers?.length) && (
							<div className="mt-2.5 flex flex-wrap items-center gap-1.5">
								{item.check && <Chip>{CHECK[item.check] ?? item.check}</Chip>}
								{item.reviewers?.map((reviewer) => (
									<Chip key={reviewer}>Rejected by {reviewer}</Chip>
								))}
							</div>
						)}
					</li>
				))}
				{moment.rejected.length === 0 && <li className="px-6 py-4 text-sm text-ink-muted">The verdict lists no claims.</li>}
			</ol>
			<div className="flex items-center justify-between gap-3 border-t border-hairline px-6 py-3">
				<span className="text-xs text-ink-subtle">Hover a source id to read the record.</span>
				<Button size="sm" onClick={jump}>
					<Undo2 />
					Go to this moment
				</Button>
			</div>
		</>
	)
}

/** One agent at the playhead: what it does now, what it spent, its tasks and the claims sent back to it. */
export function AgentSheet({
	agent,
	status,
	view,
	moments,
	onOpenChange,
	onMoment,
}: {
	agent: AgentView | null
	status?: LaneStatus
	view: RunView
	moments: Moment[]
	onOpenChange: (open: boolean) => void
	onMoment: (moment: Moment) => void
}) {
	return (
		<Dialog open={agent != null} onOpenChange={onOpenChange}>
			<SheetContent aria-describedby={undefined}>
				{agent && <AgentBody agent={agent} now={view.agents.get(agent.id)} status={status} view={view} moments={moments} onMoment={onMoment} />}
			</SheetContent>
		</Dialog>
	)
}

function AgentBody({
	agent,
	now,
	status,
	view,
	moments,
	onMoment,
}: {
	agent: AgentView
	now?: AgentView
	status?: LaneStatus
	view: RunView
	moments: Moment[]
	onMoment: (moment: Moment) => void
}) {
	const tasks = [...view.tasks.values()].filter((task) => task.agentId === agent.id).reverse()
	const own = moments.filter((moment) => moment.producerId === agent.id).reverse()
	return (
		<>
			<div className="border-b border-hairline px-5 py-4">
				<div className="flex items-start gap-3">
					<RoleFace role={agent.role} state={now && now.activity !== "idle" ? "working" : "idle"} className="size-12" />
					<div className="min-w-0 flex-1">
						<RoleTag role={agent.role} className="text-xs text-ink-muted">
							{ROLE_INFO[agent.role].name ? `${ROLE_INFO[agent.role].name}, ${ROLE_INFO[agent.role].label}` : undefined}
						</RoleTag>
						<DialogTitle className="mt-1.5 text-lg">{agent.name}</DialogTitle>
					</div>
				</div>
				<DialogDescription className="mt-2">{ROLE_INFO[agent.role].job || "An agent in this run."}</DialogDescription>
				{status && (
					<div className="mt-3 flex min-w-0 items-center gap-2 text-sm">
						<Status tone={status.tone}>{status.label}</Status>
						{status.task && <span className="truncate font-mono text-xs text-ink-subtle">{status.task}</span>}
					</div>
				)}
			</div>
			<div className="grid grid-cols-4 gap-4 border-b border-hairline px-5 py-4">
				<Stat label="Tokens" value={format.tokens(now?.tokens ?? 0)} />
				<Stat label="Cost" value={now?.costUsd ? format.usd(now.costUsd) : "—"} />
				<Stat label="Done" value={now?.tasksDone ?? 0} />
				<Stat label="Sent back" value={own.length} />
			</div>
			<div className="scrollbar-thin flex-1 overflow-y-auto">
				{own.length > 0 && (
					<section className="border-b border-hairline px-5 py-4">
						<h3 className="mb-2 text-sm font-medium text-ink">Sent back by the Critic</h3>
						<ul className="-mx-2 flex flex-col">
							{own.map((moment) => (
								<li key={moment.key}>
									<button
										type="button"
										onClick={() => onMoment(moment)}
										className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-150 hover:bg-hover"
									>
										<StatusDot tone={moment.action === "send-back" ? "needs" : "failed"} />
										<span className="min-w-0 flex-1 truncate text-ink">
											{kindLabel(moment.kind)} <span className="font-mono text-xs text-ink-muted">{moment.id}</span>
										</span>
										<span className="tabular shrink-0 text-xs text-ink-subtle">
											{format.plural(moment.rejected.length, "claim")} · {format.clock(moment.ms)}
										</span>
									</button>
								</li>
							))}
						</ul>
					</section>
				)}
				<section className="px-5 py-4">
					<h3 className="mb-2 text-sm font-medium text-ink">Tasks</h3>
					{tasks.length === 0 ? (
						<p className="text-sm text-ink-muted">No tasks yet at this point of the run.</p>
					) : (
						<ul className="flex flex-col">
							{tasks.map((task) => (
								<TaskRow key={task.id} task={task} />
							))}
						</ul>
					)}
				</section>
			</div>
		</>
	)
}

const TASK_TONE: Record<TaskView["status"], StatusTone> = { queued: "idle", running: "working", done: "done", failed: "failed" }

function TaskRow({ task }: { task: TaskView }) {
	return (
		<li className="flex items-center gap-2.5 border-b border-hairline py-2 text-sm last:border-b-0">
			<StatusDot tone={TASK_TONE[task.status]} className={cn(task.status === "done" && "bg-idle")} />
			<span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{task.id}</span>
			<span className="tabular shrink-0 text-xs text-ink-muted">
				{task.status === "running" ? "running" : format.duration(task.endMs != null ? task.endMs - task.startMs : null)}
			</span>
			<span className="tabular w-12 shrink-0 text-right text-xs text-ink-subtle">{task.tokens ? format.tokens(task.tokens) : "—"}</span>
		</li>
	)
}
