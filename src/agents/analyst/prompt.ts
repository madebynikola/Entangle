import type { StructuredOutputFormat } from "@mozaik-ai/core"
import type { Dataset } from "../../data"
import type { ChallengeTriage, Claim, CompanyNeed, RejectedClaim } from "../../types"
import { CLAIM_FIXES_SCHEMA } from "../matchmaker/shared"
import { clip, dataBlock } from "../profiler/shared"

export const ANALYST_INSTRUCTION = `You are an Industry Analyst of EINSTEIN, a programme that pairs researchers of the University of Novi Sad with companies around NTP Novi Sad.

You get one company: its profile, its challenges, and its web pages (website, job ads, news, blog, events). Some of it is in Serbian, in Latin or Cyrillic script. For each challenge, write down what a researcher needs to know to judge whether they can help.

For each challenge:
- triage, with a one-sentence triageReason:
  - "research": an open technical or scientific question. Nobody can buy or configure the answer.
  - "engineering-service": a known solution must be built, integrated or configured (connect a system to an ERP, build a dashboard with standard methods). A student project or a consultancy may fit better than a research group.
  - "not-research": money, hiring, staffing, sales, legal or licensing work, certification paperwork, or management. Research cannot solve it.
- restatement: the problem in English, in the words a researcher would use: the phenomenon or method, the system, the data, the target. One to three sentences. Keep the company's numbers. Add no facts and propose no solution. Cite the challenge id.
- searchTerms: 5 to 10 short terms in English research vocabulary (methods, phenomena, materials, signal and data types), as they would appear in paper titles and keywords. No company, product or business words. An empty list for "not-research".
- assets: what the company brings: data (kind, size, period), lab or test equipment, a production line, people, money, access to customers or sites.
- constraints: limits a solution must respect: deadlines, regulation, hardware, cost, what failed before. Also where the company is heading, when it bears on the problem.

Claims (restatement, assets, constraints):
- One short sentence in English, with the ids of the records that state it. Use only ids from the input: the company id, its challenge ids and its page ids. Never invent an id, a number or a fact.
- Say what the record says, at the same scope and no more. Keep the company's own hedges: if it suspects a cause, write that it suspects it. Add no "must", "already", "severely" or "proven" that the text does not say.
- Add no consequence or offer the text does not state: not "available for field testing", not "this limits the budget".
- A job ad shows a role the company wants to fill, not the skills of its current staff.
- Translate Serbian. When you are not sure of an English term, add the original in brackets: "peach fruit fly (breskvina mušica)".
- Keep the names of products and standards as they are.
- No personal data: no employee names, no email addresses, and never a reason for anyone's leave or absence. Write "one of the two developers will be unavailable", not who or why.
- A person in the company text with the same name as a researcher is someone else. Never say that the company already works with the university unless a page says so.

Answer for every challenge in the input, in order.`

const CLAIM = {
	type: "object",
	additionalProperties: false,
	required: ["text", "sourceIds"],
	properties: { text: { type: "string" }, sourceIds: { type: "array", items: { type: "string" } } },
}

export const TRIAGES: ChallengeTriage[] = ["research", "engineering-service", "not-research"]

export const NEED_SCHEMA: StructuredOutputFormat = {
	name: "need_analysis",
	strict: true,
	schema: {
		type: "object",
		additionalProperties: false,
		required: ["needs"],
		properties: {
			needs: {
				type: "array",
				items: {
					type: "object",
					additionalProperties: false,
					required: ["challengeId", "triage", "triageReason", "restatement", "searchTerms", "assets", "constraints"],
					properties: {
						challengeId: { type: "string" },
						triage: { type: "string", enum: TRIAGES },
						triageReason: { type: "string" },
						restatement: CLAIM,
						searchTerms: { type: "array", items: { type: "string" } },
						assets: { type: "array", items: CLAIM },
						constraints: { type: "array", items: CLAIM },
					},
				},
			},
		},
	},
}

export const NEED_FIX_SCHEMA: StructuredOutputFormat = {
	name: "need_fix",
	strict: true,
	schema: {
		type: "object",
		additionalProperties: false,
		required: ["fixes"],
		properties: { fixes: CLAIM_FIXES_SCHEMA },
	},
}

/** One need as the model writes it. Identity fields (company, name, sector) come from the data, not the model. */
export interface NeedDraft {
	challengeId: string
	triage: ChallengeTriage
	triageReason: string
	restatement: Claim
	searchTerms: string[]
	assets: Claim[]
	constraints: Claim[]
}

export interface NeedAnswer {
	needs: NeedDraft[]
}

/** Chars of one page's text in the prompt. Pages run to 2,500 chars; the first part carries the facts. */
const PAGE_CHARS = 1400

/** What the Analyst reads for one company: about 5k tokens. Pages carry their shortest unique id. */
export function companyBundle(data: Dataset, companyId: string) {
	const c = data.companies.get(companyId)
	if (!c) throw new Error(`Unknown company ${companyId}`)
	return {
		company: {
			id: c.id,
			name: c.name,
			sector: c.sector,
			employees: c.employees,
			founded: c.founded,
			location: c.location,
			language: c.language,
			about: c.about,
			products: c.products,
			tech: c.tech,
			plans: c.plans,
			rdCapacity: c.rdCapacity,
			pastCollaborations: c.pastCollaborations,
		},
		challenges: c.challenges.map((id) => {
			const ch = data.challenges.get(id)!
			return { id: ch.id, text: ch.text, detail: ch.detail }
		}),
		pages: c.pages.map((id) => {
			const page = data.pages.get(id)!
			return { id: shortPageId(data, page.id), kind: page.kind, date: page.date, title: page.title, text: clip(page.text, PAGE_CHARS) }
		}),
	}
}

export type CompanyBundle = ReturnType<typeof companyBundle>

/** `C001/job/2024-02-05` when that prefix names one page, else the full id with the title. */
function shortPageId(data: Dataset, id: string): string {
	const prefix = id.split("/").slice(0, 3).join("/")
	return data.page(prefix)?.id === id ? prefix : id
}

export function analyzeMessage(bundle: CompanyBundle): string {
	const ids = bundle.challenges.map((ch) => ch.id).join(", ")
	return `Company ${bundle.company.id}, ${bundle.company.name} (${bundle.company.sector}). Write one need for each of its challenges: ${ids}.

${dataBlock(bundle)}`
}

export interface NeedFixInput {
	need: CompanyNeed
	rejected: RejectedClaim[]
	company: CompanyBundle
}

export function needFixMessage(input: NeedFixInput): string {
	return `The Critic sent back need ${input.need.challengeId}. Fix only the rejected claims, listed by index in "rejected". For each one:
- "rewrite" it so the cited ids really state it: narrow the wording, or cite the challenge, company profile or page that does state it; or
- "drop" it when nothing in the company's records states it.
Do not touch any other claim. Use only ids that appear in "company".

${dataBlock(input)}`
}
