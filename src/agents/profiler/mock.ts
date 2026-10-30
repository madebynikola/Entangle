import type { InferenceInput } from "@mozaik-ai/core"
import { lastUserText } from "../../runtime"
import type { Claim } from "../../types"
import { readJsonBlock, type ClaimFix } from "../matchmaker/shared"
import { PROFILE_FIX_SCHEMA, PROFILE_SCHEMA, type ProfileAnswer, type ProfileFixInput, type ResearcherBundle } from "./prompt"
import { firstSentence } from "./shared"

/**
 * Canned Profiler answers for mock runs, built from the input itself, so every id is real and every claim
 * repeats its source: the fields, the newest publication and project titles, what they are open to.
 * Profile fixes drop every rejected claim.
 */
export function profilerResponder(input: InferenceInput): string | undefined {
	const schema = input.structuredOutput?.name
	if (schema === PROFILE_SCHEMA.name) {
		const bundle = readJsonBlock<ResearcherBundle>(lastUserText(input))
		return bundle && JSON.stringify(mockProfile(bundle))
	}
	if (schema === PROFILE_FIX_SCHEMA.name) {
		const data = readJsonBlock<ProfileFixInput>(lastUserText(input))
		const fixes: ClaimFix[] = (data?.rejected ?? []).map((_, index) => ({ index, action: "drop", text: "", sourceIds: [] }))
		return data && JSON.stringify({ fixes })
	}
	return undefined
}

function mockProfile({ researcher: r, publications, projects, patents }: ResearcherBundle): ProfileAnswer {
	const expertise: Claim[] = [
		...(r.fields.length ? [{ text: `Works in ${r.fields.slice(0, 3).join(", ")}.`, sourceIds: [r.id] }] : []),
		...publications.slice(0, 4).map((p) => ({ text: `Works on ${lowerFirst(p.title)}.`, sourceIds: [p.id] })),
		...projects.slice(0, 2).map((p) => ({ text: `Project ${p.acronym ? `${p.acronym}, ` : ""}${lowerFirst(p.title)}.`, sourceIds: [p.id] })),
		...patents.slice(0, 1).map((p) => ({ text: `Patent: ${lowerFirst(p.title)}.`, sourceIds: [p.id] })),
	]
	const industryFit: Claim[] = [
		...r.openTo.slice(0, 2).map((item) => ({ text: `Open to ${lowerFirst(item).replace(/\.?$/, ".")}`, sourceIds: [r.id] })),
		...(r.industryExperience ? [{ text: firstSentence(r.industryExperience), sourceIds: [r.id] }] : []),
	]
	return { expertise, industryFit, availability: r.availability ? firstSentence(r.availability) : "" }
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1)
