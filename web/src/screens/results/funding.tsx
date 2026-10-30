import type { FundingCall } from "@shared/types"
import { ArrowUpRight } from "lucide-react"
import { Chip } from "@/components/ui/chip"
import { cn } from "@/lib/utils"
import { Block } from "./parts"
import type { ResultsIndex } from "./data"

const INNOVATION_FUND_URL = "https://www.inovacionifond.rs"

/**
 * The Funding Scout's EU calls and related EU projects for one pair. Every fact comes from the EU Funding & Tenders
 * portal or CORDIS; the reasons and what to check are the Scout's. Nothing when the run has no Scout answer for the pair.
 */
export function FundingBlock({ index, pairId, className }: { index: ResultsIndex; pairId: string; className?: string }) {
	const match = index.results.funding?.find((m) => m.pairId === pairId)
	if (!match) return null
	return (
		<div className={cn("flex flex-col gap-8", className)}>
			<Block
				title="Where to apply"
				description="Open or upcoming EU calls the Funding Scout found in the EU Funding & Tenders portal. The call facts are the portal's; the reasons are the Scout's, and the Critic does not review them."
			>
				{match.calls.length ? (
					<ul className="divide-y divide-hairline rounded-lg border border-hairline bg-panel">
						{match.calls.map(({ call, reason, check }) => (
							<li key={call.id} className="flex flex-col gap-1.5 px-4 py-3 text-sm leading-relaxed">
								<a
									href={call.url}
									target="_blank"
									rel="noreferrer"
									className="inline-flex items-start gap-1 font-medium text-ink underline-offset-2 hover:underline"
								>
									{call.title}
									<ArrowUpRight className="mt-1 size-3.5 shrink-0 text-ink-muted" />
								</a>
								<div className="flex flex-wrap gap-1.5">
									<Chip>{call.programme}</Chip>
									{call.action && <Chip>{call.action}</Chip>}
									<Chip>{when(call)}</Chip>
									{grant(call) && <Chip>{grant(call)}</Chip>}
								</div>
								<p className="text-ink">{reason}</p>
								{check && <p className="text-ink-muted">Check: {check}</p>}
							</li>
						))}
					</ul>
				) : (
					<p className="text-sm text-ink-muted">No open EU call fits this work. {match.noneReason}</p>
				)}
				<p className="text-sm text-ink-muted">
					Serbia's Innovation Fund has no API.{" "}
					<a href={INNOVATION_FUND_URL} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink">
						See its current calls
					</a>
					.
				</p>
			</Block>
			{match.projects?.length ? (
				<Block
					title="EU projects on the same problem"
					description="Funded projects from CORDIS. Their organisations are possible consortium partners. The reasons are the Scout's."
				>
					<ul className="divide-y divide-hairline rounded-lg border border-hairline bg-panel">
						{match.projects.map(({ project, reason }) => (
							<li key={project.id} className="flex flex-col gap-1.5 px-4 py-3 text-sm leading-relaxed">
								<a
									href={project.url}
									target="_blank"
									rel="noreferrer"
									className="inline-flex items-start gap-1 font-medium text-ink underline-offset-2 hover:underline"
								>
									{project.acronym}: {project.title}
									<ArrowUpRight className="mt-1 size-3.5 shrink-0 text-ink-muted" />
								</a>
								<div className="flex flex-wrap gap-1.5">
									<Chip>{project.programme}</Chip>
									<Chip>
										{project.start.slice(0, 4)}–{project.end.slice(0, 4)}
										{project.status === "ongoing" ? " · ongoing" : ""}
									</Chip>
									<Chip>
										{project.organisations} organisation{project.organisations === 1 ? "" : "s"}
									</Chip>
									{project.serbian.length > 0 && <Chip title={project.serbian.join(", ")}>Partner from Serbia</Chip>}
								</div>
								<p className="text-ink">{reason}</p>
								{project.coordinator && (
									<p className="text-ink-muted">
										Coordinated by {project.coordinator.name} ({project.coordinator.country})
										{project.serbian.length ? `. From Serbia: ${project.serbian.join(", ")}` : ""}
									</p>
								)}
							</li>
						))}
					</ul>
				</Block>
			) : null}
		</div>
	)
}

function date(iso: string): string {
	return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

function when(call: FundingCall): string {
	return call.status === "open"
		? `Deadline ${date(call.deadline)}`
		: `Opens ${call.opens ? date(call.opens) : "soon"} · deadline ${date(call.deadline)}`
}

function grant(call: FundingCall): string | undefined {
	const { min, max } = call.grant ?? {}
	if (!min && !max) return undefined
	const euro = (n: number) => (n >= 1_000_000 ? `€${+(n / 1_000_000).toFixed(1)}M` : `€${Math.round(n / 1000)}k`)
	return min && max && min !== max ? `${euro(min)}–${euro(max)} per grant` : `${euro((max ?? min)!)} per grant`
}
