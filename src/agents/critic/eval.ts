import { SituationSpecification, createAgent, createHuman, type SituationContext } from "@mozaik-ai/core"
import { join, state } from "../../runtime"
import type { Claim, RejectedClaim } from "../../types"
import { createCritic, type CriticOptions } from "./critic"
import { FakeSourceStore } from "./fake-store"
import { CRITIC_ERROR, CRITIC_VERDICT, postArtifact } from "./protocol"
import type { CriticLabels, ReviewedClaim } from "./score"

export interface LabelReview {
	claims: ReviewedClaim[]
	/** Each reviewer that ran, with its model. */
	reviewers: Array<{ name: string; model: string }>
	/** Of the critique tasks, at API prices. */
	costUsd: number
	ms: number
}

class CriticDone extends SituationSpecification {
	isSatisfiedBy({ event }: SituationContext): boolean {
		return event.type === CRITIC_VERDICT || event.type === CRITIC_ERROR
	}
}

/** Model checks; every other check is by code. */
const MODEL_CHECKS = new Set(["unsupported", "unchecked"])

/**
 * Run the Critic on the labelled claims, as it runs on proposals in a match: code checks, then the model check by
 * both reviewers. Each proposal goes on the blackboard with its claims and no text, so there is no free-text check,
 * and is posted once. Start the runtime first. Rejects when a review fails.
 */
export async function reviewLabels(labels: CriticLabels, options: Omit<CriticOptions, "store">): Promise<LabelReview> {
	const started = Date.now()
	const critic = createCritic({ store: new FakeSourceStore(Object.values(labels.records)), ...options })
	join(critic.agent)
	const writer = createAgent({ name: "labels", capabilities: ["inference"], instruction: "Posts labelled claims.", tools: [], handlers: [] })
	join(writer)

	// The same pair can come from two runs under one proposal id. Each needs its own place on the blackboard, or the
	// second overwrites the first before its review.
	const boardIds = labels.proposals.map(({ id, run }, i) => (labels.proposals.findIndex((p) => p.id === id) === i ? id : `${id}@${run}`))
	const pending = new Set(boardIds)
	const errors: string[] = []
	const done = new Promise<void>((resolve) => {
		join(
			createHuman({
				name: "labels-observer",
				capabilities: ["observer"],
				handlers: [
					{
						specification: new CriticDone(),
						processor: {
							apply: ({ event }) => {
								const { id, error } = event.payload as { id: string; error?: string }
								if (!pending.delete(id)) return
								if (event.type === CRITIC_ERROR) errors.push(`${id}: ${error}`)
								if (!pending.size) resolve()
							},
						},
					},
				],
			}),
		)
	})

	const s = state()
	const posted = labels.proposals.map((proposal, i) => {
		const id = boardIds[i]
		const claims: Claim[] = proposal.claims.map(({ text, sourceIds }) => ({ text, sourceIds }))
		s.proposals.set(id, { id, pairId: proposal.pairId, kind: "joint-project", title: proposal.id, markdown: "", claims, revision: 0 })
		postArtifact("proposal", id, writer.getId())
		return { id, proposal, claims }
	})
	await done
	if (errors.length) throw new Error(`The Critic failed: ${errors.join("; ")}`)

	const claims = posted.flatMap(({ id, proposal, claims }) => {
		const verdict = s.verdicts.find((v) => v.kind === "proposal" && v.proposalId === id)
		return proposal.claims.map((labelled, i): ReviewedClaim => {
			const rejected = verdict?.rejected.find((r) => r.claim === claims[i])
			const by = rejected ? rejectedBy(rejected, critic.agent.getManifest().name) : []
			return { ...labelled, proposalId: proposal.id, phase: proposal.phase, rejectedBy: by, reason: rejected?.reason }
		})
	})
	const tasks = [...s.tasks.values()].filter((task) => task.kind === "critique")
	const reviewers = [critic.agent, critic.second].flatMap((agent) => {
		const model = agent && tasks.find((task) => task.assignee === agent.getId())?.model
		return agent && model ? [{ name: agent.getManifest().name, model }] : []
	})
	return { claims, reviewers, costUsd: tasks.reduce((sum, task) => sum + task.costUsd, 0), ms: Date.now() - started }
}

function rejectedBy(rejected: RejectedClaim, primary: string): string[] {
	if (rejected.reviewers) return rejected.reviewers
	return [rejected.check && MODEL_CHECKS.has(rejected.check) ? primary : "code"]
}
