/**
 * STUB from #12. Card #21 owns this folder and replaces this screen with the real results view.
 * It shows how to read results: useResults() for needs, profiles, pairs, proposals, verdicts and approvals;
 * useRunStore().approve(pairId, decision) to record a decision; ClaimText and Markdown for cited text.
 */
import type { CriticVerdict, PairCandidate, Proposal } from "@shared/types"
import { Check, ChevronRight, FileText, X } from "lucide-react"
import { useMemo, useState } from "react"
import { ClaimText } from "@/components/shell/source"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Chip } from "@/components/ui/chip"
import { Dialog, DialogDescription, DialogTitle, SheetContent } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty"
import { Markdown } from "@/components/ui/markdown"
import { LoadingState } from "@/components/ui/skeleton"
import { Status, StatusLabel } from "@/components/ui/status"
import { Tabs } from "@/components/ui/tabs"
import { toast } from "@/components/ui/toaster"
import * as format from "@/lib/format"
import { cn } from "@/lib/utils"
import { useResults, useRunStore } from "@/run/hooks"

type Tab = "pairs" | "proposals" | "none"

export function ResultsScreen() {
	const { results, error } = useResults()
	const [tab, setTab] = useState<Tab>("proposals")
	const [reading, setReading] = useState<Proposal | null>(null)
	const names = useMemo(() => {
		const map = new Map<string, string>()
		for (const p of results?.profiles ?? []) map.set(p.researcherId, p.name)
		for (const n of results?.needs ?? []) map.set(n.companyId, n.companyName)
		return map
	}, [results])

	if (error) return <EmptyState title="Results could not be loaded">{error}</EmptyState>
	if (!results) return <LoadingState label="Loading results" />

	return (
		<div>
			<Tabs<Tab>
				aria-label="Results"
				value={tab}
				onValueChange={setTab}
				items={[
					{ value: "proposals", label: "Proposals", count: results.proposals.length },
					{ value: "pairs", label: "Pairs", count: results.pairs.length },
					{ value: "none", label: "No good match", count: results.noMatches.length },
				]}
			/>
			<div className="mt-6">
				{tab === "proposals" &&
					(results.proposals.length ? (
						<Card className="p-0">
							{results.proposals.map((proposal) => (
								<ProposalRow
									key={proposal.id}
									proposal={proposal}
									verdicts={results.verdicts.filter((v) => v.proposalId === proposal.id)}
									onOpen={() => setReading(proposal)}
								/>
							))}
						</Card>
					) : (
						<EmptyState icon={<FileText />} title="No proposals yet">
							Writers post proposals here once their pair is chosen.
						</EmptyState>
					))}

				{tab === "pairs" &&
					(results.pairs.length ? (
						<Card className="p-0">
							{[...results.pairs]
								.sort((a, b) => a.challengeId.localeCompare(b.challengeId) || b.fit - a.fit)
								.map((pair) => (
									<PairRow key={pair.id} pair={pair} names={names} decision={results.approvals[pair.id]?.decision} />
								))}
						</Card>
					) : (
						<EmptyState title="No pairs yet">The Matchmaker posts pairs here as it finds them.</EmptyState>
					))}

				{tab === "none" &&
					(results.noMatches.length ? (
						<Card className="p-0">
							{results.noMatches.map((none) => (
								<div key={none.challengeId} className="border-b border-hairline p-5 last:border-b-0">
									<div className="font-mono text-xs text-ink-subtle">{none.challengeId}</div>
									<p className="mt-1.5 text-base text-ink">{none.reason}</p>
								</div>
							))}
						</Card>
					) : (
						<EmptyState title="Every challenge found a pair">When no researcher fits a challenge, it is listed here with the reason.</EmptyState>
					))}
			</div>

			<ProposalSheet
				proposal={reading}
				verdicts={reading ? results.verdicts.filter((v) => v.proposalId === reading.id) : []}
				onClose={() => setReading(null)}
			/>
		</div>
	)
}

function ProposalRow({ proposal, verdicts, onOpen }: { proposal: Proposal; verdicts: CriticVerdict[]; onOpen: () => void }) {
	const last = verdicts.at(-1)
	const sentBack = verdicts.filter((v) => !v.ok).length
	return (
		<button
			type="button"
			onClick={onOpen}
			className="flex w-full items-center gap-4 border-b border-hairline p-5 text-left transition-colors last:border-b-0 hover:bg-hover"
		>
			<div className="min-w-0 flex-1">
				<div className="font-medium text-ink">{proposal.title}</div>
				<div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
					<span>{proposal.kind === "industrial-phd" ? "Industrial PhD" : "Joint project"}</span>
					<span className="font-mono text-xs text-ink-subtle">{proposal.pairId || proposal.id}</span>
					{last && (
						<StatusLabel tone={last.ok ? "working" : "needs"} className="text-sm text-ink-muted">
							{last.ok ? (sentBack ? `Passed after ${format.plural(sentBack, "fix", "fixes")}` : "Passed review") : "Sent back"}
						</StatusLabel>
					)}
				</div>
			</div>
			<ChevronRight className="size-4 shrink-0 text-ink-subtle" />
		</button>
	)
}

function PairRow({ pair, names, decision }: { pair: PairCandidate; names: Map<string, string>; decision?: "approved" | "rejected" }) {
	const [open, setOpen] = useState(false)
	return (
		<div className="border-b border-hairline last:border-b-0">
			<button type="button" onClick={() => setOpen(!open)} className="flex w-full items-start gap-4 p-5 text-left transition-colors hover:bg-hover">
				<div className="min-w-0 flex-1">
					<div className="font-medium text-ink">
						{names.get(pair.companyId) ?? pair.companyId} <span className="text-ink-subtle">and</span> {names.get(pair.researcherId) ?? pair.researcherId}
					</div>
					<p className="mt-1 line-clamp-2 text-sm text-ink-muted">{pair.problem.text}</p>
				</div>
				<div className="flex shrink-0 items-center gap-3">
					{decision && (
						<Status tone={decision === "approved" ? "working" : "failed"} className="text-sm">
							{decision === "approved" ? "Approved" : "Rejected"}
						</Status>
					)}
					<Chip title="How well this pair fits this challenge. Never a score of a person.">fit {format.percent(pair.fit)}</Chip>
					<ChevronRight className={cn("size-4 text-ink-subtle transition-transform", open && "rotate-90")} />
				</div>
			</button>
			{open && (
				<div className="px-5 pb-5">
					<div className="mb-2 text-xs text-ink-muted">Why these two</div>
					<ul className="flex flex-col gap-2 text-sm">
						{[...pair.why, pair.problem].map((claim, i) => (
							<li key={i}>
								<ClaimText claim={claim} />
							</li>
						))}
					</ul>
					<Approval pairId={pair.id} decision={decision} />
				</div>
			)}
		</div>
	)
}

function Approval({ pairId, decision }: { pairId: string; decision?: "approved" | "rejected" }) {
	const approve = useRunStore((state) => state.approve)
	const decide = async (next: "approved" | "rejected" | null) => {
		try {
			await approve(pairId, next)
			toast.success(next === "approved" ? "Approved" : next === "rejected" ? "Rejected" : "Decision cleared", { description: pairId })
		} catch (error) {
			toast.error("The decision was not saved", { description: error instanceof Error ? error.message : String(error) })
		}
	}
	return (
		<div className="mt-4 flex flex-wrap items-center gap-2 border-t border-hairline pt-4">
			<span className="mr-auto text-sm text-ink-muted">A person decides before anyone reaches out.</span>
			{decision ? (
				<Button size="sm" variant="quiet" onClick={() => decide(null)}>
					Undo
				</Button>
			) : (
				<>
					<Button size="sm" onClick={() => decide("rejected")}>
						<X />
						Reject
					</Button>
					<Button size="sm" variant="primary" onClick={() => decide("approved")}>
						<Check />
						Approve
					</Button>
				</>
			)}
		</div>
	)
}

function ProposalSheet({ proposal, verdicts, onClose }: { proposal: Proposal | null; verdicts: CriticVerdict[]; onClose: () => void }) {
	return (
		<Dialog open={proposal != null} onOpenChange={(open) => !open && onClose()}>
			<SheetContent className="w-[min(46rem,calc(100vw-1rem))]">
				{proposal && (
					<>
						<div className="border-b border-hairline px-6 py-5 pr-12">
							<DialogTitle className="text-lg font-semibold">{proposal.title}</DialogTitle>
							<DialogDescription>
								{proposal.kind === "industrial-phd" ? "Industrial PhD" : "Joint project"} · <span className="font-mono">{proposal.pairId || proposal.id}</span>
							</DialogDescription>
						</div>
						<div className="scrollbar-thin flex-1 overflow-y-auto px-6 py-5">
							{verdicts.length > 0 && (
								<div className="mb-6 rounded-lg border border-hairline p-4">
									<div className="mb-2 text-sm font-medium text-ink">Critic review</div>
									{verdicts.map((verdict) => (
										<div key={verdict.revision} className="py-1 text-sm">
											<Status tone={verdict.ok ? "working" : "needs"}>
												{`Draft ${verdict.revision + 1}: ${verdict.ok ? "every claim has a source" : `${format.plural(verdict.rejected.length, "claim")} sent back`}`}
											</Status>
											{verdict.rejected.slice(0, 4).map((r, i) => (
												<div key={i} className="ml-4 mt-1.5 text-ink-muted">
													<ClaimText claim={r.claim} struck />
													<div className="mt-0.5 line-clamp-2 text-xs">{r.reason}</div>
												</div>
											))}
										</div>
									))}
								</div>
							)}
							<Markdown>{proposal.markdown}</Markdown>
						</div>
					</>
				)}
			</SheetContent>
		</Dialog>
	)
}
