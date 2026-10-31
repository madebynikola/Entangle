import type { StructuredOutputFormat } from "@mozaik-ai/core"
import type { Dataset } from "../../data"
import type { ChallengeTriage, Claim, CompanyNeed, RejectedClaim } from "../../types"
import { CLAIM_FIXES_SCHEMA, numbered } from "../matchmaker/shared"
import type { Translations } from "../critic/translate"
import { clip, dataBlock } from "../profiler/shared"

export const ANALYST_INSTRUCTION = `You are an Industry Analyst of EINSTEIN, a programme that pairs researchers of the University of Novi Sad with companies around NTP Novi Sad.

You get one company: its profile, its challenges, and its web pages (website, job ads, news, blog, events). Some of it is in Serbian, in Latin or Cyrillic script. For each challenge, write down what a researcher needs to know to judge whether they can help.

For each challenge:
- triage, with a one-sentence triageReason:
  - "research": an open technical or scientific question. Nobody can buy or configure the answer.
  - "engineering-service": a known solution must be built, integrated or configured (connect a system to an ERP, build a dashboard with standard methods). A student project or a consultancy may fit better than a research group.
  - "not-research": money, hiring, staffing, sales, legal or licensing work, certification paperwork, or management. Research cannot solve it.
- restatement: the problem in English, in the words a researcher would use: the phenomenon or method, the system, the data, the target. One to three sentences. Keep the company's numbers as it states them. Add no facts and propose no solution. Cite the challenge id.
- searchTerms: 5 to 10 short terms in English research vocabulary (methods, phenomena, materials, signal and data types), as they would appear in paper titles and keywords. No company, product or business words. An empty list for "not-research".
- assets: what the company brings: data (kind, size, period), lab or test equipment, a production line, people, money, access to customers or sites.
- constraints: limits a solution must respect: deadlines, regulation, hardware, cost, what failed before. Also where the company is heading, when it bears on the problem.

Claims (restatement, assets, constraints):
- One short sentence in English, with the ids of the records that state it. Use only ids from the input: the company id, its challenge ids and its page ids. Never invent an id, a number or a fact.
- Say what the record says, at the same scope and no more. Keep the company's own hedges: if it suspects a cause, write that it suspects it. Add no "must", "already", "severely" or "proven" that the text does not say.
- Add no consequence or offer the text does not state: not "available for field testing", not "this limits the budget".
- A job ad shows a role the company wants to fill, not the skills of its current staff.
- Translate Serbian by the meaning in context: "ležaj" in a machine is a bearing, not a bed. A record with Serbian lines comes with "english": a translation of those lines, made apart from your task. The Critic checks your claims against the same translation, so take each Serbian term's meaning and English word from it. After each technical term you translate, add the original in brackets, copied word for word from the record (never from the translation), in the form the record writes it: "fruit fly larvae (larve voćne mušice)". Never write a Serbian word that is not in the record. The Critic checks that the bracketed words are in the cited record.
- Keep a number as the measure the record gives: "an error of about 5%" stays an error, never "95% accuracy".
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

/**
 * What the Analyst reads for one company: about 5k tokens. Pages carry their shortest unique id. With `translations`,
 * a record with Serbian lines carries "english", the run's translation of them; a page only of the lines it shows.
 */
export function companyBundle(data: Dataset, companyId: string, translations?: Translations) {
	const c = data.companies.get(companyId)
	if (!c) throw new Error(`Unknown company ${companyId}`)
	const english = (id: string, shown?: string) => {
		const lines = (translations?.get(id) ?? []).filter(({ serbian }) => shown === undefined || shown.includes(serbian.slice(0, 60)))
		return lines.length ? lines.map((line) => line.english) : undefined
	}
	return {
		company: {
			id: c.id,
			name: c.name,
			sector: c.sector,
			// A described problem (reverse search) has neither: leave them out rather than show 0.
			employees: c.employees || undefined,
			founded: c.founded || undefined,
			location: c.location,
			language: c.language,
			about: c.about,
			products: c.products,
			tech: c.tech,
			plans: c.plans,
			rdCapacity: c.rdCapacity,
			pastCollaborations: c.pastCollaborations,
			english: english(c.id),
		},
		challenges: c.challenges.map((id) => {
			const ch = data.challenges.get(id)!
			return { id: ch.id, text: ch.text, detail: ch.detail, english: english(ch.id) }
		}),
		pages: c.pages.map((id) => {
			const page = data.pages.get(id)!
			const text = clip(page.text, PAGE_CHARS)
			return { id: shortPageId(data, page.id), kind: page.kind, date: page.date, title: page.title, text, english: english(page.id, `${page.title}\n${text}`) }
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
	return `The Critic sent back need ${input.need.challengeId}. Fix only the rejected claims in "rejected", each by its "index". For each one:
- "rewrite" it so the cited ids really state it: narrow the wording, or cite the challenge, company profile or page that does state it; or
- "drop" it when nothing in the company's records states it.
Do not touch any other claim. Use only ids that appear in "company".

${dataBlock({ ...input, rejected: numbered(input.rejected) })}`
}
