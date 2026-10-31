import type { Proposal } from "@shared/types"
import { Link } from "react-router"
import { Chip } from "@/components/ui/chip"
import { AgentFace } from "@/components/ui/face"
import { Tabs } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { useRunStore } from "@/run/hooks"
import {
	challengeIdOf,
	companyOf,
	kindLabel,
	researcherIdOf,
	researcherName,
	reviewsOf,
	reviewSummary,
	stripTitle,
	useResultsPath,
	type HeldBack,
	type ResultsIndex,
} from "./data"
import { DecisionBar, DecisionNote } from "./decision"
import { ExportMenu } from "./export"
import { Block, ClaimRows, DetailFrame, useTab } from "./parts"
import { ReviewHistory } from "./review"
import { FundingBlock } from "./funding"
import { ProposalBody } from "./proposal-body"

const READER_TABS = ["proposal", "claims", "review"] as const
type ReaderTab = (typeof READER_TABS)[number]

/** Who a proposal pairs, from its pair, or from its id when the pair is missing. */
function sides(index: ResultsIndex, pairId: string) {
	const pair = index.pairs.get(pairId)
	const challengeId = pair?.challengeId ?? challengeIdOf(pairId)
	return {
		pair,
		challengeId,
		company: companyOf(index, pair?.companyId ?? challengeId.split("-")[0]),
		researcher: researcherName(index, pair?.researcherId ?? researcherIdOf(pairId)),
	}
}

/** The two sides of a pair, one per line with the face of the agent that read it: Spica the company, Tycho the researcher. */
function PairSides({ index, pairId, className }: { index: ResultsIndex; pairId: string; className?: string }) {
	const paths = useResultsPath()
	const { pair, company, researcher } = sides(index, pairId)
	const faculty = index.profiles.get(pair?.researcherId ?? researcherIdOf(pairId))?.faculty
	const side = (face: "spica" | "tycho", name: string, detail: string | undefined) => (
		<div className="flex min-w-0 items-center gap-2">
			<AgentFace face={face} className="size-5" />
			<span className="truncate text-sm">
				{pair ? (
					<Link to={paths.pair(pair.id)} className="font-medium text-ink underline-offset-2 hover:underline">
						{name}
					</Link>
				) : (
					<span className="font-medium text-ink">{name}</span>
				)}
				{detail && <span className="text-ink-subtle"> · {detail}</span>}
			</span>
		</div>
	)
	return (
		<div className={cn("flex flex-col gap-1", className)}>
			{side("spica", company.name, company.sector)}
			{side("tycho", researcher, faculty)}
		</div>
	)
}

/** How many open EU calls Ceres found for the pair; nothing when the run has no Scout answer for it. */
function CallsChip({ index, pairId }: { index: ResultsIndex; pairId: string }) {
	const match = index.results.funding?.find((m) => m.pairId === pairId)
	if (!match) return null
	const n = match.calls.length
	return (
		<Chip icon={<AgentFace face="ceres" state={n ? "idle" : "reject"} className="size-4" />}>
			{n ? `${n} EU call${n === 1 ? "" : "s"}` : "No EU call fits"}
		</Chip>
	)
}

/**
 * One proposal: the Markdown with every citation as a source chip (hover shows the record, click opens it),
 * its claims one by one, and the Critic history. The person's decision and the export sit in the header.
 */
export function ProposalDetail({ index, proposal }: { index: ResultsIndex; proposal: Proposal }) {
	const [tab, setTab] = useTab(READER_TABS, "proposal")
	const runId = useRunStore((state) => state.runId) ?? ""
	const approval = useRunStore((state) => state.results?.approvals[proposal.pairId])
	const { pair, company, researcher } = sides(index, proposal.pairId)
	const verdicts = reviewsOf(index.results, "proposal", proposal.id)
	const review = reviewSummary(verdicts)

	return (
		<DetailFrame
			bodyKey={`${proposal.id}:${tab}`}
			header={
				<>
					<h2 className="text-balance text-lg font-semibold leading-snug tracking-tight text-ink">{proposal.title}</h2>
					<PairSides index={index} pairId={proposal.pairId} className="mt-3" />
					<div className="mt-3 flex flex-wrap items-center gap-1.5">
						<Chip>{kindLabel(proposal.kind)}</Chip>
						{pair && <Chip>fit {Math.round(pair.fit * 100)}%</Chip>}
						<Chip tone={review.tone === "working" ? "working" : review.tone === "failed" ? "failed" : "needs"}>{review.label}</Chip>
						<CallsChip index={index} pairId={proposal.pairId} />
					</div>
				</>
			}
			actions={
				<>
					<ExportMenu ctx={{ proposal, runId, company: company.name, researcher, review: review.label, approval }} />
					<DecisionBar pairId={proposal.pairId} />
				</>
			}
			tabs={
				<Tabs<ReaderTab>
					aria-label="Proposal"
					className="border-b-0"
					value={tab}
					onValueChange={setTab}
					items={[
						{ value: "proposal", label: "Proposal" },
						{ value: "claims", label: "Claims", count: proposal.claims.length || undefined },
						{ value: "review", label: "Critic review", count: verdicts.length || undefined },
					]}
				/>
			}
		>
			<DecisionNote pairId={proposal.pairId} className="mb-6 max-w-[72ch]" />
			{tab === "proposal" && (
				<>
					<ProposalBody markdown={stripTitle(proposal.markdown, proposal.title)} />
					<FundingBlock index={index} pairId={proposal.pairId} className="mt-10" />
				</>
			)}
			{tab === "claims" && (
				<Block
					title="Every claim and its sources"
					description="Each factual statement in the proposal, with the dataset records it cites. Hover an id to see the record. Click it to open it."
				>
					<ClaimRows
						claims={proposal.claims}
						empty="This proposal was read from a Markdown file, so its claims are not stored one by one. The citations in the text still open their sources."
					/>
				</Block>
			)}
			{tab === "review" && <ReviewHistory className="max-w-[80ch]" verdicts={verdicts} final={proposal.claims} />}
		</DetailFrame>
	)
}

/**
 * A proposal the Critics held back: it is not accepted, so a person reads the draft and decides.
 * With the draft stored in the run, it reads like a proposal; without it, only the Critic review is shown.
 */
export function HeldBackDetail({ index, held }: { index: ResultsIndex; held: HeldBack }) {
	const [tab, setTab] = useTab(READER_TABS, "proposal")
	const runId = useRunStore((state) => state.runId)
	const { pair, company, researcher } = sides(index, held.pairId)
	const verdicts = reviewsOf(index.results, "proposal", held.id)
	const draft = held.draft
	const note = (
		<div className="max-w-[80ch] rounded-lg bg-sunken p-4 text-sm leading-relaxed text-ink-muted">
			The Critics did not accept this proposal: they still rejected claims after the last fix, or the fix could not run. Nothing was
			dropped: a person reads the draft and decides.
			{!draft && (
				<>
					{" "}
					The draft is in <span className="font-mono text-ink">out/{runId}/needs-human/{held.id}.md</span>.
				</>
			)}
		</div>
	)
	return (
		<DetailFrame
			bodyKey={draft ? `${held.id}:${tab}` : held.id}
			header={
				<>
					<h2 className="text-balance text-lg font-semibold leading-snug tracking-tight text-ink">
						{draft?.title ?? `${company.name} and ${researcher}`}
					</h2>
					<PairSides index={index} pairId={held.pairId} className="mt-3" />
					<div className="mt-3 flex flex-wrap items-center gap-1.5">
						<Chip>{draft ? kindLabel(draft.kind) : held.id}</Chip>
						{pair && <Chip>fit {Math.round(pair.fit * 100)}%</Chip>}
						<Chip tone="needs">Needs human review</Chip>
						<CallsChip index={index} pairId={held.pairId} />
					</div>
				</>
			}
			actions={<DecisionBar pairId={held.pairId} />}
			tabs={
				draft && (
					<Tabs<ReaderTab>
						aria-label="Held-back proposal"
						className="border-b-0"
						value={tab}
						onValueChange={setTab}
						items={[
							{ value: "proposal", label: "Draft" },
							{ value: "claims", label: "Claims", count: draft.claims.length || undefined },
							{ value: "review", label: "Critic review", count: verdicts.length || undefined },
						]}
					/>
				)
			}
		>
			{draft ? (
				<>
					<DecisionNote pairId={held.pairId} className="mb-6 max-w-[72ch]" />
					{tab === "proposal" && (
						<div className="flex flex-col gap-8">
							{note}
							<ProposalBody markdown={stripTitle(draft.markdown, draft.title)} />
						</div>
					)}
					{tab === "claims" && (
						<Block
							title="Every claim and its sources"
							description="Each factual statement in the draft, with the dataset records it cites. Hover an id to see the record. Click it to open it."
						>
							<ClaimRows
								claims={draft.claims}
								empty="This draft was read from a Markdown file, so its claims are not stored one by one. The citations in the text still open their sources."
							/>
						</Block>
					)}
					{tab === "review" && <ReviewHistory className="max-w-[80ch]" verdicts={verdicts} final={draft.claims} />}
				</>
			) : (
				<div className="flex max-w-[80ch] flex-col gap-8">
					<DecisionNote pairId={held.pairId} />
					{note}
					<Block title="Critic review">
						<ReviewHistory verdicts={verdicts} />
					</Block>
				</div>
			)}
		</DetailFrame>
	)
}
