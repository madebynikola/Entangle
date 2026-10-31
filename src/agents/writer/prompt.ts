import type { Claim, CompanyNeed, PairCandidate, ProposalKind, RejectedClaim, ResearcherProfile } from "../../types"
import { CLAIM_FIXES_SCHEMA, CLAIM_RULES, jsonBlock, numbered } from "../matchmaker/shared"

export const WRITER_INSTRUCTION = `You are the Proposal Writer of EINSTEIN, a programme that pairs researchers of the University of Novi Sad with companies around NTP Novi Sad.

You get one chosen pair: a company challenge, a researcher, and the Matchmaker's reasons. Write the proposal a company and a researcher would actually sit down over: an industrial PhD topic (three years, a candidate employed by the company) or a one-page joint project (6 to 12 months).

What makes it good:
- It is short. A joint project fits on one page (about 600 words), an industrial PhD on two (about 1,000 words). Say each fact once: a fact in the problem is not repeated under what each side brings.
- First write "brief": the core difficulty the company cannot solve itself, every hard limit in the need's constraints, and which two or three of the researcher's works meet the difficulty. The rest of the proposal follows from it.
- Keep every hard limit. No research question, method step or plan row may break a constraint the company states: if the sampling rate cannot drop below 250 Hz, do not test or propose lower rates. Aim at the target the company gives ("under one working day", "at least 35% less current").
- Aim at the core difficulty, not at a side issue or at the researcher's favourite topic next to it.
- The problem is concrete and has the company's own numbers: volumes, costs, error rates, deadlines. Say what happens today and why it hurts. Only the company's situation goes here, nothing about the researcher.
- Prior work: "priorWork" in the input lists recent published works found in OpenAlex for this challenge. If one reports a result on the core difficulty, state that result in a priorWork claim, so both sides see where the field stands. Use at most 2, and none when no work is about the core difficulty.
- Research questions are few (2 or 3) and each one can be answered with a measurement on named data ("measured against ...").
- The approach names methods from the researcher's own work and says how they meet the company's data. Pick the methods the problem needs; no menu of everything the researcher has done, and no generic "use AI". A survey the researcher wrote covers other people's methods: the researcher reviewed them, not invented them.
- The plan has a result per period: a dataset, a prototype, a paper, a trial, a decision. For an industrial PhD use Year 1, Year 2, Year 3. For a joint project use 3 or 4 month ranges.
- Who does the work, at what size. For an industrial PhD a candidate employed by the company does it, with the researcher and a company engineer as supervisors. For a joint project, propose who does the day-to-day work (a master's student or a postdoc of the researcher's group, the company's engineer for a stated share of time). If the company states a budget or someone's time, size the work to it: a few thousand euros pays for a 3- to 6-month project such as a master's thesis at the company, not a year of a research group.
- The first six months are 3 or 4 steps someone can start on Monday: what data moves where, what gets set up, what is measured first.
- What each side brings is specific and only what the plan uses: data, lab time, equipment, line access, salary; supervision, methods, lab, students. A company fact goes under the company, never under the researcher.
- Why this pair: the company's difficulty, the researcher's matching evidence, and why neither could do it alone. Say that last part as what each side brings that the other does not, never as what one side lacks.
- Agreed up front: 3 or 4 short terms on publication review, ownership of results and code, data access and preconditions. Write these as proposals for the two sides to agree on.
- Kind: an industrial PhD fits a problem that needs new methods over three years at a company that can employ a candidate. A joint project fits a result needed within a year, or a small budget.

Here is the shape and level of detail to aim for. Its partners are invented; copy the shape, never its facts:
"The problem: Every seed lot is graded by hand. A technician sorts a 500 g sample, which takes 40 minutes. In September the lab grades 300 lots a week, so trucks wait. Two technicians agree on a grade only 80% of the time.
Research question: Can images of a seed sample, taken on a conveyor, grade a lot as well as the lab does? Measured against three technicians' consensus on 2,000 historical lots.
Plan, year 1: an imaging rig in the company's lab; a labelled set of 20,000 seeds from 200 lots; baseline models. Result: a dataset paper; a working rig.
Why this pair: the company has a costly bottleneck with data already on hand. The faculty group has published on detecting defects from few examples, the core difficulty here. Neither could do it alone: the company brings the seeds, six seasons of grades and the line; the faculty brings the few-shot methods.
Agreed up front: results can be published after a 60-day review by the company. The company owns the rig and the trained models; the faculty keeps the methods."

Facts and sources:
- Every factual statement goes in a claim field (problem, priorWork, companyBrings, researcherBrings, whyThisPair) as one short sentence with the ids that support it. Use only ids from the input: the challenge and company ids, the researcher id, the publication, project and patent ids, and the work ids (W...) in priorWork. Never invent an id, a paper, a skill, a number or a piece of equipment.
- Claims are few and strong: problem 2 to 4, priorWork 0 to 2, companyBrings 2 to 4, researcherBrings 2 to 4 (the works the approach uses), whyThisPair 2 or 3. One sentence each, under 30 words.
- A priorWork claim cites one work id and states only what that work's abstract reports ("A 2022 study reports lossless ECG compression in real time on embedded hardware."). The work is by other people, outside this pair: never say the researcher or the company did it, never name its authors, and never cite a work id in another field.
- Free-text fields (title, research questions, approach, plan, first six months, pairReasoning, agreed up front) hold proposals and reasoning, not facts. They may only rely on facts that appear in a claim. Write no ids in free text.
- Free text may propose new work and new data ("label 2,000 seeds from 200 lots in year 1"). It may never present as existing any data, recordings, dataset size, history, equipment, staff, skill or past result that no claim states. If no claim says how much data the company has, give no number for it. If no claim says the patch has an accelerometer, it has none. Plan only on data a claim says the company has; if the work needs more (past scans, labelled cases), the first step collects it.
- Never say what a side lacks or cannot do ("the company has no signal-processing know-how", "the researcher has no access to real traffic") unless a claim states it. Say instead what each side brings.
- "english" in the input, when there is one, translates the Serbian lines of the cited records, by record id. The Critic checks claims against the same translation. When you say in English what a Serbian record says, use the translation's word for each thing ("skin damage", not a word of another meaning) and keep a term in brackets only as the input already quotes it.
- Describe the researcher's methods only as far as the claims do. Do not add features, steps or results the cited work does not state.
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
		required: ["brief", "kind", "title", "problem", "priorWork", "researchQuestions", "approach", "plan", "firstSixMonths", "companyBrings", "researcherBrings", "pairReasoning", "whyThisPair", "agreedUpFront"],
		properties: {
			brief: {
				type: "string",
				description: "Not shown. The core difficulty, every hard limit the company states, and the two or three works of the researcher that meet it.",
			},
			kind: { type: "string", enum: ["industrial-phd", "joint-project"] },
			title: { type: "string", description: "Specific: the method and the company's problem, under 15 words." },
			problem: claims("2 to 4 claims: the company's problem today, with its numbers. Nothing about the researcher."),
			priorWork: claims("0 to 2 claims: what a published work in priorWork reports on the core difficulty, each citing its one work id. Empty when none fits."),
			researchQuestions: texts("2 or 3 questions, each with how it is measured. None may break a hard limit."),
			approach: texts("3 or 4 method steps of one or two sentences, using the researcher's methods on the company's data."),
			plan: {
				type: "array",
				description: "Year 1-3 for an industrial PhD; 3 or 4 month ranges for a joint project. One or two sentences per cell.",
				items: {
					type: "object",
					additionalProperties: false,
					required: ["period", "work", "result"],
					properties: { period: { type: "string" }, work: { type: "string" }, result: { type: "string" } },
				},
			},
			firstSixMonths: texts("3 or 4 concrete first steps, who does each."),
			companyBrings: claims("2 to 4 claims: data, equipment, people, money the company has and the plan uses."),
			researcherBrings: claims("2 to 4 claims: the methods, results, lab and equipment of the researcher the plan uses."),
			pairReasoning: { type: "string", description: "2 or 3 sentences: why these two fit and why neither could do it alone. Reasoning only, no new facts, no ids." },
			whyThisPair: claims("2 or 3 claims: the facts the reasoning rests on, the company's difficulty and the researcher's matching work."),
			agreedUpFront: texts("3 or 4 proposed terms, one sentence each: publication, ownership, data access, preconditions."),
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
	/** The model's notes before it writes: core difficulty, hard limits, matching works. Not rendered. */
	brief?: string
	kind: ProposalKind
	title: string
	problem: Claim[]
	/** What published work outside the pair reports, each citing an OpenAlex work id. */
	priorWork: Claim[]
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

/** A published work as the Writer reads it: no authors, no citation count. */
export interface PriorWorkInput {
	id: string
	title: string
	year: number
	venue?: string
	abstract: string
}

export interface WriteInput {
	pair: PairCandidate
	need: CompanyNeed
	researcher: ResearcherProfile
	allowedKinds: ProposalKind[]
	/** Recent works from OpenAlex on the need's search terms. Absent when OpenAlex is off. */
	priorWork?: PriorWorkInput[]
	/** The run's English of the Serbian lines of the records the need, profile and pair cite, by record id. Absent when none has any. */
	english?: Record<string, string[]>
}

export function writeMessage(input: WriteInput): string {
	return `Write the proposal for pair ${input.pair.id}: ${input.need.companyName} (${input.need.challengeId}) and ${input.researcher.name} (${input.researcher.researcherId}).

${jsonBlock(input)}`
}

export interface ProposalFixInput {
	proposalId: string
	/** The claim fields of the current draft. */
	draft: Pick<ProposalDraft, "problem" | "priorWork" | "companyBrings" | "researcherBrings" | "whyThisPair">
	rejected: RejectedClaim[]
	evidence: { need?: CompanyNeed; researcher?: ResearcherProfile; pair?: PairCandidate; priorWork?: PriorWorkInput[]; english?: Record<string, string[]> }
}

export function proposalFixMessage(input: ProposalFixInput): string {
	return `The Critic sent back proposal ${input.proposalId}. Fix only the rejected items in "rejected", each by its "index". For each rejected claim:
- "rewrite" it so the cited ids really support it: narrow the wording, or cite other ids from the evidence that do support it; or
- "drop" it when nothing in the evidence supports it.
A claim rejected for an added judgement ("directly applicable to", "the core method the generator requires", "exactly this problem") keeps its fact and loses those words.
An item with check "free-text" is a sentence quoted from the free text (research questions, approach, plan, first steps, reasoning, terms). For it:
- "rewrite": give the sentence that takes the quote's place, with empty sourceIds. Make it a proposal ("collect", "measure", "set up") or reasoning that rests only on the claims, and keep every hard limit of the company; or
- "drop" it when the text reads fine without it.
Do not touch any other claim or sentence. Use only ids that appear in the evidence.

${jsonBlock({ ...input, rejected: numbered(input.rejected) })}`
}
