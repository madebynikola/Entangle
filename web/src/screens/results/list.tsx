import { ChevronDown, FileText, X } from "lucide-react"
import { Fragment, useEffect, useMemo, useRef } from "react"
import type * as React from "react"
import { Link, useNavigate, useSearchParams } from "react-router"
import { Chip } from "@/components/ui/chip"
import { Segmented } from "@/components/ui/segmented"
import { StatusDot, StatusLabel } from "@/components/ui/status"
import { cn } from "@/lib/utils"
import { useRunStore } from "@/run/hooks"
import {
	challengeIdOf,
	companyOf,
	noPair,
	researcherIdOf,
	researcherName,
	reviewsOf,
	reviewSummary,
	useResultsPath,
	type ResultsIndex,
} from "./data"
import { DecisionStatus } from "./decision"
import { applyFilters, filterOptions, useFilters } from "./filters"
import { ChallengeText, PairFit } from "./parts"

export type ListMode = "proposals" | "pairs"

/** The left side of the split: proposals or pairs, the selected one marked. It scrolls on its own. */
export function ListPane({ mode, index, selected }: { mode: ListMode; index: ResultsIndex; selected?: string }) {
	const navigate = useNavigate()
	const paths = useResultsPath()
	const { search } = useFilters()
	return (
		<aside className="flex shrink-0 flex-col border-b border-hairline lg:min-h-0 lg:w-[22rem] lg:border-b-0 lg:border-r xl:w-[24rem]">
			<div className="flex flex-col gap-3 p-4">
				<Segmented<ListMode>
					aria-label="Show"
					className="flex w-full [&>button]:flex-1"
					value={mode}
					onValueChange={(value) => navigate(value === "pairs" ? `${paths.pairs}${search}` : paths.base)}
					items={[
						{ value: "proposals", label: <Count label="Proposals" n={index.proposals.size + index.heldBack.length} /> },
						{ value: "pairs", label: <Count label="Pairs" n={index.pairs.size} /> },
					]}
				/>
				{mode === "pairs" && <FilterBar index={index} />}
			</div>
			<nav
				aria-label={mode === "pairs" ? "Pairs by challenge" : "Proposals"}
				className="scrollbar-thin max-h-[50vh] overflow-y-auto border-t border-hairline lg:max-h-none lg:min-h-0 lg:flex-1"
			>
				{mode === "proposals" ? <ProposalList index={index} selected={selected} /> : <PairList index={index} selected={selected} />}
			</nav>
		</aside>
	)
}

function Count({ label, n }: { label: string; n: number }) {
	return (
		<>
			{label}
			<span className="text-ink-subtle">{n}</span>
		</>
	)
}

/** A row in the list: a link that shows when it is the one open on the right. */
function Row({ to, active, className, children }: { to: string; active: boolean; className?: string; children: React.ReactNode }) {
	const ref = useRef<HTMLAnchorElement>(null)
	// The open item stays in view, also when it was opened from a link or the map.
	useEffect(() => {
		if (active) ref.current?.scrollIntoView({ block: "nearest" })
	}, [active])
	return (
		<Link
			ref={ref}
			to={to}
			aria-current={active ? "page" : undefined}
			className={cn(
				"block outline-none transition-colors duration-150 hover:bg-hover focus-visible:bg-hover",
				active && "bg-selected shadow-[inset_2px_0_0_var(--ink)] hover:bg-selected",
				className,
			)}
		>
			{children}
		</Link>
	)
}

function GroupLabel({ children }: { children: React.ReactNode }) {
	return <div className="sticky top-0 z-[1] border-b border-hairline bg-panel px-4 py-2">{children}</div>
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

function ProposalList({ index, selected }: { index: ResultsIndex; selected?: string }) {
	const paths = useResultsPath()
	const [params] = useSearchParams()
	const keep = params.get("tab") ? `?tab=${params.get("tab")}` : ""
	const proposals = [...index.proposals.values()]
	if (proposals.length === 0 && index.heldBack.length === 0) {
		return <p className="p-4 text-sm text-ink-muted">No proposals yet. Writers post them here once their pair is chosen.</p>
	}
	const names = (pairId: string) => {
		const pair = index.pairs.get(pairId)
		const company = companyOf(index, pair?.companyId ?? challengeIdOf(pairId).split("-")[0])
		return `${company.name} and ${researcherName(index, pair?.researcherId ?? researcherIdOf(pairId))}`
	}
	return (
		<>
			{proposals.map((proposal) => {
				const review = reviewSummary(reviewsOf(index.results, "proposal", proposal.id))
				return (
					<Row key={proposal.id} to={`${paths.proposal(proposal.id)}${keep}`} active={selected === proposal.id} className="border-b border-hairline px-4 py-3.5">
						<div className="line-clamp-2 text-sm font-medium leading-snug text-ink">{proposal.title}</div>
						<div className="mt-1 truncate text-xs text-ink-muted">{names(proposal.pairId)}</div>
						<div className="mt-2.5 flex items-center justify-between gap-3 text-xs">
							<DecisionStatus pairId={proposal.pairId} className="text-xs" />
							<span className="truncate text-ink-subtle">{review.label}</span>
						</div>
					</Row>
				)
			})}
			{index.heldBack.length > 0 && (
				<>
					<GroupLabel>
						<div className="text-xs font-medium text-ink">Held back for a person</div>
						<div className="text-xs text-ink-subtle">The Critics did not accept them. A person decides.</div>
					</GroupLabel>
					{index.heldBack.map((held) => (
						<Row key={held.id} to={paths.proposal(held.id)} active={selected === held.id} className="border-b border-hairline px-4 py-3.5">
							{held.draft ? (
								<>
									<div className="line-clamp-2 text-sm font-medium leading-snug text-ink">{held.draft.title}</div>
									<div className="mt-1 truncate text-xs text-ink-muted">{names(held.pairId)}</div>
								</>
							) : (
								<>
									<div className="truncate text-sm font-medium text-ink">{names(held.pairId)}</div>
									<div className="mt-1 font-mono text-xs text-ink-subtle">{held.id}</div>
								</>
							)}
							<div className="mt-2.5 flex items-center justify-between gap-3 text-xs">
								<DecisionStatus pairId={held.pairId} className="text-xs" />
								<StatusLabel tone="needs" className="text-ink-muted">
									Needs human review
								</StatusLabel>
							</div>
						</Row>
					))}
				</>
			)}
		</>
	)
}

// ---------------------------------------------------------------------------
// Pairs, grouped by company and challenge
// ---------------------------------------------------------------------------

function PairList({ index, selected }: { index: ResultsIndex; selected?: string }) {
	const paths = useResultsPath()
	const { filters, set, active, search } = useFilters()
	const visible = useMemo(() => applyFilters(index, filters), [index, filters])
	const approvals = useRunStore((state) => state.results?.approvals)

	if (visible.challenges.length === 0) {
		return (
			<div className="p-4 text-sm text-ink-muted">
				{active ? "No pairs match these filters." : "No pairs yet. The Matchmaker posts them here as it finds them."}
				{active && (
					<button
						type="button"
						onClick={() => set({ sector: "", faculty: "", challenge: "", researcher: "" })}
						className="ml-1 text-link underline-offset-2 hover:underline"
					>
						Clear filters
					</button>
				)}
			</div>
		)
	}

	let company = ""
	return (
		<>
			{visible.challenges.map((challengeId) => {
				const owner = companyOf(index, challengeId.split("-")[0])
				const header = owner.id !== company
				company = owner.id
				const pairs = (index.pairsByChallenge.get(challengeId) ?? []).filter((pair) => visible.pairs.has(pair.id))
				return (
					<Fragment key={challengeId}>
						{header && (
							<GroupLabel>
								<div className="truncate text-xs font-medium text-ink">{owner.name}</div>
								{owner.sector && <div className="truncate text-xs text-ink-subtle">{owner.sector}</div>}
							</GroupLabel>
						)}
						<div className="border-b border-hairline py-1">
							<Row to={`${paths.base}/challenges/${encodeURIComponent(challengeId)}${search}`} active={selected === challengeId} className="px-4 py-2">
								<div className="flex gap-2.5">
									<span className="w-12 shrink-0 pt-px font-mono text-xs text-ink-subtle">{challengeId.split("-")[1]}</span>
									<div className="min-w-0 flex-1">
										<ChallengeText index={index} challengeId={challengeId} className="line-clamp-2 text-sm leading-snug text-ink-muted" />
										{pairs.length === 0 && <NoPairLine index={index} challengeId={challengeId} />}
									</div>
								</div>
							</Row>
							{pairs.map((pair) => {
								const decision = approvals?.[pair.id]?.decision
								const profile = index.profiles.get(pair.researcherId)
								return (
									<Row key={pair.id} to={`${paths.pair(pair.id)}${search}`} active={selected === pair.id} className="py-2 pl-[4.375rem] pr-4">
										<div className="flex items-center gap-3">
											<div className="min-w-0 flex-1">
												<div className="truncate text-sm text-ink">{profile?.name ?? pair.researcherId}</div>
												{profile?.faculty && <div className="truncate text-xs text-ink-subtle">{profile.faculty}</div>}
											</div>
											{index.proposalByPair.has(pair.id) && (
												<FileText aria-label="Proposal written" className="size-3.5 shrink-0 text-ink-subtle" />
											)}
											{decision && (
												<span className="inline-flex" title={decision === "approved" ? "Approved" : "Rejected"}>
													<StatusDot tone={decision === "approved" ? "working" : "failed"} className="size-1.5" />
													<span className="sr-only">{decision === "approved" ? "Approved" : "Rejected"}</span>
												</span>
											)}
											<PairFit fit={pair.fit} className="w-14 shrink-0 text-right text-xs text-ink-muted" />
										</div>
									</Row>
								)
							})}
						</div>
					</Fragment>
				)
			})}
		</>
	)
}

function NoPairLine({ index, challengeId }: { index: ResultsIndex; challengeId: string }) {
	const { label, reason } = noPair(index, challengeId)
	return (
		<div className="mt-1.5 line-clamp-3 text-xs text-ink-subtle">
			<span className="font-medium text-ink-muted">{label}.</span> {reason}
		</div>
	)
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function FilterBar({ index }: { index: ResultsIndex }) {
	const { filters, set, active } = useFilters()
	const options = useMemo(() => filterOptions(index), [index])
	const visible = useMemo(() => applyFilters(index, filters), [index, filters])
	return (
		<div className="flex flex-col gap-2">
			<div className="grid grid-cols-2 gap-2">
				<FilterSelect label="Sector" value={filters.sector} onChange={(sector) => set({ sector })}>
					<option value="">All sectors</option>
					{options.sectors.map((sector) => (
						<option key={sector} value={sector}>
							{sector}
						</option>
					))}
				</FilterSelect>
				<FilterSelect label="Faculty" value={filters.faculty} onChange={(faculty) => set({ faculty })}>
					<option value="">All faculties</option>
					{options.faculties.map((faculty) => (
						<option key={faculty} value={faculty}>
							{faculty}
						</option>
					))}
				</FilterSelect>
			</div>
			<FilterSelect label="Challenge" value={filters.challenge} onChange={(challenge) => set({ challenge })}>
				<option value="">All challenges</option>
				{options.companies.map(({ company, challenges }) => (
					<optgroup key={company.id} label={company.name}>
						{challenges.map((challengeId) => (
							<option key={challengeId} value={challengeId}>
								{challengeId} {short(index.needs.get(challengeId)?.restatement.text)}
							</option>
						))}
					</optgroup>
				))}
			</FilterSelect>
			<div className="flex min-h-6 flex-wrap items-center gap-2 text-xs text-ink-muted">
				<span className="tabular">{active ? `${visible.shown} of ${visible.total} pairs` : `${visible.total} pairs in ${visible.challenges.length} challenges`}</span>
				{filters.researcher && (
					<Chip asChild>
						<button type="button" onClick={() => set({ researcher: "" })} aria-label="Show every researcher">
							{researcherName(index, filters.researcher)}
							<X />
						</button>
					</Chip>
				)}
				{active && (
					<button
						type="button"
						onClick={() => set({ sector: "", faculty: "", challenge: "", researcher: "" })}
						className="ml-auto text-ink-muted transition-colors hover:text-ink"
					>
						Clear filters
					</button>
				)}
			</div>
		</div>
	)
}

function short(text: string | undefined): string {
	if (!text) return ""
	return `· ${text.length > 48 ? `${text.slice(0, 47).trimEnd()}…` : text}`
}

function FilterSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
	return (
		<div className="relative min-w-0">
			<select
				aria-label={label}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				className={cn(
					"h-8 w-full min-w-0 cursor-pointer appearance-none truncate rounded-md border border-hairline bg-panel pl-2.5 pr-7 text-sm shadow-card outline-none transition-colors duration-150 hover:border-strong focus-visible:border-link focus-visible:ring-3 focus-visible:ring-link/15",
					value ? "text-ink" : "text-ink-muted",
				)}
			>
				{children}
			</select>
			<ChevronDown aria-hidden className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-ink-subtle" />
		</div>
	)
}
