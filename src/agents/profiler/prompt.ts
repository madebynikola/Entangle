import type { StructuredOutputFormat } from "@mozaik-ai/core"
import type { Dataset } from "../../data"
import type { Claim, RejectedClaim, ResearcherProfile } from "../../types"
import { CLAIM_FIXES_SCHEMA } from "../matchmaker/shared"
import { clip, dataBlock } from "./shared"

export const PROFILER_INSTRUCTION = `You are a Research Profiler of EINSTEIN, a programme that pairs researchers of the University of Novi Sad with companies around NTP Novi Sad.

You get one researcher: their profile and the publications, projects and patents that the dataset links to them by id. Write a profile that a Matchmaker can use to judge whether they fit a company's technical problem.

- expertise: 4 to 8 claims. Each names a concrete method, system, material or topic and cites the records that show it (publication, project or patent ids). Prefer the specific over the broad: "lossless compression of ECG signals with linear prediction" beats "signal processing". One claim may group several records that show the same skill. The profile's own fields and keywords may back a claim; then cite the researcher id.
- industryFit: 0 to 4 claims on industry-facing facts: what they are open to (contract research, industrial PhD, consulting), industry experience, patents, applied projects with industrial partners. Cite the researcher id or the record.
- availability: one short sentence on timing only, when the input gives a limit ("On leave until September 2026." "Consulting only; does not lead projects."). Never the reason. A limit whose date is before today has ended: say so ("Was on leave until September 2024."). An empty string when there is no limit.

Rules:
- Use only what the records say, at the same scope and no more. Never invent a paper, method, skill, result, number or tie.
- Add no detail the record does not give: no tool, number, year, partner, domain or scale. Copy numbers exactly, or leave them out.
- A claim that cites several records says only what each of them says. Never merge a method from one paper with a system or result from another into one statement.
- What they are "open to" is not what they do: "open to supervising industrial PhDs", never "supervises industrial PhDs".
- Give the researcher's role as the record gives it: "co-authored" a paper with other authors, "led" a project only as principal investigator or coordinator, "took part in" for other project roles.
- Refer to the researcher by name or as "the researcher". Never write he, she, his or her: the data gives no one's gender.
- A record belongs to this researcher by its id link. A co-author with the same name is someone else. Never say that the researcher worked with a company or a person unless a record says so.
- "notes" are private remarks. Use them only as constraints (availability, what they will or will not do), never quote them, and never give a personal reason (family, health, the reason for a leave).
- Describe the work, never rate the person: no seniority, publication counts, prestige or "leading expert".
- If status is not "active", add an industryFit claim that they can advise but cannot lead a project or supervise. Cite the researcher id.
- Some text is in Serbian. Write every claim in English, one short sentence each.`

const CLAIM = {
	type: "object",
	additionalProperties: false,
	required: ["text", "sourceIds"],
	properties: { text: { type: "string" }, sourceIds: { type: "array", items: { type: "string" } } },
}

export const PROFILE_SCHEMA: StructuredOutputFormat = {
	name: "researcher_profile",
	strict: true,
	schema: {
		type: "object",
		additionalProperties: false,
		required: ["expertise", "industryFit", "availability"],
		properties: {
			expertise: { type: "array", items: CLAIM },
			industryFit: { type: "array", items: CLAIM },
			availability: { type: "string", description: "Timing only, never the reason. Empty when there is no limit." },
		},
	},
}

export const PROFILE_FIX_SCHEMA: StructuredOutputFormat = {
	name: "profile_fix",
	strict: true,
	schema: {
		type: "object",
		additionalProperties: false,
		required: ["fixes"],
		properties: { fixes: CLAIM_FIXES_SCHEMA },
	},
}

export interface ProfileAnswer {
	expertise: Claim[]
	industryFit: Claim[]
	availability: string
}

/** Chars of one abstract or summary in the prompt. A researcher with 23 papers stays near 8k tokens. */
const ABSTRACT_CHARS = 900
const SUMMARY_CHARS = 700

/** What the Profiler reads for one researcher: the profile and every linked record, newest first. */
export function researcherBundle(data: Dataset, researcherId: string) {
	const r = data.researcher(researcherId)
	if (!r) throw new Error(`Unknown researcher ${researcherId}`)
	const byYear = <T extends { year?: number }>(records: T[]) => records.sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
	return {
		researcher: {
			id: r.id,
			aliases: r.aliases,
			name: r.name,
			title: r.title,
			faculty: r.faculty,
			department: r.department,
			status: r.status,
			canLead: r.canLead,
			availability: r.availability,
			fields: r.fields,
			keywords: r.keywords,
			bio: r.bio,
			openTo: r.openTo,
			industryExperience: r.industryExperience,
			notes: r.notes,
		},
		publications: byYear(
			r.publications.map((id) => {
				const p = data.publications.get(id)!
				return { id: p.id, year: p.year, type: p.type, title: p.title, keywords: p.keywords, abstract: clip(p.abstract, ABSTRACT_CHARS) }
			}),
		),
		projects: r.projects
			.map((id) => data.projects.get(id)!)
			.sort((a, b) => b.years.localeCompare(a.years))
			.map((p) => {
				const role = p.participants.find((x) => x.researcherId === r.id)?.role ?? ""
				return { id: p.id, acronym: p.acronym, title: p.title, programme: p.programme, years: p.years, role, partners: p.partners, summary: clip(p.summary, SUMMARY_CHARS) }
			}),
		patents: byYear(
			r.patents.map((id) => {
				const p = data.patents.get(id)!
				return { id: p.id, title: p.title, year: p.year, status: p.status, abstract: clip(p.abstract, SUMMARY_CHARS) }
			}),
		),
	}
}

export type ResearcherBundle = ReturnType<typeof researcherBundle>

export function profileMessage(bundle: ResearcherBundle): string {
	const { id, name } = bundle.researcher
	return `Researcher ${id}, ${name}. Today is ${new Date().toISOString().slice(0, 10)}. Write their profile from these records.

${dataBlock(bundle)}`
}

export interface ProfileFixInput {
	profile: ResearcherProfile
	rejected: RejectedClaim[]
	records: ResearcherBundle
}

export function profileFixMessage(input: ProfileFixInput): string {
	return `The Critic sent back the profile of ${input.profile.researcherId}. Fix only the rejected claims, listed by index in "rejected". For each one:
- "rewrite" it so the cited ids really show it: narrow the wording, or cite the publication, project or patent in "records" that does show it; or
- "drop" it when nothing in the records shows it.
Do not touch any other claim. Use only ids that appear in "records". Never give a reason for limited availability.

${dataBlock(input)}`
}
