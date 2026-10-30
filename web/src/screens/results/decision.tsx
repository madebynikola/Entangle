import type { ApprovalDecision } from "@shared/server/api"
import { Check, X } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Status, StatusLabel } from "@/components/ui/status"
import { toast } from "@/components/ui/toaster"
import * as format from "@/lib/format"
import { cn } from "@/lib/utils"
import { useBackend, useRunStore } from "@/run/hooks"

const WORD: Record<ApprovalDecision, string> = { approved: "Approved", rejected: "Rejected" }

/** A pair's decision as a status: approved, rejected, or none yet. */
export function DecisionStatus({ pairId, className }: { pairId: string; className?: string }) {
	const approval = useRunStore((state) => state.results?.approvals[pairId])
	if (!approval) {
		return (
			<StatusLabel tone="idle" className={cn("text-ink-muted", className)}>
				No decision
			</StatusLabel>
		)
	}
	return (
		<Status tone={approval.decision === "approved" ? "working" : "failed"} className={className}>
			{WORD[approval.decision]}
		</Status>
	)
}

/** Where a decision is kept, in words for a toast. */
function useSavedIn(): string {
	const backend = useBackend()
	const runId = useRunStore((state) => state.runId)
	return backend?.kind === "server" && runId !== "sample" ? `Saved in out/${runId}/approvals.json` : "Saved in this browser"
}

/**
 * A person approves or rejects a pair before anyone reaches out: the one primary action of a detail view.
 * Reject asks for a reason (optional), so the record says why.
 */
export function DecisionBar({ pairId, className }: { pairId: string; className?: string }) {
	const approval = useRunStore((state) => state.results?.approvals[pairId])
	const approve = useRunStore((state) => state.approve)
	const savedIn = useSavedIn()
	const [busy, setBusy] = useState(false)
	const [rejecting, setRejecting] = useState(false)
	const [note, setNote] = useState("")

	const decide = async (decision: ApprovalDecision | null, withNote?: string) => {
		setBusy(true)
		try {
			await approve(pairId, decision, withNote)
			toast.success(decision ? WORD[decision] : "Decision cleared", { description: decision ? savedIn : pairId })
			setRejecting(false)
			setNote("")
		} catch (error) {
			toast.error("The decision was not saved", { description: error instanceof Error ? error.message : String(error) })
		} finally {
			setBusy(false)
		}
	}

	if (approval) {
		return (
			<div className={cn("flex items-center gap-3", className)}>
				<div className="min-w-0 text-right">
					<Status tone={approval.decision === "approved" ? "working" : "failed"} className="font-medium">
						{WORD[approval.decision]}
					</Status>
					<div className="tabular text-xs text-ink-subtle">{format.dateTime(approval.decidedAt)}</div>
				</div>
				<Button size="sm" variant="quiet" disabled={busy} onClick={() => decide(null)}>
					Change
				</Button>
			</div>
		)
	}

	return (
		<div className={cn("flex items-center gap-2", className)}>
			<Popover open={rejecting} onOpenChange={setRejecting}>
				<PopoverTrigger asChild>
					<Button size="sm" disabled={busy}>
						<X />
						Reject
					</Button>
				</PopoverTrigger>
				<PopoverContent align="end" className="flex w-80 flex-col gap-3">
					<div>
						<div className="text-sm font-semibold text-ink">Reject this pair</div>
						<p className="mt-0.5 text-sm text-ink-muted">Nobody is contacted. Say why, for the record.</p>
					</div>
					<textarea
						autoFocus
						value={note}
						onChange={(event) => setNote(event.target.value)}
						rows={3}
						placeholder="Reason (optional)"
						aria-label="Reason for rejecting"
						className="scrollbar-thin w-full resize-none rounded-md border border-hairline bg-panel px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-subtle hover:border-strong focus-visible:border-link focus-visible:ring-3 focus-visible:ring-link/15"
					/>
					<div className="flex justify-end gap-2">
						<Button size="sm" variant="quiet" onClick={() => setRejecting(false)}>
							Cancel
						</Button>
						<Button size="sm" variant="danger" disabled={busy} onClick={() => decide("rejected", note)}>
							Reject
						</Button>
					</div>
				</PopoverContent>
			</Popover>
			<Button size="sm" variant="primary" disabled={busy} onClick={() => decide("approved")}>
				<Check />
				Approve
			</Button>
		</div>
	)
}

/** The note a person left with a decision, if any. */
export function DecisionNote({ pairId, className }: { pairId: string; className?: string }) {
	const approval = useRunStore((state) => state.results?.approvals[pairId])
	if (!approval?.note) return null
	return (
		<p className={cn("whitespace-pre-line border-l-2 border-strong pl-3 text-sm text-ink-muted", className)}>
			<span className="text-ink">{WORD[approval.decision]}: </span>
			{approval.note}
		</p>
	)
}
