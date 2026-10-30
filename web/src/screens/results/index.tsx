import { FileText, Network } from "lucide-react"
import type * as React from "react"
import { Navigate, Route, Routes, useNavigate, useParams } from "react-router"
import { useCommands } from "@/components/shell/command-palette"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty"
import { LoadingState } from "@/components/ui/skeleton"
import { useResultsIndex, useResultsPath, type ResultsIndex } from "./data"
import { ListPane, type ListMode } from "./list"
import { ChallengeDetail, PairDetail } from "./pair"
import { MapDetail } from "./pair-map"
import { HeldBackDetail, ProposalDetail } from "./reader"

/**
 * `/runs/:id/results/*`: what the run produced, as a list | detail split that fits the window.
 *
 *   results                          → the first proposal
 *   results/proposals/:proposalId    proposal reader (or a proposal held back for a person)
 *   results/pairs                    pairs by challenge, with the map of who could work on what
 *   results/pairs/:pairId            one pair
 *   results/challenges/:challengeId  one challenge: its pairs, or why no one fits
 *
 * Pairs are ranked by fit within one challenge. No person is ever scored.
 */
export function ResultsScreen() {
	const { index, error } = useResultsIndex()
	useResultCommands(index)
	if (error) return <EmptyState title="Results could not be loaded">{error}</EmptyState>
	if (!index) return <LoadingState label="Loading results" />
	return (
		<Routes>
			<Route index element={<FirstProposal index={index} />} />
			<Route path="proposals/:proposalId" element={<ProposalRoute index={index} />} />
			<Route path="pairs" element={<PairsRoute index={index} />} />
			<Route path="pairs/:pairId" element={<PairsRoute index={index} />} />
			<Route path="challenges/:challengeId" element={<PairsRoute index={index} />} />
			<Route path="*" element={<Back />} />
		</Routes>
	)
}

/** List on the left, the open item on the right. Below 1024 px the two stack and the page scrolls. */
function Split({ mode, index, selected, children }: { mode: ListMode; index: ResultsIndex; selected?: string; children: React.ReactNode }) {
	return (
		<div className="flex min-h-0 flex-col lg:h-full lg:flex-row">
			<ListPane mode={mode} index={index} selected={selected} />
			{children}
		</div>
	)
}

function FirstProposal({ index }: { index: ResultsIndex }) {
	const paths = useResultsPath()
	const navigate = useNavigate()
	const first = index.proposals.keys().next().value ?? index.heldBack[0]?.id
	if (first) return <Navigate to={paths.proposal(first)} replace />
	return (
		<Split mode="proposals" index={index}>
			<EmptyState
				className="flex-1"
				icon={<FileText />}
				title="No proposals yet"
				action={
					index.pairs.size > 0 ? (
						<Button onClick={() => navigate(paths.pairs)}>
							<Network />
							Explore the pairs
						</Button>
					) : undefined
				}
			>
				Writers turn the best pairs into proposals. They show here once the Critics accept them.
			</EmptyState>
		</Split>
	)
}

function ProposalRoute({ index }: { index: ResultsIndex }) {
	const { proposalId = "" } = useParams()
	const proposal = index.proposals.get(proposalId)
	const held = index.heldBack.find((item) => item.id === proposalId)
	return (
		<Split mode="proposals" index={index} selected={proposalId}>
			{proposal ? (
				<ProposalDetail index={index} proposal={proposal} />
			) : held ? (
				<HeldBackDetail index={index} held={held} />
			) : (
				<EmptyState className="flex-1" title="This proposal is not in the run">
					It may come from another run. Pick one from the list.
				</EmptyState>
			)}
		</Split>
	)
}

function PairsRoute({ index }: { index: ResultsIndex }) {
	const { pairId, challengeId } = useParams()
	const pair = pairId ? index.pairs.get(pairId) : undefined
	return (
		<Split mode="pairs" index={index} selected={pairId ?? challengeId}>
			{pair ? (
				<PairDetail index={index} pair={pair} />
			) : challengeId && index.challengeIds.includes(challengeId) ? (
				<ChallengeDetail index={index} challengeId={challengeId} />
			) : pairId || challengeId ? (
				<EmptyState className="flex-1" title="This pair is not in the run">
					It may come from another run. Pick one from the list.
				</EmptyState>
			) : (
				<MapDetail index={index} />
			)}
		</Split>
	)
}

function Back() {
	const paths = useResultsPath()
	return <Navigate to={paths.base} replace />
}

/** ⌘K: open any proposal, or the pairs. */
function useResultCommands(index: ResultsIndex | null) {
	const navigate = useNavigate()
	const paths = useResultsPath()
	useCommands("results", [
		{ id: "results-pairs", group: "Results", label: "Explore the pairs", icon: <Network />, keywords: ["map", "match"], run: () => navigate(paths.pairs) },
		...[...(index?.proposals.values() ?? [])].map((proposal) => ({
			id: `results-proposal-${proposal.id}`,
			group: "Proposals",
			label: proposal.title,
			icon: <FileText />,
			keywords: [proposal.id, proposal.pairId],
			run: () => navigate(paths.proposal(proposal.id)),
		})),
	])
}
