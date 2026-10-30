import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { memo, useMemo, useState } from "react"
import { RoleSquare } from "@/components/ui/role"
import { StatusDot, type StatusTone } from "@/components/ui/status"
import * as format from "@/lib/format"
import { roleOf } from "@/lib/roles"
import { cn } from "@/lib/utils"
import { kindLabel, type Moment, type Posting, type ReviewState } from "./derive"

const KINDS = ["need", "profile", "pair", "proposal"] as const

const STATE: Record<ReviewState, { tone: StatusTone; label: string }> = {
	posted: { tone: "idle", label: "Posted" },
	reviewing: { tone: "info", label: "In review" },
	passed: { tone: "working", label: "Passed" },
	"sent-back": { tone: "needs", label: "Sent back" },
	dropped: { tone: "failed", label: "Dropped" },
	"human-review": { tone: "needs", label: "Needs a person" },
}

/** The most rows the feed keeps in the page; older ones are a filter away. */
const LIMIT = 120

/**
 * The blackboard as it fills: one row per post, newest first. Counts double as filters.
 * A row the Critic rejected opens its moment.
 */
export function Blackboard({
	postings,
	nameOf,
	onMoment,
}: {
	postings: Posting[]
	nameOf: (kind: string, id: string) => string | undefined
	onMoment: (moment: Moment) => void
}) {
	const [kind, setKind] = useState<string | null>(null)
	const counts = useMemo(() => {
		const ids = new Map<string, Set<string>>(KINDS.map((k) => [k, new Set()]))
		for (const posting of postings) ids.get(posting.kind)?.add(posting.id)
		return ids
	}, [postings])
	const rows = useMemo(() => {
		const shown = kind ? postings.filter((posting) => posting.kind === kind) : postings
		return shown.slice(-LIMIT).reverse()
	}, [postings, kind])
	const reduced = useReducedMotion()

	return (
		<>
			<div className="grid shrink-0 grid-cols-4 border-b border-hairline">
				{KINDS.map((k) => {
					const active = kind === k
					return (
						<button
							key={k}
							type="button"
							aria-pressed={active}
							onClick={() => setKind(active ? null : k)}
							className={cn(
								"flex min-w-0 flex-col items-start gap-0.5 border-r border-hairline px-3 py-2.5 text-left transition-colors duration-150 last:border-r-0 hover:bg-hover",
								active && "bg-selected",
							)}
						>
							<span className={cn("max-w-full truncate text-xs", active ? "text-ink" : "text-ink-muted")}>{kindLabel(k)}s</span>
							<span className="tabular text-md font-medium text-ink">{counts.get(k)?.size ?? 0}</span>
						</button>
					)
				})}
			</div>
			{rows.length === 0 ? (
				<p className="p-4 text-sm text-ink-muted">
					{kind
						? `No ${kindLabel(kind).toLowerCase()}s yet.`
						: "Nothing posted yet. Needs and profiles land first, then pairs, then proposals."}
				</p>
			) : (
				<ol className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overscroll-contain">
					<AnimatePresence initial={false}>
						{rows.map((posting) => (
							<motion.li
								key={posting.key}
								initial={reduced ? false : { height: 0, opacity: 0 }}
								animate={{ height: "auto", opacity: 1 }}
								exit={{ opacity: 0, transition: { duration: 0.1 } }}
								transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
								className="overflow-hidden"
							>
								<Row posting={posting} name={nameOf(posting.kind, posting.id)} onMoment={onMoment} />
							</motion.li>
						))}
					</AnimatePresence>
				</ol>
			)}
		</>
	)
}

// derive() builds new postings on every change, so compare what a row shows.
const Row = memo(
	function Row({ posting, name, onMoment }: { posting: Posting; name?: string; onMoment: (moment: Moment) => void }) {
	const state = STATE[posting.state]
	const moment = posting.moment
	const content = (
		<>
			<StatusDot tone={state.tone} className="mt-[5px]" />
			<div className="min-w-0 flex-1">
				<div className="truncate text-sm text-ink">{name ?? posting.id}</div>
				<div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-ink-muted">
					<span className="shrink-0">{kindLabel(posting.kind)}</span>
					{name && <span className="truncate font-mono text-2xs text-ink-subtle">{posting.id}</span>}
					{posting.revision > 0 && <span className="shrink-0 text-ink-subtle">fix {posting.revision}</span>}
				</div>
			</div>
			<div className="flex shrink-0 flex-col items-end gap-0.5 text-xs">
				<span className={cn(state.tone === "needs" ? "text-needs" : state.tone === "failed" ? "text-failed" : "text-ink-muted")}>
					{state.label}
				</span>
				<span className="tabular inline-flex items-center gap-1 text-ink-subtle">
					<RoleSquare role={roleOf(posting.agent)} className="size-1.5" />
					{format.clock(posting.ms)}
				</span>
			</div>
		</>
	)
	const className = "flex w-full items-start gap-2.5 border-b border-hairline px-4 py-2.5 text-left"
	if (!moment) return <div className={className}>{content}</div>
	return (
		<button type="button" onClick={() => onMoment(moment)} className={cn(className, "transition-colors duration-150 hover:bg-hover")}>
			{content}
		</button>
	)
	},
	(a, b) =>
		a.posting.key === b.posting.key &&
		a.posting.state === b.posting.state &&
		a.posting.moment?.key === b.posting.moment?.key &&
		a.name === b.name &&
		a.onMoment === b.onMoment,
)
