/**
 * Deterministic clean-up of the raw records (docs/dataset.md, "Data quality"): label variants,
 * duplicate profiles, status flags, and personal reasons kept out of what agents read.
 */
import { fold, toLatin } from "./text"

/** Shadow profile id → main profile id. The shadows have no bio, no `open_to` and no projects. */
export const DUPLICATES: Record<string, string> = {
	R0139: "R0539",
	R0556: "R0976",
	R0614: "R0637",
	R0894: "R0929",
}

const FACULTY: Record<string, string> = {
	"fakultet tehnickih nauka": "Faculty of Technical Sciences",
	"prirodno-matematicki fakultet": "Faculty of Sciences",
	"poljoprivredni fakultet": "Faculty of Agriculture",
	"tehnoloski fakultet": "Faculty of Technology",
	"pravni fakultet": "Faculty of Law",
	"tehnicki fakultet „mihajlo pupin“ zrenjanin": 'Technical Faculty "Mihajlo Pupin" Zrenjanin',
	"medicinski fakultet": "Faculty of Medicine",
	"ekonomski fakultet u subotici": "Faculty of Economics in Subotica",
	"filozofski fakultet": "Faculty of Philosophy",
	"institut biosens": "BioSense Institute",
	"naucni institut za prehrambene tehnologije (fins)": "Institute of Food Technology (FINS)",
	"gradjevinski fakultet subotica": "Faculty of Civil Engineering Subotica",
}

const TITLE: Record<string, string> = {
	"redovni profesor": "Full Professor",
	"vanredni profesor": "Associate Professor",
	docent: "Assistant Professor",
	"naucni saradnik": "Research Associate",
	"visi naucni saradnik": "Senior Research Associate",
	"naucni savetnik": "Principal Research Fellow",
	"istrazivac saradnik": "Research Assistant",
	asistent: "Teaching Assistant",
	"student doktorskih studija": "PhD student",
}

const ROLE: Record<string, string> = { "work package lead": "work package leader" }

export function canonFaculty(name: string): string {
	return FACULTY[fold(name)] ?? name
}

export function canonTitle(title: string): string {
	return TITLE[fold(title)] ?? title
}

export function canonInstitution(name: string): string {
	const f = fold(name)
	return f.startsWith("univerzitet u novom sadu") || f.startsWith("university of novi sad") ? "University of Novi Sad" : name
}

export function canonProgramme(programme: string): string {
	return programme
		.replace(/ \(synthetic\)$/, "")
		.replace("Republic of the Republic of Serbia", "Republic of Serbia")
		.replace("Republic of the Serbia", "Republic of Serbia")
}

export function canonRole(role: string): string {
	return ROLE[role] ?? role
}

/** A researcher's id after duplicate merge. */
export function canonId(id: string): string {
	return DUPLICATES[id] ?? id
}

export type ResearcherStatus = "active" | "emeritus" | "departed"

export function researcherStatus(title: string, notes: string): ResearcherStatus {
	if (/emerit/i.test(title) || /^(retired since|emeritus status)/i.test(notes.trim())) return "emeritus"
	if (/\bleft the university\b/i.test(notes)) return "departed"
	return "active"
}

/**
 * Keep the availability fact, drop the personal reason: "on parental leave until September 2026" →
 * "on leave until September 2026"; "has two young children and does not travel" → "does not travel".
 * (docs/dataset.md, "Personal and sensitive data", point 2.)
 */
export function redactPersonal(text: string): string {
	return text
		.replace(/\b(?:maternity-related research|maternity|paternity|parental|family|sick|medical) leave\b/gi, "leave")
		.replace(/\b(?:has|have) (?:(?:one|two|three|four) )?(?:young |small )?(?:children|child|kids|a baby)(?: and)?\s*/gi, "")
		.replace(/\b(?:due to|for) (?:family|health|personal|medical) reasons\b/gi, "")
		.replace(/\s{2,}/g, " ")
}

/** Phrases that limit a person's time: leave, sabbatical, workload, soft capacity limits. */
const AVAILABILITY = new RegExp(
	[
		"\\bleave\\b",
		"(?:limited|reduced|restricted|constrained|little) (?:\\w+ )?(?:availability|capacity)",
		// "capacity for new large commitments is limited until mid-2026"
		"(?:capacity|availability) (?:for|to)\\b[^.;]*?\\b(?:is|are|remains?) (?:limited|moderate|reduced|constrained)",
		"(?:capacity|availability) for only\\b",
		"\\bno (?:spare |free )?(?:capacity|time)\\b",
		"\\blimits (?:his |her |their )?capacity",
		"\\bnear full (?:\\w+ )?capacity",
		"(?:full|heavy|high|substantial) (?:\\w+ )?(?:teaching|administrative) load",
		"(?:cannot|can't|unable to) (?:take on|commit)",
		"\\bnot (?:taking|able to take) on\\b",
		"\\bon sabbatical\\b|\\bsabbatical (?:leave|in|during|for)\\b",
		"not available|unavailable",
		"does not travel|left the university|retired|emeritus status",
		"available for consulting|consulting (?:engagements )?only",
		"limits (?:his|her|their) (?:external )?engagement",
	].join("|"),
	"i",
)

/** Something other than the researcher is short: a capability, data, equipment or a lab ("a capability not available at the faculty"). */
const NOT_THE_PERSON =
	/\b(?:not|un)available (?:at|through|from)\b|\botherwise unavailable\b|\bavailability of\b|\bcapabilit|\b(?:equipment|instruments?|instrumented|platform|kits?|extractor|test strip|booking)\b|\b(?:lab|laboratory|sequencing|in-house) capacity\b|\bfacility\b/i

/** "No planned sabbatical", "not currently on sabbatical", "no planned leave": nothing limits the person. */
const NEGATED = /\b(?:no|not|without)\s+(?:\w+\s+){0,3}(?:sabbatical|leave)\b/gi

function limitsPerson(sentence: string): boolean {
	return AVAILABILITY.test(sentence.replace(NEGATED, "")) && !NOT_THE_PERSON.test(sentence)
}

/** The sentences of (redacted) notes that limit availability, or null. */
export function availabilityOf(notes: string): string | null {
	const sentences = notes.split(/(?<=[.;])\s+/).filter(limitsPerson)
	return sentences.length ? sentences.join(" ").replace(/;$/, ".") : null
}

/** Name in Latin script for display and name checks (`Јелена Марковић` → `Jelena Marković`). */
export function latinName(name: string): string {
	return toLatin(name)
}
