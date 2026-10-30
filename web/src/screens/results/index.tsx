/**
 * STUB from #12. Card #21 owns this folder and replaces this screen with the real results view.
 * It shows how to read results: useResults() for needs, profiles, pairs, proposals, verdicts and approvals;
 * useRunStore().approve(pairId, decision) to record a decision; ClaimText and Markdown for cited text.
 */
import type { CriticVerdict, Proposal } from "@shared/types"
import { Check, FileText, X } from "lucide-react"
import { useMemo, useState } from "react"
import { ClaimText } from "@/components/shell/source"
import { Button } from "@/components/ui/button"
import { Card, CardId, CardTitle, Lane, Meta } from "@/components/ui/card"
import { Chip } from "@/components/ui/chip"
import { EmptyState } from "@/components/ui/empty"
import { Markdown } from "@/components/ui/markdown"
import { LoadingState } from "@/components/ui/skeleton"
import { Status } from "@/components/ui/status"
import { Tabs } from "@/components/ui/tabs"
import { toast } from "@/components/ui/toaster"
import * as format from "@/lib/format"
import { useResults, useRunStore } from "@/run/hooks"

type Tab = "pairs" | "proposals" | "none"

export function ResultsScreen() {
	const { results, error } = useResults()
	const [tab, setTab] = useState<Tab>("pairs")
	const names = useMemo(() => {
		const map = new Map<string, string>()
		for (const p of results?.profiles ?? []) map.set(p.researcherId, p.name)
		for (const n of results?.needs ?? []) map.set(n.companyId, n.companyName)
		return map
	}, [results])

	if (error) return <EmptyState title="Results could not be loaded" className="py-20">{error}</EmptyState>
	if (!results) return <LoadingState label="Loading results" className="px-6 py-5" />

	return (
		<div className="px-6 pb-28 pt-4">
			<Tabs<Tab>
				aria-label="Results"
				value={tab}
				onValueChange={setTab}
				items={[
					{ value: "pairs", label: "Pairs", count: results.pairs.length },
					{ value: "proposals", label: "Proposals", count: results.proposals.length },
					{ value: "none", label: "No good match", count: results.noMatches.length },
				]}
			/>
			<div className="mt-4 grid gap-3">
				{tab === "pairs" &&
					(results.pairs.length ? (
						[...results.pairs]
							.sort((a, b) => a.challengeId.localeCompare(b.challengeId) || b.fit - a.fit)
							.map((pair) => {
								const approval = results.approvals[pair.id]
								return (
									<Card key={pair.id} className="flex flex-col gap-2.5">
										<div className="flex items-center justify-between gap-2">
											<CardId>{pair.id}</CardId>
											<Chip>fit of this pair {format.percent(pair.fit)}</Chip>
										</div>
										<CardTitle>
											{names.get(pair.companyId) ?? pair.companyId} and {names.get(pair.researcherId) ?? pair.researcherId}
										</CardTitle>
										<ClaimText claim={pair.problem} className="text-base" />
										<ul className="flex flex-col gap-1.5 text-sm text-ink-muted">
											{pair.why.map((claim, i) => (
												<li key={i}>
													<ClaimText claim={claim} />
												</li>
											))}
										</ul>
										<Approval pairId={pair.id} decision={approval?.decision} />
									</Card>
								)
							})
					) : (
						<EmptyState title="No pairs yet">The Matchmaker posts pairs here as it finds them.</EmptyState>
					))}

				{tab === "proposals" &&
					(results.proposals.length ? (
						results.proposals.map((proposal) => (
							<ProposalCard key={proposal.id} proposal={proposal} verdicts={results.verdicts.filter((v) => v.proposalId === proposal.id)} />
						))
					) : (
						<EmptyState icon={<FileText />} title="No proposals yet">
							Writers post proposals here once their pair is chosen.
						</EmptyState>
					))}

				{tab === "none" &&
					results.noMatches.map((none) => (
						<Card key={none.challengeId}>
							<CardId>{none.challengeId}</CardId>
							<p className="mt-1.5 text-base">{none.reason}</p>
						</Card>
					))}
			</div>
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
		<div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
			{decision ? (
				<>
					<Status tone={decision === "approved" ? "working" : "failed"} className="text-sm">
						{decision === "approved" ? "Approved for outreach" : "Rejected"}
					</Status>
					<Button variant="quiet" size="sm" onClick={() => decide(null)}>
						Undo
					</Button>
				</>
			) : (
				<>
					<span className="mr-auto text-sm text-ink-muted">A person decides before any outreach.</span>
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

function ProposalCard({ proposal, verdicts }: { proposal: Proposal; verdicts: CriticVerdict[] }) {
	const [open, setOpen] = useState(false)
	return (
		<Lane>
			<Card className="flex flex-col gap-2">
				<div className="flex flex-wrap items-center gap-2">
					<CardId>{proposal.id}</CardId>
					<Chip>{proposal.kind === "industrial-phd" ? "Industrial PhD" : "Joint project"}</Chip>
					{proposal.revision > 0 && <Chip tone="needs">revision {proposal.revision}</Chip>}
				</div>
				<CardTitle>{proposal.title}</CardTitle>
				<Meta items={[proposal.pairId, format.plural(proposal.claims.length, "claim")]} />
				{verdicts.map((verdict) => (
					<div key={verdict.revision} className="text-sm">
						<Status tone={verdict.ok ? "working" : "needs"}>
							{`Critic, revision ${verdict.revision}: ${verdict.ok ? "every claim has a source" : `${format.plural(verdict.rejected.length, "claim")} sent back`}`}
						</Status>
						{verdict.rejected.map((r, i) => (
							<div key={i} className="ml-4 mt-1 text-ink-muted">
								<ClaimText claim={r.claim} struck /> — {r.reason}
							</div>
						))}
					</div>
				))}
				<div>
					<Button size="sm" variant="quiet" onClick={() => setOpen(!open)}>
						{open ? "Hide the proposal" : "Read the proposal"}
					</Button>
				</div>
				{open && <Markdown className="border-t border-hairline pt-3">{proposal.markdown}</Markdown>}
			</Card>
		</Lane>
	)
}
