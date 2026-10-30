import type { Claim, CompanyNeed, PairCandidate, ProposalKind, RejectedClaim, ResearcherProfile } from "../../types"
import { CLAIM_FIXES_SCHEMA, CLAIM_RULES, jsonBlock } from "../matchmaker/shared"

export const WRITER_INSTRUCTION = `You are the Proposal Writer of EINSTEIN, a programme that pairs researchers of the University of Novi Sad with companies around NTP Novi Sad.

You get one chosen pair: a company challenge, a researcher, and the Matchmaker's reasons. Write the proposal a company and a researcher would actually sit down over: an industrial PhD topic (three years, a candidate employed by the company) or a one-page joint project (6 to 12 months).

What makes it good:
- The problem is concrete and has the company's own numbers: volumes, costs, error rates, deadlines. Say what happens today and why it hurts.
- Research questions are few (2 or 3) and each one can be answered with a measurement on named data ("measured against ...").
- The approach names methods from the researcher's own work and says how they meet the company's data. No generic "use AI".
- The plan has a result per period: a dataset, a prototype, a paper, a trial, a decision. For an industrial PhD use Year 1, Year 2, Year 3. For a joint project use month ranges.
- The first six months are steps someone can start on Monday: what data moves where, what gets set up, what is measured first.
- What each side brings is specific: data, lab time, equipment, line access, salary; supervision, methods, lab, students.
- Why this pair: the company's difficulty, the researcher's matching evidence, and why neither could do it alone.
- Agreed up front: publication review, ownership of results and code, data access. Write these as proposals for the two sides to agree on.

Here is the shape and level of detail to aim for. Its partners are invented; copy the shape, never its facts:
"The problem: Every seed lot is graded by hand. A technician sorts a 500 g sample, which takes 40 minutes. In September the lab grades 300 lots a week, so trucks wait. Two technicians agree on a grade only 80% of the time.
Research question: Can images of a seed sample, taken on a conveyor, grade a lot as well as the lab does? Measured against three technicians' consensus on 2,000 historical lots.
Plan, year 1: an imaging rig in the company's lab; a labelled set of 20,000 seeds from 200 lots; baseline models. Result: a dataset paper; a working rig.
Why this pair: the company has a costly bottleneck with data already on hand. The faculty group has published on detecting defects from few examples, the core difficulty here. Neither could do it alone: the company has no ML staff, and the faculty has no seeds, labels or line.
Agreed up front: results can be published after a 60-day review by the company. The company owns the rig and the trained models; the faculty keeps the methods."

Facts and sources:
- Every factual statement goes in a claim field (problem, companyBrings, researcherBrings, whyThisPair) as one short sentence with the ids that support it. Use only ids from the input: the challenge and company ids, the researcher id, and the publication, project and patent ids in the input. Never invent an id, a paper, a skill, a number or a piece of equipment.
- Free-text fields (title, research questions, approach, plan, first six months, pairReasoning, agreed up front) hold proposals and reasoning, not facts. They may only rely on facts that appear in a claim. Write no ids in free text.
- "pairReasoning" is where your judgement goes: why these two fit, and why neither could do it alone. The "whyThisPair" claims under it are only the facts that judgement rests on.
- Never claim or suggest that the researcher already knows, worked with, or works at the company.
- Name no person except the researcher. Do not invent staff names, job titles of company people, or candidates.
- Never mention the Matchmaker's fit number, a rank, or how the researcher compares with others.
- Availability is a timing constraint only. Never mention why someone is unavailable (family, health, leave).
- If the work uses patient or clinical data, put ethics approval and data protection (GDPR and the Serbian personal data law) in "agreed up front" as preconditions.
- Choose "kind" from allowedKinds.

${CLAIM_RULES}

Write in plain English: short sentences, active voice, no hype.`

export const PROPOSAL_SCHEMA = {
	name: "proposal",
	strict: true,
	schema: {
		type: "object",
		additionalProperties: false,
		required: ["kind", "title", "problem", "researchQuestions", "approach", "plan", "firstSixMonths", "companyBrings", "researcherBrings", "pairReasoning", "whyThisPair", "agreedUpFront"],
		properties: {
			kind: { type: "string", enum: ["industrial-phd", "joint-project"] },
			title: { type: "string", description: "Specific: the method and the company's problem, under 15 words." },
			problem: claims("The problem today, with the company's numbers."),
			researchQuestions: texts("2 or 3 questions, each with how it is measured."),
			approach: texts("3 to 5 method steps, using the researcher's methods on the company's data."),
			plan: {
				type: "array",
				description: "Year 1-3 for an industrial PhD; month ranges for a joint project.",
				items: {
					type: "object",
					additionalProperties: false,
					required: ["period", "work", "result"],
					properties: { period: { type: "string" }, work: { type: "string" }, result: { type: "string" } },
				},
			},
			firstSixMonths: texts("3 to 5 concrete first steps."),
			companyBrings: claims("Data, equipment, people, money the company has."),
			researcherBrings: claims("Methods, results, lab and equipment the researcher has."),
			pairReasoning: { type: "string", description: "2 or 3 sentences: why these two fit and why neither could do it alone. Reasoning only, no new facts, no ids." },
			whyThisPair: claims("The facts the reasoning rests on: the company's difficulty and the researcher's matching work."),
			agreedUpFront: texts("Proposed terms: publication, ownership, data access, preconditions."),
		},
	},
}

export const PROPOSAL_FIX_SCHEMA = {
	name: "proposal_fix",
	strict: true,
	schema: {
		type: "object",
		additionalProperties: false,
		required: ["fixes"],
		properties: { fixes: CLAIM_FIXES_SCHEMA },
	},
}

function claims(description: string) {
	return {
		type: "array",
		description,
		items: {
			type: "object",
			additionalProperties: false,
			required: ["text", "sourceIds"],
			properties: { text: { type: "string" }, sourceIds: { type: "array", items: { type: "string" } } },
		},
	}
}

function texts(description: string) {
	return { type: "array", description, items: { type: "string" } }
}

/** The model's structured proposal. Code renders it to markdown, so claims and text never drift apart. */
export interface ProposalDraft {
	kind: ProposalKind
	title: string
	problem: Claim[]
	researchQuestions: string[]
	approach: string[]
	plan: Array<{ period: string; work: string; result: string }>
	firstSixMonths: string[]
	companyBrings: Claim[]
	researcherBrings: Claim[]
	pairReasoning: string
	whyThisPair: Claim[]
	agreedUpFront: string[]
}

export interface WriteInput {
	pair: PairCandidate
	need: CompanyNeed
	researcher: ResearcherProfile
	allowedKinds: ProposalKind[]
}

export function writeMessage(input: WriteInput): string {
	return `Write the proposal for pair ${input.pair.id}: ${input.need.companyName} (${input.need.challengeId}) and ${input.researcher.name} (${input.researcher.researcherId}).

${jsonBlock(input)}`
}

export interface ProposalFixInput {
	proposalId: string
	/** The claim fields of the current draft. */
	draft: Pick<ProposalDraft, "problem" | "companyBrings" | "researcherBrings" | "whyThisPair">
	rejected: RejectedClaim[]
	evidence: { need?: CompanyNeed; researcher?: ResearcherProfile; pair?: PairCandidate }
}

export function proposalFixMessage(input: ProposalFixInput): string {
	return `The Critic sent back proposal ${input.proposalId}. Fix only the rejected claims, listed by index in "rejected". For each one:
- "rewrite" it so the cited ids really support it: narrow the wording, or cite other ids from the evidence that do support it; or
- "drop" it when nothing in the evidence supports it.
Do not touch any other claim. Use only ids that appear in the evidence.

${jsonBlock(input)}`
}
