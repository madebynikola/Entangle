import type { InferenceInput } from "@mozaik-ai/core"
import { lastUserText } from "../../runtime"
import type { MatchAnswer, MatchInput, PairFixInput } from "./prompt"
import { termCoverage } from "./select"
import { readJsonBlock, type ClaimFix } from "./shared"

/**
 * Canned Matchmaker answers for mock runs, built from the input itself, so every id is real:
 * candidates whose evidence covers at least two search terms become pairs; the rest is "no-match".
 * Pair fixes drop every rejected claim.
 */
export function matchmakerResponder(input: InferenceInput): string | undefined {
	const schema = input.structuredOutput?.name
	if (schema === "match") {
		const data = readJsonBlock<MatchInput>(lastUserText(input))
		return data && JSON.stringify(mockMatch(data))
	}
	if (schema === "pair_fix") {
		const data = readJsonBlock<PairFixInput>(lastUserText(input))
		const fixes: ClaimFix[] = (data?.rejected ?? []).map((_, index) => ({ index, action: "drop", text: "", sourceIds: [] }))
		return data && JSON.stringify({ fixes })
	}
	return undefined
}

function mockMatch({ need, candidates }: MatchInput): MatchAnswer {
	const scored = candidates
		.map((profile) => ({ profile, score: termCoverage(need, profile) }))
		.filter(({ score }) => score >= 2)
		.sort((a, b) => b.score - a.score)
		.slice(0, 3)
	if (scored.length === 0) {
		return { outcome: "no-match", noMatchReason: `No candidate's evidence covers the core terms: ${need.searchTerms.slice(0, 3).join(", ")}.`, pairs: [] }
	}
	return {
		outcome: "pairs",
		noMatchReason: "",
		pairs: scored.map(({ profile, score }) => {
			const evidence = [...profile.expertise]
				.sort((a, b) => termCoverage({ ...need }, { ...profile, expertise: [b], industryFit: [] }) - termCoverage({ ...need }, { ...profile, expertise: [a], industryFit: [] }))
				.slice(0, 2)
			return {
				researcherId: profile.researcherId,
				fit: Math.min(0.95, 0.4 + score / 10),
				problem: { text: need.restatement.text, sourceIds: [need.challengeId] },
				why: [
					{ text: `${need.companyName} needs ${lowerFirst(need.restatement.text)}`, sourceIds: [need.challengeId] },
					...evidence.map((claim) => ({ text: `${profile.name}: ${lowerFirst(claim.text)}`, sourceIds: claim.sourceIds })),
				],
				risks: profile.availability ? [profile.availability] : [],
			}
		}),
	}
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1)
