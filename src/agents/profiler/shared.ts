import { failTask, state } from "../../runtime"
import type { Claim, Task } from "../../types"
import { emit } from "../matchmaker/shared"

/** Helpers the Research Profiler and the Industry Analyst share. No model calls. */

/**
 * Claim hygiene before an artifact goes to the blackboard: keep only ids that `resolve` accepts (it returns the
 * canonical id, or undefined for an id that is not one of the subject's records), drop claims left with no id or
 * no text, and merge repeats. The Critic would reject these anyway; catching them here saves a send-back round.
 */
export class ClaimFilter {
	readonly removedIds: string[] = []
	dropped = 0
	private readonly seen = new Set<string>()

	constructor(private readonly resolve: (id: string) => string | undefined) {}

	list(raw: unknown): Claim[] {
		const claims: Claim[] = []
		for (const item of Array.isArray(raw) ? raw : []) {
			const claim = this.clean(item)
			if (claim) claims.push(claim)
		}
		return claims
	}

	one(raw: unknown): Claim | null {
		return raw ? this.clean(raw) : null
	}

	get changed(): boolean {
		return this.dropped > 0 || this.removedIds.length > 0
	}

	private clean(item: { text?: unknown; sourceIds?: unknown }): Claim | null {
		const text = typeof item?.text === "string" ? item.text.replace(/\s+/g, " ").trim() : ""
		const sourceIds: string[] = []
		for (const id of Array.isArray(item?.sourceIds) ? item.sourceIds : []) {
			const canonical = typeof id === "string" ? this.resolve(id.trim()) : undefined
			if (!canonical) this.removedIds.push(String(id))
			else if (!sourceIds.includes(canonical)) sourceIds.push(canonical)
		}
		const key = text.toLowerCase()
		if (!text || !sourceIds.length || this.seen.has(key)) {
			this.dropped++
			return null
		}
		this.seen.add(key)
		return { text, sourceIds }
	}
}

/** Tell the trace what the filter removed, if anything. */
export function reportCleaned(agentId: string, task: Task, subjectId: string, filter: ClaimFilter): void {
	if (!filter.changed) return
	emit(agentId, "claims.cleaned", { taskId: task.id, id: subjectId, removedIds: filter.removedIds.slice(0, 10), droppedClaims: filter.dropped })
}

/** A bad answer gets another attempt with the error attached, up to the budget's maxAttempts; then the task fails. */
export function retryOrFail(agentId: string, task: Task, error: string, retry: (note: string) => void): void {
	if (task.attempts < state().budget.maxAttempts) {
		emit(agentId, "task.retry", { taskId: task.id, error })
		retry(`\n\nYour previous answer could not be used: ${error}. Answer again with valid JSON for the schema.`)
		return
	}
	// The tracker marked the task done on the model's answer. Reopen it so failTask settles it and wakes whenSettled.
	task.status = "running"
	failTask(task, error)
}

/** Embed input data in a prompt, compact, so the model and the mock responders can read it back. */
export function dataBlock(value: unknown): string {
	return "```json\n" + JSON.stringify(value) + "\n```"
}

export function clip(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, "")}…` : text
}

export function firstSentence(text: string): string {
	return text.trim().split(/(?<=[.!?])\s+/)[0] ?? ""
}

export function sentences(text: string): string[] {
	return text
		.trim()
		.split(/(?<=[.!?])\s+/)
		.filter((s) => s.length > 0)
}
