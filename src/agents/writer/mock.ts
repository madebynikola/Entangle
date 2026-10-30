import type { InferenceInput } from "@mozaik-ai/core"
import { lastUserText, type MockResponder } from "../../runtime"
import { readJsonBlock, type ClaimFix } from "../matchmaker/shared"
import type { ProposalDraft, ProposalFixInput, WriteInput } from "./prompt"

/**
 * Canned Writer answers for mock runs, built from the input, so every id is real.
 * With `plantFakeClaim`, the first draft gets one claim citing a patent that does not exist,
 * so a mock run shows the Critic sending a proposal back and the Writer fixing it.
 * Fixes drop every rejected claim.
 */
export function writerResponder(options: { plantFakeClaim?: boolean } = {}): MockResponder {
	let planted = !options.plantFakeClaim
	return (input: InferenceInput) => {
		const schema = input.structuredOutput?.name
		if (schema === "proposal") {
			const data = readJsonBlock<WriteInput>(lastUserText(input))
			if (!data) return undefined
			const draft = mockDraft(data)
			if (!planted) {
				planted = true
				draft.researcherBrings.push({ text: `${data.researcher.name} holds a granted patent on exactly this method.`, sourceIds: ["SYN-PAT-999"] })
			}
			return JSON.stringify(draft)
		}
		if (schema === "proposal_fix") {
			const data = readJsonBlock<ProposalFixInput>(lastUserText(input))
			const fixes: ClaimFix[] = (data?.rejected ?? []).map((_, index) => ({ index, action: "drop", text: "", sourceIds: [] }))
			return data && JSON.stringify({ fixes })
		}
		return undefined
	}
}

function mockDraft({ pair, need, researcher, allowedKinds }: WriteInput): ProposalDraft {
	const phd = allowedKinds[0] === "industrial-phd"
	const topic = need.searchTerms[0] ?? "the method"
	return {
		kind: allowedKinds[0],
		title: `${capitalize(topic)} for ${need.companyName}`,
		problem: [need.restatement, ...need.constraints.slice(0, 2)],
		researchQuestions: need.searchTerms.slice(0, 3).map((term) => `How far does ${term} close the gap on the company's own data? Measured against today's baseline.`),
		approach: [
			`Start from the researcher's published methods on ${topic}.`,
			"Build a baseline on the company's data and measure it.",
			"Adapt the method to the company's constraints and compare.",
		],
		plan: phd
			? [
					{ period: "1", work: "Data access, baseline, first adapted model", result: "A dataset description and a baseline report" },
					{ period: "2", work: "Method development and evaluation on company data", result: "A journal paper and a prototype" },
					{ period: "3", work: "Trial in the company's process", result: "The thesis and a decision on rollout" },
				]
			: [
					{ period: "Months 1–3", work: "Data access and baseline", result: "A baseline report" },
					{ period: "Months 4–9", work: "Adapted method and prototype", result: "A prototype and a test report" },
				],
		firstSixMonths: ["Sign the data agreement and move a first data sample.", "Reproduce today's baseline.", "Agree on the success measure."],
		companyBrings: need.assets,
		researcherBrings: [...researcher.expertise.slice(0, 2), ...researcher.industryFit.slice(0, 1)],
		pairReasoning: `${need.companyName} has the problem and the data; ${researcher.name} has published on the method. Neither could close the gap alone.`,
		whyThisPair: pair.why,
		agreedUpFront: ["Results can be published after a review by the company.", "The company owns the prototype; the faculty keeps the methods."],
	}
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
