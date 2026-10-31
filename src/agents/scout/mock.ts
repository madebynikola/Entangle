import type { InferenceInput } from "@mozaik-ai/core"
import { lastUserText, type MockResponder } from "../../runtime"
import { readJsonBlock } from "../matchmaker/shared"
import type { FundingAnswer, QueriesInput, ScoutInput } from "./prompt"

/** Canned Scout answers for mock runs: the need's first search terms as queries; the first two calls, with their keywords as the reason. */
export function scoutResponder(): MockResponder {
	return (input: InferenceInput) => {
		if (input.structuredOutput?.name === "funding_queries") {
			const data = readJsonBlock<QueriesInput>(lastUserText(input))
			return data && JSON.stringify({ queries: data.searchTerms.slice(0, 3), area: data.sector })
		}
		if (input.structuredOutput?.name !== "funding") return undefined
		const data = readJsonBlock<ScoutInput>(lastUserText(input))
		if (!data) return undefined
		const answer: FundingAnswer = {
			calls: data.calls.slice(0, 2).map((call) => ({
				callId: call.id,
				reason: `The call's keywords (${call.keywords.slice(0, 2).join(", ") || call.title}) cover part of the pair's problem.`,
				check: call.status === "forthcoming" ? `Check the topic text when the call opens on ${call.opens ?? "its opening date"}.` : "Check the consortium rules on the call page.",
			})),
			noneReason: data.calls.length ? "" : "The portal returned no call for this problem.",
			projects: data.projects.slice(0, 1).map((project) => ({ projectId: project.id, reason: `${project.acronym} works on a related problem.` })),
		}
		return JSON.stringify(answer)
	}
}
