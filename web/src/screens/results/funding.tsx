import type { FundingCall } from "@shared/types"
import { ArrowUpRight } from "lucide-react"
import { Chip } from "@/components/ui/chip"
import { Block } from "./parts"
import type { ResultsIndex } from "./data"

const INNOVATION_FUND_URL = "https://www.inovacionifond.rs"

/**
 * The Funding Scout's EU calls for one pair. Title, programme, deadline, grant and link come from the EU Funding &
 * Tenders portal; the reason and what to check are the Scout's. Nothing when the run has no Scout answer for the pair.
 */
export function FundingBlock({ index, pairId, className }: { index: ResultsIndex; pairId: string; className?: string }) {
	const match = index.results.funding?.find((m) => m.pairId === pairId)
	if (!match) return null
	return (
		<Block
			className={className}
			title="Where to apply"
			description="Open or upcoming EU calls the Funding Scout found in the EU Funding & Tenders portal. The call facts are the portal's; the reasons are the Scout's, and the Critic does not review them."
		>
			{match.calls.length ? (
				<ul className="divide-y divide-hairline rounded-lg border border-hairline bg-panel">
					{match.calls.map(({ call, reason, check }) => (
						<li key={call.id} className="flex flex-col gap-1.5 px-4 py-3 text-sm leading-relaxed">
							<a href={call.url} target="_blank" rel="noreferrer" className="inline-flex items-start gap-1 font-medium text-ink underline-offset-2 hover:underline">
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
	)
}

function date(iso: string): string {
	return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

function when(call: FundingCall): string {
	return call.status === "open" ? `Deadline ${date(call.deadline)}` : `Opens ${call.opens ? date(call.opens) : "soon"} · deadline ${date(call.deadline)}`
}

function grant(call: FundingCall): string | undefined {
	const { min, max } = call.grant ?? {}
	if (!min && !max) return undefined
	const euro = (n: number) => (n >= 1_000_000 ? `€${+(n / 1_000_000).toFixed(1)}M` : `€${Math.round(n / 1000)}k`)
	return min && max && min !== max ? `${euro(min)}–${euro(max)} per grant` : `${euro((max ?? min)!)} per grant`
}
