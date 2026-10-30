import type { Claim, CompanyNeed, PairCandidate, ResearcherProfile, SourceStore } from "../../types"
import type { ProposalDraft } from "./prompt"

export interface RenderContext {
	pair: PairCandidate
	need: CompanyNeed
	researcher: ResearcherProfile
	/** Adds source titles to the Sources list. */
	sources?: SourceStore
}

/** The facts the Writer states in every header, from the blackboard, not from the model. */
export function headerClaims({ need, researcher }: RenderContext): { company: Claim; researcher: Claim } {
	return {
		company: { text: `${need.companyName} works in ${need.sector.charAt(0).toLowerCase() + need.sector.slice(1)}.`, sourceIds: [need.companyId] },
		researcher: {
			text: `${researcher.name} is ${article(researcher.title)} ${researcher.title} in the ${researcher.department}, ${researcher.faculty}.`,
			sourceIds: [researcher.researcherId],
		},
	}
}

/** Every claim of a proposal, in the order the Critic reads them. */
export function draftClaims(draft: ProposalDraft, context: RenderContext): Claim[] {
	const header = headerClaims(context)
	return [header.company, header.researcher, ...draft.problem, ...(draft.priorWork ?? []), ...draft.companyBrings, ...draft.researcherBrings, ...draft.whyThisPair, ...context.pair.risks]
}

/** Markdown in the shape of docs/brief/example-industrial-phd-topic.md, every fact followed by its ids. */
export function renderProposal(draft: ProposalDraft, context: RenderContext): string {
	const { pair, need } = context
	const header = headerClaims(context)
	const phd = draft.kind === "industrial-phd"
	const lines: string[] = [
		`## ${draft.title}`,
		"",
		`**Company:** ${cite(header.company)} Challenge ${need.challengeId}.  `,
		`**Researcher:** ${cite(header.researcher)}  `,
		phd
			? `**Format:** industrial PhD, three years. The researcher is the academic supervisor; the company names an industrial supervisor and employs the candidate.`
			: `**Format:** joint project, one page.`,
		"",
		"### The problem",
		paragraph(draft.problem),
		"",
		...(draft.priorWork?.length ? ["### Prior work", ...draft.priorWork.map((claim) => `- ${cite(claim)}`), ""] : []),
		"### Research questions",
		...draft.researchQuestions.map((question, i) => `${i + 1}. ${question}`),
		"",
		"### Approach",
		...draft.approach.map((step) => `- ${step}`),
		"",
		"### Plan",
		"",
		`| ${phd ? "Year" : "Period"} | Work | Result |`,
		"| --- | --- | --- |",
		...draft.plan.map((row) => `| ${cell(row.period)} | ${cell(row.work)} | ${cell(row.result)} |`),
		"",
		"### First six months",
		...draft.firstSixMonths.map((step) => `- ${step}`),
		"",
		"### What each side brings",
		`- **Company:** ${paragraph(draft.companyBrings)}`,
		`- **Faculty:** ${paragraph(draft.researcherBrings)}`,
		"",
		"### Why this pair",
		...(draft.pairReasoning ? [draft.pairReasoning, ""] : []),
		...draft.whyThisPair.map((claim) => `- ${cite(claim)}`),
		"",
	]
	if (pair.risks.length) lines.push("### Risks and constraints", ...pair.risks.map((risk) => `- ${cite(risk)}`), "")
	lines.push("### Agreed up front (proposed)", ...draft.agreedUpFront.map((term) => `- ${term}`), "")
	lines.push("### Sources", ...sourceList(draftClaims(draft, context), context.sources), "")
	return lines.join("\n")
}

const cite = (claim: Claim) => `${claim.text.trim()} [${claim.sourceIds.join(", ")}]`
const paragraph = (claims: Claim[]) => claims.map(cite).join(" ")
const cell = (text: string) => text.replace(/\|/g, "/").replace(/\n+/g, " ")
const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a")

function sourceList(claims: Claim[], store?: SourceStore): string[] {
	const ids = [...new Set(claims.flatMap((claim) => claim.sourceIds))].sort()
	return ids.map((id) => {
		const record = store?.get(id)
		if (!record) return `- ${id}`
		const title = record.title.length > 120 ? `${record.title.slice(0, 117).trimEnd()}...` : record.title
		const dated = record.kind === "publication" || record.kind === "project" || record.kind === "patent" || record.kind === "work"
		return `- ${id}: ${title}${dated && record.year ? ` (${record.year})` : ""}${record.url ? ` ${record.url}` : ""}`
	})
}

/** Remove a cited id from free text, e.g. after the Critic found it is not in the dataset. */
export function scrubId(text: string, id: string): string {
	const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	return text
		.replace(new RegExp(`\\s*[\\[(]\\s*${escaped}\\s*[\\])]`, "g"), "")
		.replace(new RegExp(`\\b${escaped}\\b`, "g"), "")
		.replace(/\s{2,}/g, " ")
		.trim()
}
