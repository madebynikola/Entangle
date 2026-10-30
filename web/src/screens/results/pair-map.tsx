import type { PairCandidate } from "@shared/types"
import { useMemo, useState } from "react"
import type * as React from "react"
import { useNavigate } from "react-router"
import { cn } from "@/lib/utils"
import { useRunStore } from "@/run/hooks"
import { byDatasetId, companyOf, noPair, useResultsPath, type Company, type ResultsIndex } from "./data"
import { applyFilters, useFilters } from "./filters"
import { ChallengeText, DetailFrame } from "./parts"

const ROW = 28
const HEAD = 32

type Focus = { kind: "challenge" | "researcher" | "pair"; id: string }

interface Plan {
	height: number
	companies: { company: Company; top: number }[]
	challenges: { id: string; top: number }[]
	researchers: { id: string; top: number }[]
	y: Map<string, number>
}

/**
 * Challenges on the left, grouped by company, in dataset order. Researchers on the right, each placed level with
 * its challenges where room allows, so most lines run flat and few cross.
 */
function plan(index: ResultsIndex): Plan {
	const y = new Map<string, number>()
	const companies: Plan["companies"] = []
	const challenges: Plan["challenges"] = []
	let top = 0
	let company = ""
	for (const id of index.challengeIds) {
		const owner = id.split("-")[0]
		if (owner !== company) {
			companies.push({ company: companyOf(index, owner), top })
			top += HEAD
			company = owner
		}
		challenges.push({ id, top })
		y.set(id, top + ROW / 2)
		top += ROW
	}
	const researcherIds = new Set([...index.pairs.values()].filter((pair) => y.has(pair.challengeId)).map((pair) => pair.researcherId))
	const height = Math.max(top, researcherIds.size * ROW)
	// When the researchers need more room, the challenges sit in the middle.
	const shift = (height - top) / 2
	for (const item of [...companies, ...challenges]) item.top += shift
	for (const item of challenges) y.set(item.id, item.top + ROW / 2)

	const wanted = new Map<string, number[]>()
	for (const pair of index.pairs.values()) {
		const at = y.get(pair.challengeId)
		if (at != null) wanted.set(pair.researcherId, [...(wanted.get(pair.researcherId) ?? []), at])
	}
	const order = [...wanted]
		.map(([id, list]) => ({ id, at: list.reduce((a, b) => a + b, 0) / list.length - ROW / 2 }))
		.sort((a, b) => a.at - b.at || byDatasetId(a.id, b.id))
	// Each researcher as close to its challenges as the rows above allow; then pushed up from the bottom if needed.
	const tops = order.map((item) => item.at)
	for (let i = 0; i < tops.length; i++) tops[i] = Math.max(tops[i], i ? tops[i - 1] + ROW : 0)
	for (let i = tops.length - 1; i >= 0; i--) tops[i] = Math.min(tops[i], i < tops.length - 1 ? tops[i + 1] - ROW : height - ROW)
	const researchers = order.map((item, i) => ({ id: item.id, top: Math.max(0, tops[i]) }))
	for (const researcher of researchers) y.set(researcher.id, researcher.top + ROW / 2)
	return { height, companies, challenges, researchers, y }
}

/** A point on a pair's curve, t from 0 (challenge) to 1 (researcher). x in % of the middle column, y in px. */
function along(t: number, y1: number, y2: number): { x: number; y: number } {
	const u = 1 - t
	return { x: 150 * u * u * t + 150 * u * t * t + 100 * t * t * t, y: y1 * (u * u * u + 3 * u * u * t) + y2 * (3 * u * t * t + t * t * t) }
}

/** The map of who could work with whom. Hover a node or a line to trace its pairs; click to open. */
export function PairMap({ index }: { index: ResultsIndex }) {
	const navigate = useNavigate()
	const paths = useResultsPath()
	const { filters, active, search } = useFilters()
	const approvals = useRunStore((state) => state.results?.approvals)
	const layout = useMemo(() => plan(index), [index])
	const visible = useMemo(() => applyFilters(index, filters), [index, filters])
	const [focus, setFocus] = useState<Focus | null>(null)
	const pairs = [...index.pairs.values()]

	const hot = (pair: PairCandidate) =>
		focus != null &&
		(focus.kind === "challenge" ? pair.challengeId === focus.id : focus.kind === "researcher" ? pair.researcherId === focus.id : pair.id === focus.id)
	const lit = new Set<string>()
	for (const pair of pairs) if (hot(pair)) lit.add(pair.challengeId).add(pair.researcherId)

	const node = (id: string, shown: boolean) =>
		cn(
			"absolute inset-x-0 flex items-center gap-2 rounded-md px-2 text-sm outline-none transition-[opacity,background-color,color] duration-150 focus-visible:ring-2 focus-visible:ring-link/40",
			lit.has(id) ? "bg-hover text-ink" : "text-ink-muted hover:bg-hover hover:text-ink",
			active && !shown && "opacity-35",
			focus && !lit.has(id) && "opacity-60",
		)

	return (
		<div>
			<div
				className="relative grid grid-cols-[minmax(0,1fr)_minmax(6rem,0.7fr)_minmax(0,1fr)]"
				style={{ height: layout.height }}
				onMouseLeave={() => setFocus(null)}
			>
				<div className="relative">
					{layout.companies.map(({ company, top }) => (
						<div key={company.id} className="absolute inset-x-0 flex items-end justify-end px-2 pb-1.5" style={{ top, height: HEAD }}>
							<span className="truncate text-xs font-medium text-ink">{company.name}</span>
						</div>
					))}
					{layout.challenges.map(({ id, top }) => {
						const none = !index.pairsByChallenge.get(id)?.length
						return (
							<button
								key={id}
								type="button"
								style={{ top, height: ROW }}
								className={cn(node(id, visible.challenges.includes(id)), "justify-end", none && "text-ink-subtle")}
								title={none ? `${noPair(index, id).label}. ${noPair(index, id).reason}` : undefined}
								onMouseEnter={() => setFocus({ kind: "challenge", id })}
								onFocus={() => setFocus({ kind: "challenge", id })}
								onClick={() => navigate(`${paths.base}/challenges/${encodeURIComponent(id)}${search}`)}
							>
								<ChallengeText index={index} challengeId={id} className="min-w-0 truncate" />
								<span className="shrink-0 font-mono text-xs text-ink-subtle">{id.split("-")[1]}</span>
							</button>
						)
					})}
				</div>

				<div className="relative">
					<svg viewBox={`0 0 100 ${layout.height}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
						{pairs.map((pair) => {
							const y1 = layout.y.get(pair.challengeId)
							const y2 = layout.y.get(pair.researcherId)
							if (y1 == null || y2 == null) return null
							const d = `M0,${y1} C50,${y1} 50,${y2} 100,${y2}`
							const decision = approvals?.[pair.id]?.decision
							const written = index.proposalByPair.has(pair.id)
							const shown = visible.pairs.has(pair.id)
							const on = hot(pair)
							const stroke =
								decision === "approved" ? "var(--working)" : decision === "rejected" ? "var(--failed)" : written ? "var(--ink)" : "var(--strong)"
							return (
								<g key={pair.id}>
									<path
										d={d}
										fill="none"
										stroke={stroke}
										strokeWidth={on ? 2 : written || decision ? 1.5 : 1.25}
										strokeDasharray={decision === "rejected" ? "4 3" : undefined}
										vectorEffect="non-scaling-stroke"
										opacity={!shown ? 0.08 : focus ? (on ? 1 : 0.12) : 1}
										className="transition-opacity duration-150"
									/>
									{shown && (
										<path
											d={d}
											fill="none"
											stroke="transparent"
											strokeWidth={12}
											vectorEffect="non-scaling-stroke"
											pointerEvents="stroke"
											className="cursor-pointer"
											onMouseEnter={() => setFocus({ kind: "pair", id: pair.id })}
											onClick={() => navigate(`${paths.pair(pair.id)}${search}`)}
										>
											<title>{`${pair.challengeId} and ${index.profiles.get(pair.researcherId)?.name ?? pair.researcherId}`}</title>
										</path>
									)}
								</g>
							)
						})}
					</svg>
					{focus &&
						pairs.filter(hot).map((pair) => {
							const at = along(focus.kind === "challenge" ? 0.8 : focus.kind === "researcher" ? 0.2 : 0.5, layout.y.get(pair.challengeId)!, layout.y.get(pair.researcherId)!)
							return (
								<span
									key={pair.id}
									className="tabular pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-hairline bg-panel px-1.5 text-xs text-ink shadow-card"
									style={{ left: `${at.x}%`, top: at.y }}
								>
									fit {Math.round(pair.fit * 100)}%
								</span>
							)
						})}
				</div>

				<div className="relative">
					{layout.researchers.map(({ id, top }) => {
						const profile = index.profiles.get(id)
						return (
							<button
								key={id}
								type="button"
								style={{ top, height: ROW }}
								className={node(id, visible.researchers.has(id))}
								onMouseEnter={() => setFocus({ kind: "researcher", id })}
								onFocus={() => setFocus({ kind: "researcher", id })}
								onClick={() => {
									const params = new URLSearchParams(search)
									params.set("researcher", id)
									navigate(`${paths.pairs}?${params}`)
								}}
							>
								<span className="shrink-0 truncate">{profile?.name ?? id}</span>
								{profile?.faculty && <span className="min-w-0 truncate text-xs text-ink-subtle">{profile.faculty.replace(/^Faculty of /, "")}</span>}
							</button>
						)
					})}
				</div>
			</div>

			<div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-muted">
				<Key color="var(--ink)">Proposal written</Key>
				<Key color="var(--strong)">Candidate pair</Key>
				<Key color="var(--working)">Approved</Key>
				<Key color="var(--failed)" dashed>
					Rejected
				</Key>
				<span>A challenge with no line has no pair. Hover it to see why.</span>
			</div>
		</div>
	)
}

function Key({ color, dashed, children }: { color: string; dashed?: boolean; children: React.ReactNode }) {
	return (
		<span className="inline-flex items-center gap-2">
			<svg width="20" height="2" aria-hidden className="overflow-visible">
				<line x1="0" x2="20" y1="1" y2="1" stroke={color} strokeWidth="1.5" strokeDasharray={dashed ? "4 3" : undefined} />
			</svg>
			{children}
		</span>
	)
}

/** The right side of the pairs view when no pair is open: the map. */
export function MapDetail({ index }: { index: ResultsIndex }) {
	const { shown, total } = useMemo(() => {
		const all = applyFilters(index, { sector: "", faculty: "", challenge: "", researcher: "" })
		return { shown: all.challenges.length, total: all.total }
	}, [index])
	return (
		<DetailFrame
			header={
				<>
					<h2 className="text-lg font-semibold leading-snug tracking-tight text-ink">Who could work on what</h2>
					<p className="mt-1 max-w-[72ch] text-sm text-ink-muted">
						{total} pairs for {shown} company challenges. Each line is one pair the Matchmaker proposed. Hover to trace it, click to open it.
					</p>
				</>
			}
		>
			{index.pairs.size === 0 && index.challengeIds.length === 0 ? (
				<p className="text-sm text-ink-muted">No pairs yet. The Matchmaker posts them as it finds them.</p>
			) : (
				<>
					<div className="hidden md:block">
						<PairMap index={index} />
					</div>
					<p className="text-sm text-ink-muted md:hidden">Pick a pair or a challenge from the list.</p>
				</>
			)}
		</DetailFrame>
	)
}
