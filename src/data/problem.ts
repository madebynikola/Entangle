import type { Dataset } from "./dataset"
import type { RawCompany } from "./raw"

/**
 * Reverse search: a company describes one problem in its own words, and the system finds researchers for it.
 *
 * The text becomes a company record with one challenge, under ids the dataset does not use (`C999`, `C999-CH1`).
 * The rest of the run is the normal one: an Analyst reads it, the shortlist and Profilers find and read
 * researchers, the Matchmaker pairs them, a Writer writes the proposal, and the Critic checks every claim against
 * the described text as it checks any challenge. Nothing is invented around the text: the record has no
 * employees, founding year, products or pages, only what the person wrote.
 */
export const PROBLEM_COMPANY_ID = "C999"
export const PROBLEM_CHALLENGE_ID = `${PROBLEM_COMPANY_ID}-CH1`

/** Shorter than this is a topic, not a problem: the Analyst needs what is wrong, what was tried, what there is. */
export const PROBLEM_MIN_CHARS = 40
export const PROBLEM_MAX_CHARS = 6000

export interface ProblemInput {
	/** The problem, as the company would write it in a challenge form. */
	text: string
	/** Who describes it. Default "Described problem". */
	company?: string
	/** The company's sector, if they gave one. It steers the Funding Scout's search. */
	sector?: string
}

export interface DescribedProblem {
	companyId: string
	challengeId: string
	company: string
	sector?: string
	text: string
}

/** Why `text` cannot be a problem, or null when it can. */
export function problemError(text: string): string | null {
	const trimmed = text.trim()
	if (trimmed.length < PROBLEM_MIN_CHARS) return `Describe the problem in at least ${PROBLEM_MIN_CHARS} characters: what is wrong, what you tried, what you have.`
	if (trimmed.length > PROBLEM_MAX_CHARS) return `Keep the problem under ${PROBLEM_MAX_CHARS} characters.`
	return null
}

/** The company record for a described problem: its first sentence is the challenge, the rest its detail. */
export function problemCompany(input: ProblemInput): RawCompany {
	const error = problemError(input.text)
	if (error) throw new Error(error)
	const text = input.text.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim()
	const [title, detail] = splitTitle(text)
	return {
		id: PROBLEM_COMPANY_ID,
		name: input.company?.trim() || "Described problem",
		sector: input.sector?.trim() ?? "",
		employees: 0,
		founded: 0,
		location: "",
		about: "This problem was described in the reverse search. Only its text is known: no company profile, products or pages.",
		products: [],
		tech: [],
		challenges: [{ id: PROBLEM_CHALLENGE_ID, text: title, detail }],
		plans: "",
		rd_capacity: "",
		past_collaborations: "",
		language: /[čćšđž]|\b(nam|naš|imamo|treba|problem sa)\b/i.test(text) ? "sr" : "en",
	}
}

/** Add the described problem to the loaded dataset, so every agent and the Critic can read and cite it. */
export function addProblem(data: Dataset, input: ProblemInput): DescribedProblem {
	const company = data.addCompany(problemCompany(input))
	return { companyId: company.id, challengeId: company.challenges[0], company: company.name, sector: company.sector || undefined, text: input.text.trim() }
}

/** The first sentence, up to 220 characters, as the challenge line; the rest stays word for word as its detail. */
function splitTitle(text: string): [string, string] {
	const end = text.search(/[.!?](\s|$)|\n/)
	const cut = end > 0 && end < 220 ? end + 1 : -1
	if (cut > 0) return [text.slice(0, cut).trim(), text.slice(cut).trim()]
	if (text.length <= 220) return [text, ""]
	const space = text.lastIndexOf(" ", 200)
	const at = space > 80 ? space : 200
	return [`${text.slice(0, at).trim()}…`, text.slice(at).trim()]
}
