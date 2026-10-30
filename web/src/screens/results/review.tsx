import type { Claim, CriticVerdict } from "@shared/types"
import { ClaimText } from "@/components/shell/source"
import { Chip } from "@/components/ui/chip"
import { StatusDot, type StatusTone } from "@/components/ui/status"
import { cn } from "@/lib/utils"
import { CHECK_LABEL, findFix, modelLabel, type Fix } from "./data"

function outcome(verdict: CriticVerdict): { tone: StatusTone; label: string } {
	if (verdict.ok) return { tone: "working", label: "Passed" }
	if (verdict.action === "human-review") return { tone: "needs", label: "Needs human review" }
	if (verdict.action === "drop") return { tone: "failed", label: "Dropped" }
	return { tone: "needs", label: "Sent back" }
}

/**
 * The Critic history of one artifact: each draft (or review round), what was rejected and why,
 * and what became of each rejected claim in the final version.
 */
export function ReviewHistory({
	verdicts,
	final,
	unit = "Draft",
	className,
}: {
	verdicts: CriticVerdict[]
	/** The claims of the version shown now, to say how each rejected claim was fixed. */
	final?: Claim[]
	unit?: "Draft" | "Round"
	className?: string
}) {
	const pairs = verdicts.some((verdict) => (verdict.reviewers?.length ?? 0) > 1)
	return (
		<div className={cn("flex flex-col gap-5", className)}>
			<p className="text-sm text-ink-muted">
				{pairs
					? "Two Critics check every claim against the record it cites, each in its own context. A claim passes only if both pass it."
					: "The Critic checks every claim against the record it cites."}{" "}
				A rejected claim goes back to its writer, who fixes only that claim.
			</p>
			{verdicts.length === 0 ? (
				<p className="text-sm text-ink-muted">Not reviewed yet.</p>
			) : (
				<ol className="flex flex-col">
					{verdicts.map((verdict, i) => {
						const last = i === verdicts.length - 1
						const { tone, label } = outcome(verdict)
						return (
							<li key={i} className="relative pb-5 pl-5 last:pb-0">
								{!last && <span aria-hidden className="absolute bottom-0 left-[3px] top-3 w-px bg-hairline" />}
								<StatusDot tone={tone} className="absolute left-0 top-1.5" />
								<div className="flex flex-wrap items-baseline justify-between gap-x-3">
									<span className="text-sm font-medium text-ink">
										{unit} {verdict.revision + 1}
									</span>
									<span className="text-sm text-ink-muted">
										{label}
										{verdict.rejected.length > 0 && ` · ${verdict.rejected.length} ${verdict.rejected.length === 1 ? "claim" : "claims"}`}
									</span>
								</div>
								{verdict.reviewers && verdict.reviewers.length > 0 && (
									<div className="mt-1 flex flex-col gap-0.5 text-xs text-ink-subtle">
										{verdict.reviewers.map((reviewer) => (
											<span key={reviewer.reviewer}>
												{reviewer.reviewer} on {modelLabel(reviewer.model)}: {reviewer.rejected ? `rejected ${reviewer.rejected}` : "passed every claim"}
											</span>
										))}
									</div>
								)}
								{verdict.rejected.length > 0 && (
									<ul className="mt-3 flex flex-col gap-2">
										{verdict.rejected.map((rejected, j) => (
											<li key={j} className="rounded-md bg-sunken p-3 text-sm">
												<ClaimText claim={rejected.claim} struck />
												<div className="mt-2 flex flex-wrap gap-1.5">
													{rejected.check && <Chip>{CHECK_LABEL[rejected.check]}</Chip>}
													{rejected.reviewers?.length === 1 && pairs && <Chip>only {rejected.reviewers[0]}</Chip>}
												</div>
												<Reason text={rejected.reason} />
												{!last && final && final.length > 0 && <FixLine fix={findFix(rejected.claim, final)} />}
											</li>
										))}
									</ul>
								)}
							</li>
						)
					})}
				</ol>
			)}
		</div>
	)
}

/** With two Critics, the reason reads "critic: … critic-2: …": one line per reviewer. */
function Reason({ text }: { text: string }) {
	const parts = text.split(/(?=\bcritic(?:-\d+)?: )/).map((part) => part.match(/^(critic(?:-\d+)?): ([\s\S]*)$/) ?? [part, "", part])
	return (
		<div className="mt-2 flex flex-col gap-1 text-ink-muted">
			{parts.map(([, who, body], i) => (
				<p key={i}>
					{who && <span className="font-medium text-ink">{who}: </span>}
					{body.trim()}
				</p>
			))}
		</div>
	)
}

function FixLine({ fix }: { fix: Fix }) {
	return (
		<div className="mt-3 border-t border-hairline pt-2.5">
			{fix.kind === "removed" ? (
				<span className="text-ink-muted">Taken out of the final version.</span>
			) : (
				<>
					<div className="mb-1 text-xs text-ink-muted">
						{fix.kind === "rewritten" ? "Rewritten as" : fix.kind === "new-sources" ? "Kept, with other sources" : "Kept as written"}
					</div>
					<ClaimText claim={fix.claim} />
				</>
			)}
		</div>
	)
}
