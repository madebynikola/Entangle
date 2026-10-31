import { SemanticEvent, SituationSpecification, type SituationContext } from "@mozaik-ai/core"
import { sendEvent, state } from "../../runtime"
import type { ArtifactKind, ArtifactPosted, SentBack, Task, TaskKind } from "../../types"

/**
 * The review protocol between producers and the Critic. Every payload is small and carries a taskId,
 * because the trace writes custom events whole.
 *
 * Producer → Critic: `artifact.posted` (ArtifactPosted), after the artifact is written to MatchState.
 * Critic → all: `critic.reviewing` (one per reviewer), `critic.split`, `critic.verdict`, `critic.error`, `critic.stale`.
 * Critic → producer: `critic.sent_back` (SentBack) with a new task; after the last attempt `critic.dropped`,
 * or `critic.escalated` for a kind two reviewers check.
 */
export const ARTIFACT_POSTED = "artifact.posted"
export const CRITIC_REVIEWING = "critic.reviewing"
/** The two reviewers disagreed on at least one claim. Both must pass, so those claims count as rejected. */
export const CRITIC_SPLIT = "critic.split"
export const CRITIC_VERDICT = "critic.verdict"
export const CRITIC_SENT_BACK = "critic.sent_back"
export const CRITIC_DROPPED = "critic.dropped"
/** The fixes ran out, but the rejected claims were not core: the Critic cut them and accepted the rest. */
export const CRITIC_TRIMMED = "critic.trimmed"
/** The fixes ran out on a two-reviewer artifact. It stays on the blackboard and waits for a person. */
export const CRITIC_ESCALATED = "critic.escalated"
/** The Critic translated the Serbian lines of a cited record, once per run, to show beside the original in its reviews. */
export const CRITIC_TRANSLATED = "critic.translated"
export const CRITIC_ERROR = "critic.error"
export const CRITIC_STALE = "critic.stale"

/** The task kind a producer of each artifact runs, for the task the Critic sends back. */
export const PRODUCER_TASK: Record<ArtifactKind, TaskKind> = {
	profile: "profile",
	need: "analyze",
	pair: "match",
	proposal: "write",
}

/**
 * Tell the Critic (and the web app) that an artifact is on the blackboard.
 * Call it right after you write `state().profiles` / `needs` / `candidates` / `proposals`,
 * and again after each fix of a sent-back task.
 */
export function postArtifact(kind: ArtifactKind, id: string, producerId: string, taskId?: string): void {
	const payload: ArtifactPosted = { kind, id, taskId }
	sendEvent(SemanticEvent.create(ARTIFACT_POSTED, producerId, payload), producerId)
}

/** Matches `critic.sent_back` events addressed to this participant. Use it in a producer's handler. */
export class SentBackToMe extends SituationSpecification {
	isSatisfiedBy({ event, participant }: SituationContext): boolean {
		return event.type === CRITIC_SENT_BACK && (event.payload as SentBack).producerId === participant.getId()
	}
}

/** The task the Critic created for a send-back. Run it with runTask, then post the artifact again. */
export function sentBackTask(sentBack: SentBack): Task {
	const task = state().tasks.get(sentBack.taskId)
	if (!task) throw new Error(`Unknown sent-back task ${sentBack.taskId}`)
	return task
}

/** The part of a revise prompt that lists what the Critic rejected and why. */
export function describeRejections(sentBack: SentBack): string {
	const lines = sentBack.rejected.map(
		({ claim, reason }, i) => `index ${i}: "${claim.text}" [${claim.sourceIds.join(", ") || "no sources"}]\n   Rejected: ${reason}`,
	)
	return [
		`The Critic rejected ${sentBack.rejected.length} claim(s) of ${sentBack.kind} ${sentBack.id} ` +
			`(attempt ${sentBack.attempt} of ${sentBack.maxAttempts}; after that it is not sent back again).`,
		...lines,
		"Fix only these claims: cite a record that states the fact, narrow the claim to what the source says, or remove it. " +
			"Keep every other claim as it is. Never invent a source id. " +
			"Each fix gives the index shown here, not the claim's place in the artifact.",
	].join("\n")
}
