import type { PairCandidate, ResearcherProfile } from "@shared/types"
import { FileText } from "lucide-react"
import { useMemo } from "react"
import { Link } from "react-router"
import { ClaimText, SourceChip, useSource } from "@/components/shell/source"
import { Meta } from "@/components/ui/card"
import { Chip } from "@/components/ui/chip"
import { Status, StatusLabel } from "@/components/ui/status"
import { Tabs } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { useRunStore } from "@/run/hooks"
import {
	companyOf,
	failureLabel,
	noPair,
	pairClaims,
	pairOutcome,
	proposalIdOf,
	reviewsOf,
	reviewSummary,
	TRIAGE_LABEL,
	useResultsPath,
	writeFailure,
	type PairOutcome,
	type ResultsIndex,
} from "./data"
import { DecisionBar, DecisionNote } from "./decision"
import { useFilters } from "./filters"
import { Block, ClaimRows, DetailFrame, PairFit, useTab } from "./parts"
import { ReviewHistory } from "./review"

const PAIR_TABS = ["why", "challenge", "researcher", "review"] as const
type PairTab = (typeof PAIR_TABS)[number]

/** One pair: the problem they would solve and why, both sides in full, and the Critic history. Decided in the header. */
export function PairDetail({ index, pair }: { index: ResultsIndex; pair: PairCandidate }) {
	const [tab, setTab] = useTab(PAIR_TABS, "why")
	const paths = useResultsPath()
	const company = companyOf(index, pair.companyId)
	const profile = index.profiles.get(pair.researcherId)
	const outcome = pairOutcome(index, pair.id)
	const records = useRunStore((state) => state.records)
	const failure = useMemo(
		() => (outcome.kind === "not-written" ? writeFailure(records, proposalIdOf(pair.id)) : undefined),
		[outcome.kind, records, pair.id],
	)
	const verdicts = reviewsOf(index.results, "pair", pair.id)
	const review = reviewSummary(verdicts)

	return (
		<DetailFrame
			bodyKey={`${pair.id}:${tab}`}
			header={
				<>
					<h2 className="text-lg font-semibold leading-snug tracking-tight text-ink">
						{company.name} and {profile?.name ?? pair.researcherId}
					</h2>
					<Meta
						className="mt-1.5"
						items={[
							<span className="font-mono text-xs">{pair.challengeId}</span>,
							<PairFit fit={pair.fit} />,
							<ProposalOutcome outcome={outcome} failure={failure} />,
							verdicts.length > 0 && (
								<StatusLabel tone={review.tone} className="text-ink-muted">
									{review.label}
								</StatusLabel>
							),
						]}
					/>
				</>
			}
			actions={<DecisionBar pairId={pair.id} />}
			tabs={
				<Tabs<PairTab>
					aria-label="Pair"
					className="border-b-0"
					value={tab}
					onValueChange={setTab}
					items={[
						{ value: "why", label: "Why this pair" },
						{ value: "challenge", label: "The challenge" },
						{ value: "researcher", label: "The researcher" },
						{ value: "review", label: "Critic review", count: verdicts.length || undefined },
					]}
				/>
			}
		>
			<DecisionNote pairId={pair.id} className="mb-6 max-w-[72ch]" />
			{tab === "why" && (
				<div className="flex flex-col gap-8">
					<Block title="The problem they would solve together">
						<p className="max-w-[72ch] text-md leading-relaxed text-ink">
							<ClaimText claim={pair.problem} />
						</p>
					</Block>
					<Block title="Why these two" description="Evidence from both sides. Every reason cites the record it comes from.">
						<ClaimRows claims={pair.why} />
					</Block>
					<Block title="Risks and constraints">
						<ClaimRows claims={pair.risks} empty="None named." />
					</Block>
				</div>
			)}
			{tab === "challenge" && <ChallengeBody index={index} challengeId={pair.challengeId} />}
			{tab === "researcher" &&
				(profile ? (
					<ResearcherBody index={index} profile={profile} current={pair.id} />
				) : (
					<p className="text-sm text-ink-muted">
						This researcher's profile is not in the run's results. <SourceChip id={pair.researcherId} />
					</p>
				))}
			{tab === "review" && (
				<ReviewHistory className="max-w-[80ch]" unit="Round" verdicts={verdicts} final={pairClaims(pair)} />
			)}
		</DetailFrame>
	)
}

/** The pair's proposal or held-back draft as a link, or why it has none. `failure` is the failed write task's error. */
function ProposalOutcome({ outcome, failure }: { outcome: PairOutcome; failure?: string }) {
	const paths = useResultsPath()
	if (outcome.kind === "proposal" || outcome.kind === "held-back") {
		const id = outcome.kind === "proposal" ? outcome.proposal.id : outcome.held.id
		return (
			<Link to={paths.proposal(id)} className="inline-flex items-center gap-1 text-ink underline-offset-2 hover:underline">
				<FileText className="size-3.5" />
				{outcome.kind === "proposal" ? "Read the proposal" : outcome.held.draft ? "Read the held-back draft" : "Held back for a person"}
			</Link>
		)
	}
	if (outcome.kind === "not-written") {
		return <span title={failure}>{failure ? `Chosen, proposal not written (${failureLabel(failure)})` : "Chosen, proposal not written"}</span>
	}
	return outcome.kind === "not-chosen" ? "Not chosen for a proposal" : "No proposal written"
}

/** One company challenge: its pairs best fit first, or why no researcher fits. */
export function ChallengeDetail({ index, challengeId }: { index: ResultsIndex; challengeId: string }) {
	const paths = useResultsPath()
	const { search } = useFilters()
	const approvals = useRunStore((state) => state.results?.approvals)
	const company = companyOf(index, challengeId.split("-")[0])
	const pairs = index.pairsByChallenge.get(challengeId) ?? []
	const none = noPair(index, challengeId)

	return (
		<DetailFrame
			bodyKey={challengeId}
			header={
				<>
					<h2 className="text-lg font-semibold leading-snug tracking-tight text-ink">{company.name}</h2>
					<Meta
						className="mt-1.5"
						items={[
							<span className="font-mono text-xs">{challengeId}</span>,
							company.sector,
							pairs.length ? `${pairs.length} ${pairs.length === 1 ? "pair" : "pairs"}` : none.label,
						]}
					/>
				</>
			}
		>
			<div className="flex flex-col gap-8">
				{pairs.length === 0 && (
					<Block title={none.label}>
						<p className="max-w-[72ch] rounded-lg bg-sunken p-4 text-sm leading-relaxed text-ink">{none.reason}</p>
					</Block>
				)}
				{pairs.length > 0 && (
					<Block title="Pairs, best fit first" description="Fit compares the pairs for this challenge. It never scores a person.">
						<ul className="max-w-[72ch] divide-y divide-hairline rounded-lg border border-hairline bg-panel">
							{pairs.map((pair) => {
								const profile = index.profiles.get(pair.researcherId)
								const outcome = pairOutcome(index, pair.id)
								const decision = approvals?.[pair.id]?.decision
								return (
									<li key={pair.id}>
										<Link
											to={`${paths.pair(pair.id)}${search}`}
											className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-hover"
										>
											<div className="min-w-0 flex-1">
												<div className="truncate text-sm font-medium text-ink">{profile?.name ?? pair.researcherId}</div>
												<div className="truncate text-xs text-ink-muted">{pair.problem.text}</div>
											</div>
											{outcome.kind === "proposal" && <Chip icon={<FileText />}>Proposal</Chip>}
											{outcome.kind === "held-back" && <Chip icon={<FileText />}>Held back</Chip>}
											{outcome.kind === "not-written" && <Chip>Not written</Chip>}
											{decision && (
												<Status tone={decision === "approved" ? "working" : "failed"} className="text-sm">
													{decision === "approved" ? "Approved" : "Rejected"}
												</Status>
											)}
											<PairFit fit={pair.fit} className="w-14 text-right text-sm text-ink-muted" />
										</Link>
									</li>
								)
							})}
						</ul>
					</Block>
				)}
				<ChallengeBody index={index} challengeId={challengeId} />
			</div>
		</DetailFrame>
	)
}

/** The challenge in the company's words, as the Analyst read it, and what the company brings. */
function ChallengeBody({ index, challengeId }: { index: ResultsIndex; challengeId: string }) {
	const { source } = useSource(challengeId)
	const need = index.needs.get(challengeId)
	return (
		<div className="flex flex-col gap-8">
			<Block title="In the company's words">
				<blockquote className="max-w-[72ch] whitespace-pre-line border-l-2 border-strong pl-4 text-sm leading-relaxed text-ink">
					{source?.text ?? source?.title ?? "…"} <SourceChip id={challengeId} className="ml-1 align-middle" />
				</blockquote>
			</Block>
			{need ? (
				<>
					<Block title="As a research question" description="The Industry Analyst's restatement, in research terms.">
						<p className="max-w-[72ch] text-sm leading-relaxed text-ink">
							<ClaimText claim={need.restatement} />
						</p>
					</Block>
					<Block title={TRIAGE_LABEL[need.triage]}>
						<p className="max-w-[72ch] text-sm leading-relaxed text-ink-muted">{need.triageReason}</p>
					</Block>
					<Block title="What the company brings">
						<ClaimRows claims={need.assets} />
					</Block>
					<Block title="Constraints">
						<ClaimRows claims={need.constraints} empty="None named." />
					</Block>
				</>
			) : (
				<p className="text-sm text-ink-muted">The Analyst's reading of this challenge did not pass review, so only the company's words are shown.</p>
			)}
		</div>
	)
}

/** The researcher's profile: expertise and industry ties, each with sources. Availability is a constraint, never a reason. */
function ResearcherBody({ index, profile, current }: { index: ResultsIndex; profile: ResearcherProfile; current: string }) {
	const paths = useResultsPath()
	const { search } = useFilters()
	const others = [...index.pairs.values()].filter((pair) => pair.researcherId === profile.researcherId && pair.id !== current)
	return (
		<div className="flex flex-col gap-8">
			<div className="flex flex-col gap-1">
				<div className="text-md font-medium text-ink">{profile.name}</div>
				<div className="text-sm text-ink-muted">{[profile.title, profile.department, profile.faculty].filter(Boolean).join(", ")}</div>
				<div className="mt-1.5 flex flex-wrap items-center gap-2">
					<SourceChip id={profile.researcherId} />
					{profile.aliases.map((alias) => (
						<Chip key={alias} mono title="A duplicate profile merged into this one">
							also {alias}
						</Chip>
					))}
					{!profile.canLead && (
						<Status tone="needs" className="text-sm">
							Cannot lead or supervise: emeritus, left, or on leave
						</Status>
					)}
				</div>
			</div>
			<Block title="Expertise">
				<ClaimRows claims={profile.expertise} />
			</Block>
			<Block title="Industry ties">
				<ClaimRows claims={profile.industryFit} empty="None found in the dataset." />
			</Block>
			<Block title="Availability" description="A constraint for planning. It is never a reason for a match.">
				<p className={cn("max-w-[72ch] text-sm", profile.availability ? "text-ink" : "text-ink-muted")}>
					{profile.availability ? <ClaimText claim={profile.availability} /> : "Not stated."}
				</p>
			</Block>
			{others.length > 0 && (
				<Block title="Also paired with">
					<ul className="max-w-[72ch] divide-y divide-hairline rounded-lg border border-hairline bg-panel">
						{others.map((pair) => (
							<li key={pair.id}>
								<Link to={`${paths.pair(pair.id)}${search}`} className="flex items-center gap-4 px-4 py-3 text-sm transition-colors hover:bg-hover">
									<span className="min-w-0 flex-1 truncate text-ink">{companyOf(index, pair.companyId).name}</span>
									<span className="font-mono text-xs text-ink-subtle">{pair.challengeId}</span>
									<PairFit fit={pair.fit} className="w-14 text-right text-ink-muted" />
								</Link>
							</li>
						))}
					</ul>
				</Block>
			)}
		</div>
	)
}

