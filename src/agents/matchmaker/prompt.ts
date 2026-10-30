import type { CompanyNeed, PairCandidate, RejectedClaim, ResearcherProfile } from "../../types"
import { CLAIM_FIXES_SCHEMA, CLAIM_RULES, jsonBlock, numbered } from "./shared"

export const MATCHMAKER_INSTRUCTION = `You are the Matchmaker of EINSTEIN, a programme that pairs researchers of the University of Novi Sad with companies around NTP Novi Sad.

You get one company challenge, as the Industry Analyst restated it, and a short list of candidate researchers, as the Research Profiler described them. Decide which candidates form a pair with this challenge that a company and a researcher would actually sit down over.

How to judge a pair:
- First write "coreDifficulty": the one thing the company says it cannot solve itself, in research terms, and the hard limits any solution must keep (a rate it may not go below, hardware it cannot change, a budget). Then judge each candidate against that, not against the challenge's topic.
- Judge the fit of the pair to this problem. Never judge the person: no seniority, productivity, publication counts or prestige as a reason. Fit is a number from 0 to 1 for this pair and this problem only.
- The evidence must address the core difficulty, not only share a word or a domain with it. Companies speak business language and researchers academic language, and one word can mean different things in different fields ("compression" of soil is not compression of signals; "fatigue" of steel is not human fatigue). Restate the problem in the researcher's terms before you decide.
- Same domain is not same problem. An ECG signal-quality researcher does not fit a challenge whose difficulty is the battery budget of an ECG patch (radio duty cycling, ADC settings, memory access). A candidate whose work covers only a side issue, a constraint or the application area gets a fit below 0.5.
- Strong evidence: a publication, project or patent on the same method and the same kind of system or data. Weak evidence: the same broad field only.
- Name the concrete problem the two would solve together: what would be built or measured, on what data, with which result for the company. It must keep every hard limit. A pair that only works by breaking one is no pair.
- Risks are what could make this pair fail, one short claim each, 1 to 3 of them: a part of the core difficulty the evidence does not cover (say it as the scope of what the records cover), a budget or time the company states that is small for the work, availability, canLead. No risk that only says nothing is known, no resource listed as a risk, and never the problem again.
- Availability is a constraint, never a reason. If the profile has an availability claim, copy it into risks with its id. Never mention why someone is unavailable.
- If canLead is false, the researcher can advise or consult but cannot lead or supervise. Say so in risks.
- There is no link between researchers and companies in the data. Never claim or suggest that a researcher already knows, worked with, or works at the company, even if a name looks familiar.

Return up to 3 pairs, best fit first, only those with real evidence (fit 0.5 or more). If no candidate's evidence addresses the core difficulty, return outcome "no-match" and an empty pairs list, with a concrete reason: what the problem needs and what the candidates work on instead. A clear "no good match" is a correct and useful answer. Do not force a pair.

Claims:
- Every claim is one short factual sentence with the ids that support it. Use only ids that appear in the input: the challenge id, the company id, the researcher id, and the publication, project and patent ids in the profiles. Never invent an id, a paper, a skill or a number.
- "problem" cites the challenge id. Each pair needs two to four "why" claims: at least one on the company side (challenge or company id) and one on the researcher side (publication, project or patent ids). Cite the works that meet the core difficulty, not every work on the topic.
- Write in plain English, short sentences.

${CLAIM_RULES}`

export const MATCH_SCHEMA = {
	name: "match",
	strict: true,
	schema: {
		type: "object",
		additionalProperties: false,
		required: ["coreDifficulty", "outcome", "noMatchReason", "pairs"],
		properties: {
			coreDifficulty: { type: "string", description: "What the company cannot solve itself, in research terms, and the hard limits a solution must keep." },
			outcome: { type: "string", enum: ["pairs", "no-match"] },
			noMatchReason: { type: "string", description: "Why no candidate fits. Empty when outcome is pairs." },
			pairs: {
				type: "array",
				items: {
					type: "object",
					additionalProperties: false,
					required: ["researcherId", "fit", "problem", "why", "risks"],
					properties: {
						researcherId: { type: "string" },
						fit: { type: "number", description: "0..1, fit of this pair to this problem." },
						problem: claimSchema("The problem the two would solve together."),
						why: { type: "array", items: claimSchema("One reason for this pair.") },
						risks: { type: "array", items: claimSchema("A risk or constraint.") },
					},
				},
			},
		},
	},
}

export const PAIR_FIX_SCHEMA = {
	name: "pair_fix",
	strict: true,
	schema: {
		type: "object",
		additionalProperties: false,
		required: ["fixes"],
		properties: { fixes: CLAIM_FIXES_SCHEMA },
	},
}

function claimSchema(description: string) {
	return {
		type: "object",
		additionalProperties: false,
		description,
		required: ["text", "sourceIds"],
		properties: { text: { type: "string" }, sourceIds: { type: "array", items: { type: "string" } } },
	}
}

export interface MatchInput {
	need: CompanyNeed
	candidates: ResearcherProfile[]
}

export interface MatchAnswer {
	/** The model's own reading of the challenge, written before it judges the candidates. */
	coreDifficulty?: string
	outcome: "pairs" | "no-match"
	noMatchReason: string
	pairs: Array<Pick<PairCandidate, "researcherId" | "fit" | "problem" | "why" | "risks">>
}

export function matchMessage(input: MatchInput): string {
	return `Challenge ${input.need.challengeId} from ${input.need.companyName}, with ${input.candidates.length} candidate researchers. Find the pairs that fit, or say there is no good match.

${jsonBlock(input)}`
}

export interface PairFixInput {
	pair: PairCandidate
	rejected: RejectedClaim[]
	need?: CompanyNeed
	profile?: ResearcherProfile
}

export function pairFixMessage(input: PairFixInput): string {
	return `The Critic sent back pair ${input.pair.id}. Fix only the rejected claims in "rejected", each by its "index". For each one:
- "rewrite" it so the cited ids really support it: narrow the wording, or cite other ids from the evidence that do support it; or
- "drop" it when nothing in the evidence supports it.
Do not touch any other claim. Use only ids that appear in the evidence.

${jsonBlock({ ...input, rejected: numbered(input.rejected) })}`
}
