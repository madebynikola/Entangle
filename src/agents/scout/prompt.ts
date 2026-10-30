import type { CompanyNeed, EuProject, FundingCall, PairCandidate, ResearcherProfile } from "../../types"
import { jsonBlock } from "../matchmaker/shared"

export const SCOUT_INSTRUCTION = `You are the Funding Scout of EINSTEIN, a programme that pairs researchers of the University of Novi Sad with companies around NTP Novi Sad.

For each chosen pair (a company challenge and a researcher) you do two jobs, each in its own request.

Job 1, queries: write 3 or 4 short search queries (2 to 4 words each) for the EU Funding & Tenders portal and for CORDIS, the EU's list of funded projects.
- EU calls describe their topics in broad policy words ("AI for cybersecurity applications", "digital tools for health care", "circular manufacturing processes"), not in a researcher's terms. Name the problem's domain and the kind of result the pair would make: a tool, a method, a pilot.
- Never put a person's or a company's name in a query.

Job 2, picks: you get a list of open or upcoming EU calls that the portal returned, and a list of EU-funded projects from CORDIS. Pick the calls the pair could apply to together, and the projects that already worked on the same problem.
- The portal's search matches words, not topics, so most calls in the list do not fit. A call fits only if its title and keywords cover the work the pair would do on this problem. Sharing the company's sector, one word or a neighbouring topic is not enough.
- Pick at most 3 calls, the best fit first. No call is a correct and useful answer. Then say in "noneReason" what the problem is about and what the calls are about instead.
- "reason" is one or two sentences: which part of the pair's problem the call's title and keywords cover. Use only the call's title, keywords, programme and action type as the input gives them, and the pair's problem.
- "check" is one short sentence: what the pair should check on the call page before they apply. Examples: whether the action type suits a small two-partner project, the date a forthcoming call opens, or what a cascade call (an EU project's open call for third parties) asks of applicants. Say it as something to check, never as a rule you know.
- Never state an eligibility rule, a budget, a date or a condition that the input does not give.
- If a reason needs a hedge ("may align", "could apply", "though its focus is"), the call or project does not fit: leave it out.
- Name no person. Never judge the researcher or compare people.
- "callId" is a call's "id" from the input, exactly as given.

Projects:
- A project fits if its title and summary show work on the same problem or the same method on the same kind of system. The pair can learn from it, build on its results, or ask its organisations to join a consortium.
- Pick at most 3, the closest first. None is a correct answer.
- "reason" is one sentence: what the project shares with the pair's problem, from its title and summary only.
- "projectId" is a project's "id" from the input, exactly as given.

Write in plain English, short sentences.`

export const FUNDING_SCHEMA = {
	name: "funding",
	strict: true,
	schema: {
		type: "object",
		additionalProperties: false,
		required: ["calls", "noneReason", "projects"],
		properties: {
			calls: {
				type: "array",
				description: "At most 3 calls that fit, the best fit first. Empty when none fits.",
				items: {
					type: "object",
					additionalProperties: false,
					required: ["callId", "reason", "check"],
					properties: {
						callId: { type: "string", description: "A call id from the input, e.g. CALL:HORIZON-CL4-2027-05-DIGITAL-EMERGING-03." },
						reason: { type: "string", description: "Which part of the pair's problem the call's title and keywords cover." },
						check: { type: "string", description: "What to check on the call page before applying." },
					},
				},
			},
			projects: {
				type: "array",
				description: "At most 3 projects on the same problem, the closest first. Empty when none is close.",
				items: {
					type: "object",
					additionalProperties: false,
					required: ["projectId", "reason"],
					properties: {
						projectId: { type: "string", description: "A project id from the input, e.g. CORDIS:101225653." },
						reason: { type: "string", description: "What the project shares with the pair's problem." },
					},
				},
			},
			noneReason: { type: "string", description: "Why no call fits, when calls is empty. Else empty." },
		},
	},
}

export const QUERIES_SCHEMA = {
	name: "funding_queries",
	strict: true,
	schema: {
		type: "object",
		additionalProperties: false,
		required: ["queries"],
		properties: {
			queries: { type: "array", items: { type: "string" }, description: "3 or 4 queries of 2 to 4 words in EU funding vocabulary." },
		},
	},
}

export interface QueriesInput {
	sector: string
	problem: string
	searchTerms: string[]
}

export function queriesMessage(input: QueriesInput): string {
	return `Job 1: write the search queries for this pair.\n\n${jsonBlock(input)}`
}

export interface FundingAnswer {
	calls: Array<{ callId: string; reason: string; check: string }>
	noneReason: string
	/** Absent in answers from before CORDIS. */
	projects?: Array<{ projectId: string; reason: string }>
}

/** What the Scout reads: the pair's problem, the need's limits, and the calls without their urls. */
export interface ScoutInput {
	pair: { id: string; problem: string }
	need: {
		challengeId: string
		companyName: string
		sector: string
		triage: CompanyNeed["triage"]
		restatement: string
		constraints: string[]
		assets: string[]
	}
	researcher: { faculty: string; department: string; canLead: boolean }
	calls: Array<Omit<FundingCall, "url" | "identifier">>
	projects: Array<Pick<EuProject, "id" | "acronym" | "title" | "summary" | "programme" | "status" | "start" | "end" | "organisations">>
}

export function scoutInput(pair: PairCandidate, need: CompanyNeed, researcher: ResearcherProfile, calls: FundingCall[], projects: EuProject[] = []): ScoutInput {
	return {
		pair: { id: pair.id, problem: pair.problem.text },
		need: {
			challengeId: need.challengeId,
			companyName: need.companyName,
			sector: need.sector,
			triage: need.triage,
			restatement: need.restatement.text,
			constraints: need.constraints.map((claim) => claim.text),
			assets: need.assets.map((claim) => claim.text),
		},
		researcher: { faculty: researcher.faculty, department: researcher.department, canLead: researcher.canLead },
		calls: calls.map(({ url: _url, identifier: _identifier, ...call }) => call),
		projects: projects.map(({ id, acronym, title, summary, programme, status, start, end, organisations }) => ({ id, acronym, title, summary, programme, status, start, end, organisations })),
	}
}

export function scoutMessage(input: ScoutInput): string {
	return `Job 2: pick the EU calls this pair could apply to together and the EU projects on the same problem, or say that none fits.\n\n${jsonBlock(input)}`
}
