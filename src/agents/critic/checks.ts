import type { MatchState } from "../../runtime"
import type {
	ArtifactKind,
	Claim,
	CompanyNeed,
	PairCandidate,
	Proposal,
	RejectedClaim,
	ResearcherProfile,
	SourceRecord,
	SourceStore,
} from "../../types"
import { IDS_IN_TEXT, fold, idsIn, sameName } from "./text"

export type Artifact = ResearcherProfile | CompanyNeed | PairCandidate | Proposal

/** Who an artifact is about. Every record a claim cites must belong to one of them. */
export interface Subject {
	/** Canonical researcher id (an alias resolves to its main profile). */
	researcherId?: string
	companyId?: string
	challengeId?: string
	/** One line for the review prompt. */
	line: string
}

/** The result of the code checks: what goes on to the model check, and what is already rejected. */
export interface CodeCheck {
	subject: Subject
	/** Claims that passed every code check. */
	passed: Claim[]
	rejected: RejectedClaim[]
	/** Every record the passed claims cite, keyed by the id as cited. */
	sources: Map<string, SourceRecord>
}

const MAPS = {
	profile: "profiles",
	need: "needs",
	pair: "candidates",
	proposal: "proposals",
} as const satisfies Record<ArtifactKind, keyof MatchState>

export function readArtifact(s: MatchState, kind: ArtifactKind, id: string): Artifact | undefined {
	return (s[MAPS[kind]] as Map<string, Artifact>).get(id)
}

export function removeArtifact(s: MatchState, kind: ArtifactKind, id: string): void {
	s[MAPS[kind]].delete(id)
}

/** Every claim of an artifact, in a fixed order. */
export function claimsOf(kind: ArtifactKind, artifact: Artifact): Claim[] {
	switch (kind) {
		case "profile": {
			const p = artifact as ResearcherProfile
			return [...(p.expertise ?? []), ...(p.industryFit ?? []), ...(p.availability ? [p.availability] : [])]
		}
		case "need": {
			const n = artifact as CompanyNeed
			return [...(n.restatement ? [n.restatement] : []), ...(n.assets ?? []), ...(n.constraints ?? [])]
		}
		case "pair": {
			const p = artifact as PairCandidate
			return [...(p.why ?? []), ...(p.problem ? [p.problem] : []), ...(p.risks ?? [])]
		}
		case "proposal":
			return (artifact as Proposal).claims ?? []
	}
}

/**
 * Cut rejected claims out of an artifact on the blackboard, when what is left still does its job: a need keeps its
 * restatement, a profile its availability and one expertise claim, a pair its problem and one reason, a proposal its
 * header and one claim each under "The problem" and "Why this pair". False, with nothing changed, when a core claim
 * is rejected, or a reject is not one of the artifact's claims (its own ids, a free-text sentence).
 */
export function trimArtifact(s: MatchState, kind: ArtifactKind, id: string, artifact: Artifact, rejected: RejectedClaim[]): boolean {
	const own = claimsOf(kind, artifact)
	const cut = new Set<Claim>()
	for (const { claim } of rejected) {
		const found = own.find((c) => c === claim) ?? own.find((c) => c.text === claim.text && c.sourceIds.join() === claim.sourceIds.join())
		if (!found) return false
		cut.add(found)
	}
	const keep = (claims: Claim[] = []) => claims.filter((claim) => !cut.has(claim))
	const map = s[MAPS[kind]] as Map<string, Artifact>
	switch (kind) {
		case "proposal": {
			const p = artifact as Proposal
			const markdown = trimMarkdown(p, cut)
			if (markdown === undefined) return false
			map.set(id, { ...p, claims: keep(p.claims), markdown })
			return true
		}
		case "need": {
			const n = artifact as CompanyNeed
			if (n.restatement && cut.has(n.restatement)) return false
			map.set(id, { ...n, assets: keep(n.assets), constraints: keep(n.constraints) })
			return true
		}
		case "profile": {
			const p = artifact as ResearcherProfile
			const expertise = keep(p.expertise)
			if ((p.availability && cut.has(p.availability)) || !expertise.length) return false
			map.set(id, { ...p, expertise, industryFit: keep(p.industryFit) })
			return true
		}
		case "pair": {
			const p = artifact as PairCandidate
			const why = keep(p.why)
			if ((p.problem && cut.has(p.problem)) || !why.length) return false
			map.set(id, { ...p, why, risks: keep(p.risks) })
			return true
		}
	}
}

/**
 * A proposal's Markdown without the cut claims, or undefined when one is core: in the header, or the last claim under
 * "The problem" or "Why this pair". A list item or "**Company:**" line left empty goes.
 */
function trimMarkdown(p: Proposal, cut: Set<Claim>): string | undefined {
	const rendered = (claim: Claim) => `${claim.text.trim()} [${claim.sourceIds.join(", ")}]`
	const sections = (p.markdown ?? "").split(/(?=^### )/m)
	for (const claim of cut) {
		const at = sections.findIndex((section) => section.includes(rendered(claim)))
		if (at <= 0) return undefined
		if (/^### (The problem|Why this pair)/.test(sections[at])) {
			const left = (p.claims ?? []).filter((c) => !cut.has(c) && sections[at].includes(rendered(c)))
			if (!left.length) return undefined
		}
		sections[at] = sections[at]
			.split(rendered(claim))
			.join("")
			.replace(/(\S) {2,}(?=\S)/g, "$1 ")
			// One trailing space is what the cut left; two are a Markdown line break and stay.
			.replace(/(\S) $/gm, "$1")
			.replace(/^(- \*\*(Company|Faculty):\*\*|-)[ \t]*\n/gm, "")
	}
	return sections.join("").replace(/\n{3,}/g, "\n\n")
}

/** A proposal's Markdown without its Sources list: what the free-text check reads. */
export function proposalText(proposal: Proposal): string {
	const markdown = proposal.markdown ?? ""
	const end = markdown.indexOf("\n### Sources")
	return (end >= 0 ? markdown.slice(0, end) : markdown).trim()
}

/** A proposal's text for the free-text check: each rendered claim shows as `⟨claim N⟩`, numbered as in `claims`. */
export function maskedText(proposal: Proposal): string {
	let text = proposalText(proposal)
	;(proposal.claims ?? []).forEach((claim, i) => {
		text = text.split(`${claim.text.trim()} [${claim.sourceIds.join(", ")}]`).join(`⟨claim ${i + 1}⟩`)
	})
	return text
}

/**
 * A proposal's free-text sentences, with the claims, Markdown marks and table bars cut out, so a fix to a claim
 * changes none of them. Lines of fewer than four words (headings, labels) are left out.
 */
export function freeSentences(proposal: Proposal): string[] {
	return maskedText(proposal)
		.split(/\n+/)
		.flatMap((line) => line.replace(/^\s*(#+|[-*]|\d+\.)\s+/, "").split(/\s*\|\s*|(?<=[.!?])\s+(?=[A-Z"“(])/))
		.map((sentence) => sentence.replace(/⟨claim \d+⟩|\*\*/g, "").replace(/\s+/g, " ").trim())
		.filter((sentence) => sentence.split(" ").length >= 4)
}

/** Whether a quoted sentence is (part of) this sentence, ignoring case, spaces, quote marks and claim markers. */
export function quotes(quote: string, sentence: string): boolean {
	const plain = (text: string) => text.replace(/⟨claim \d+⟩|["“”'‘’*]/g, "").replace(/\s+/g, " ").trim().toLowerCase()
	const [q, s] = [plain(quote), plain(sentence)]
	return q.length > 0 && (s.includes(q.slice(0, 60)) || q.includes(s.slice(0, 60)))
}

/**
 * The checks that need no model: the artifact's own ids exist and fit its names,
 * every claim cites at least one source, every cited id exists, every cited record
 * belongs to the artifact's researcher or company (ids only, never names), no
 * claim takes a name or number from a record of the artifact that it does not cite, and every original a claim
 * quotes (a Serbian term in brackets) is in its records.
 */
export function checkByCode(kind: ArtifactKind, artifact: Artifact, s: MatchState, store: SourceStore): CodeCheck {
	const rejected: RejectedClaim[] = []
	const subject = subjectOf(kind, artifact, s, store, rejected)
	const passed: Claim[] = []
	const sources = new Map<string, SourceRecord>()
	const claims = claimsOf(kind, artifact)
	const uncitedIn = uncitedLookup(store, [
		...claims.flatMap((claim) => claim.sourceIds ?? []),
		...[subject.researcherId, subject.companyId, subject.challengeId].filter((id) => id !== undefined),
	])
	const names = new Set(
		[subject.researcherId, subject.companyId].flatMap((id) => (id ? wordsOf(store.get(id)?.title ?? "") : [])),
	)

	for (const claim of claims) {
		const ids = claim.sourceIds ?? []
		if (!ids.length) {
			rejected.push({ claim, reason: "The claim cites no source.", check: "no-source" })
			continue
		}
		const unknown = ids.filter((id) => !store.has(id))
		if (unknown.length) {
			rejected.push({
				claim,
				reason: `${unknown.join(", ")} ${unknown.length > 1 ? "are" : "is"} not in the dataset.`,
				check: "unknown-source",
			})
			continue
		}
		const records = ids.map((id) => [id, store.get(id)!] as const)
		const foreign = records.filter(([, record]) => !belongs(record, subject))
		if (foreign.length) {
			rejected.push({
				claim,
				reason: foreign.map(([id, record]) => `${id} ${owner(record)}, not to ${subject.line}.`).join(" "),
				check: "wrong-subject",
			})
			continue
		}
		const uncited = uncitedIn(claim, names)
		if (uncited.length) {
			const details = uncited.map(({ detail }) => `"${detail}"`)
			const holders = [...new Set(uncited.flatMap(({ ids }) => ids))]
			const be = details.length > 1 ? "are" : "is"
			rejected.push({
				claim,
				reason: `${list(details, "and")} ${be} not in ${list(ids, "or")} but ${be} in ${list(holders, "and")}, which the claim does not cite.`,
				check: "uncited-detail",
			})
			continue
		}
		const misquoted = misquotes(claim.text, records.map(([, record]) => record))
		if (misquoted.length) {
			const be = misquoted.length > 1 ? "are" : "is"
			rejected.push({
				claim,
				reason: `${list(misquoted.map((quote) => `"${quote}"`), "and")} ${be} not in ${list(ids, "or")}. Quote the original word for word as the record writes it, or leave it out.`,
				check: "misquote",
			})
			continue
		}
		passed.push(claim)
		for (const [id, record] of records) sources.set(id, record)
	}

	if (kind === "proposal") {
		const cited = new Set(claims.flatMap((claim) => claim.sourceIds ?? []))
		for (const id of idsIn((artifact as Proposal).markdown ?? "")) {
			if (cited.has(id) || store.has(id)) continue
			rejected.push({
				claim: { text: `The proposal text cites ${id}.`, sourceIds: [id] },
				reason: `${id} is not in the dataset.`,
				check: "unknown-source",
			})
		}
	}

	return { subject, passed, rejected, sources }
}

function subjectOf(
	kind: ArtifactKind,
	artifact: Artifact,
	s: MatchState,
	store: SourceStore,
	rejected: RejectedClaim[],
): Subject {
	const reject = (id: string, text: string, reason: string, check: "unknown-source" | "name-mismatch") =>
		rejected.push({ claim: { text, sourceIds: [id] }, reason, check })

	const researcher = (id: string, name?: string): string | undefined => {
		const record = store.get(id)
		if (record?.kind !== "researcher") {
			reject(id, `${name ?? "The researcher"} is ${id}.`, `${id} is not a researcher in the dataset.`, "unknown-source")
			return undefined
		}
		if (name !== undefined && !sameName(name, record.title)) {
			reject(id, `${name} is ${id}.`, `${id} is ${record.title}, not ${name}.`, "name-mismatch")
		}
		return record.id
	}
	const company = (challengeId: string, companyId: string, name?: string): void => {
		const challenge = store.get(challengeId)
		if (challenge?.kind !== "challenge" || challenge.companyId !== companyId) {
			reject(challengeId, `${challengeId} is a challenge of ${companyId}.`, `${challengeId} is not a challenge of ${companyId} in the dataset.`, "unknown-source")
		}
		const record = store.get(companyId)
		if (record?.kind !== "company") {
			reject(companyId, `${name ?? "The company"} is ${companyId}.`, `${companyId} is not a company in the dataset.`, "unknown-source")
		} else if (name !== undefined && !sameName(name, record.title)) {
			reject(companyId, `${name} is ${companyId}.`, `${companyId} is ${record.title}, not ${name}.`, "name-mismatch")
		}
	}
	const label = (id: string | undefined, fallback: string) => (id ? `${store.get(id)?.title ?? fallback} (${id})` : fallback)

	switch (kind) {
		case "profile": {
			const p = artifact as ResearcherProfile
			const researcherId = researcher(p.researcherId, p.name)
			const canLead = p.canLead === false ? "; cannot lead or supervise" : ""
			return { researcherId, line: `researcher ${label(researcherId, p.researcherId)}${canLead}` }
		}
		case "need": {
			const n = artifact as CompanyNeed
			company(n.challengeId, n.companyId, n.companyName)
			return {
				companyId: n.companyId,
				challengeId: n.challengeId,
				line: `company ${label(n.companyId, n.companyId)}, challenge ${n.challengeId}`,
			}
		}
		case "pair":
		case "proposal": {
			const pair =
				kind === "pair" ? (artifact as PairCandidate) : pairOf((artifact as Proposal).pairId, s)
			if (!pair) {
				const pairId = (artifact as Proposal).pairId
				reject(pairId, `The proposal is for pair ${pairId}.`, `Pair ${pairId} is not on the blackboard.`, "unknown-source")
				return { line: `pair ${pairId}` }
			}
			const researcherId = researcher(pair.researcherId)
			company(pair.challengeId, pair.companyId)
			const profile = researcherId ? (s.profiles.get(researcherId) ?? s.profiles.get(pair.researcherId)) : undefined
			const canLead = profile?.canLead === false ? "; cannot lead or supervise" : ""
			return {
				researcherId,
				companyId: pair.companyId,
				challengeId: pair.challengeId,
				line: `researcher ${label(researcherId, pair.researcherId)}${canLead} and company ${label(pair.companyId, pair.companyId)}, challenge ${pair.challengeId}`,
			}
		}
	}
}

/** The pair a proposal is for: from the blackboard, or from its id (`${challengeId}:${researcherId}`). */
function pairOf(pairId: string, s: MatchState): Pick<PairCandidate, "researcherId" | "companyId" | "challengeId"> | undefined {
	const pair = s.candidates.get(pairId)
	if (pair) return pair
	const [challengeId, researcherId] = pairId?.split(":") ?? []
	if (!challengeId || !researcherId) return undefined
	return { challengeId, researcherId, companyId: challengeId.split("-")[0] }
}

function belongs(record: SourceRecord, subject: Subject): boolean {
	switch (record.kind) {
		case "researcher":
			return record.id === subject.researcherId
		case "publication":
		case "project":
		case "patent":
			return subject.researcherId !== undefined && record.researcherIds.includes(subject.researcherId)
		case "company":
			return record.id === subject.companyId
		case "challenge":
		case "page":
			return subject.companyId !== undefined && record.companyId === subject.companyId
		// Published work outside the pair: any artifact may cite it. The model check reads what it reports.
		case "work":
			return true
		default:
			return false
	}
}

function owner(record: SourceRecord): string {
	switch (record.kind) {
		case "researcher":
			return `is researcher ${record.title} (${record.id})`
		case "publication":
		case "project":
		case "patent":
			return `is a ${record.kind} of ${record.researcherIds.join(", ") || "no dataset researcher"}`
		default:
			return `belongs to company ${record.companyId ?? record.id}`
	}
}

/** A word or a number as written: "nRF52840", "KL", "72", "7,400". */
const TOKEN = /\p{N}+(?:[.,]\p{N}+)*|[\p{L}\p{N}]+/gu
/** A clause with one of these says what is missing ("BACnet/IP does not appear in the works"): its names need not be in a record. */
const NEGATION = /\b(?:not|no|none|neither|nor|never|without|cannot|lacks?|lacking)\b|n't\b/i
/** Small words an acronym's expansion may hold: "MDR" for "Medical Device Regulation", "ICS" for "industrial control systems". */
const LINK_WORDS = new Set(["of", "and", "for", "the", "on", "in", "to"])

/** Common abbreviations of one word: "PV" for "photovoltaic". Folded, without a plural s. */
const ONE_WORD_SPELLINGS: Record<string, string[]> = {
	pv: ["photovoltaic"],
	ecg: ["electrocardiogram", "electrocardiography", "electrocardiographic"],
	ekg: ["electrocardiogram", "electrocardiography"],
	eeg: ["electroencephalogram", "electroencephalography"],
	emg: ["electromyogram", "electromyography"],
	mcu: ["microcontroller"],
}

/** A name, number, or number with the word after it, that a code check can look up in records. */
interface Detail {
	/** As the claim writes it: "Nordic", "AWS", "72 hours". */
	text: string
	words: string[]
	/** For a name in capitals (3 letters or more, maybe a plural s): its letters, so its expansion counts too. */
	acronym?: string
	/** A number under 100 on its own: in so many works that only a company, page or researcher record holding it counts. */
	small?: boolean
}

/** Published work: dozens per researcher, so most small numbers are in one of them by chance. */
const WORK_KINDS = new Set(["publication", "project", "patent", "work"])

/** Folded, with thousands separators dropped, so "7,400", "7400" and the Serbian "7.400" meet. */
function norm(token: string): string {
	return fold(token).replace(/(?<=\d)[,.](?=\d{3}\b)/g, "")
}

/** A text's words and numbers, normalised, with ids left out. */
function wordsOf(text: string): string[] {
	return (text.replace(IDS_IN_TEXT, " ").match(TOKEN) ?? []).map(norm)
}

/**
 * The details of a claim that a code check can look up: names (a capital past the first letter, letters with digits,
 * or a capital inside a sentence), numbers, and a number with the word after it ("72 hours"). Plain words are left out,
 * since a claim may put them its own way. So are the names in `skip` and clauses that say what is missing.
 */
function detailsOf(text: string, skip: Set<string>): Detail[] {
	const details = new Map<string, Detail>()
	const add = (detail: Detail) => details.set(detail.words.join(" "), detail)
	for (const sentence of text.replace(IDS_IN_TEXT, " ").split(/(?<=[.!?])\s+(?=\p{Lu})/u)) {
		let first = true
		for (const clause of sentence.split(/[;—–]/)) {
			const tokens = [...clause.matchAll(TOKEN)]
			const negated = NEGATION.test(clause)
			tokens.forEach(({ 0: token, index }, i) => {
				const start = first
				first = false
				if (negated) return
				if (/^\p{N}/u.test(token)) {
					add({ text: token, words: [norm(token)], small: /^\p{N}{1,2}$/u.test(token) })
					const next = tokens[i + 1]
					if (next && /^\p{Ll}+$/u.test(next[0]) && /^[ -]$/.test(clause.slice(index + token.length, next.index))) {
						add({ text: `${token} ${next[0]}`, words: [norm(token), norm(next[0])] })
					}
				} else if ((/\p{N}|.\p{Lu}/u.test(token) || (!start && /^\p{Lu}./u.test(token))) && !skip.has(norm(token))) {
					const acronym = /^\p{Lu}{2,}s?$/u.test(token) ? fold(token.replace(/s$/, "")) : undefined
					add({ text: token, words: [norm(token)], acronym })
				}
			})
		}
	}
	return [...details.values()]
}

interface Indexed {
	words: string[]
	set: Set<string>
}

/**
 * Whether a record's words hold the detail: as written, with or without a plural s, or an acronym as its words'
 * initials. `loose` also takes another form of the same name, for the claim's own records: it may clear a claim,
 * never blame another record ("Manager" is not "manages").
 */
function holds({ words, set }: Indexed, detail: Detail, loose = false): boolean {
	const forms = (word: string) => [word, `${word}s`, word.replace(/s$/, "")]
	const [head, ...tail] = detail.words
	if (!tail.length) {
		return (
			forms(head).some((form) => set.has(form)) ||
			(detail.acronym !== undefined && spells(detail.acronym, words, loose)) ||
				(loose && spelledInOneWord(head, set)) ||
			(loose && words.some((word) => sameStem(head, word)))
		)
	}
	return words.some((word, i) => word === head && tail.every((next, k) => forms(next).includes(words[i + 1 + k])))
}

/** Whether a record holds the one-word spelling of an abbreviation ("PV" in a record that says "photovoltaics"). */
function spelledInOneWord(abbreviation: string, set: Set<string>): boolean {
	const spellings = ONE_WORD_SPELLINGS[abbreviation.replace(/s$/, "")]
	return spellings !== undefined && spellings.some((word) => set.has(word) || set.has(`${word}s`))
}

/**
 * Whether two words are forms of one name. A model name with digits is its family's ("STM32" in "STM32H7"). Other
 * names share all but their last three letters, and at least five: "Hungarian" and "Hungary", "Vojvodina" and the
 * Serbian "Vojvodini".
 */
function sameStem(detail: string, word: string): boolean {
	if (/\p{N}/u.test(detail)) return detail.length >= 4 && /\p{L}/u.test(detail) && word.startsWith(detail)
	let k = 0
	while (k < detail.length && detail[k] === word[k]) k++
	return k >= 5 && k >= Math.max(detail.length, word.length) - 3
}

/**
 * Whether consecutive words start with the acronym's letters, with small link words between them. `loose` lets a link
 * word inside the acronym give a letter of its own: "TTS" for "text-to-speech". Two letters ("AF") are too few for a
 * name nobody wrote, so only `loose` takes them.
 */
function spells(acronym: string, words: string[], loose: boolean): boolean {
	if (acronym.length < 3 && !loose) return false
	const from = (i: number, k: number): boolean => {
		if (k === acronym.length) return true
		const word = words[i]
		if (word === undefined) return false
		const link = LINK_WORDS.has(word)
		const letter = link ? loose && k > 0 && k < acronym.length - 1 : word.length >= 3
		if (letter && word[0] === acronym[k] && from(i + 1, k + 1)) return true
		return k > 0 && link && from(i + 1, k)
	}
	return words.some((_, start) => from(start, 0))
}

/**
 * A lookup over the records around an artifact (those its claims cite, and its researcher, company and challenge):
 * the details of a claim that none of its own records hold but another of them does, with the records that do.
 * Such a detail came from a record the claim does not cite ("AWS" in a claim on C005-CH2, from C005).
 */
function uncitedLookup(store: SourceStore, ids: string[]): (claim: Claim, skip: Set<string>) => Array<{ detail: string; ids: string[] }> {
	const records = new Map<string, Indexed & { work: boolean }>()
	for (const id of ids) {
		const record = store.get(id)
		if (!record || records.has(record.id)) continue
		const words = wordsOf(`${record.title} ${record.year ?? ""} ${record.text}`)
		records.set(record.id, { words, set: new Set(words), work: WORK_KINDS.has(record.kind) })
	}
	return (claim, skip) => {
		const own = new Set(claim.sourceIds.map((id) => store.get(id)?.id))
		const cited = [...records].filter(([id]) => own.has(id)).map(([, record]) => record)
		const others = [...records].filter(([id]) => !own.has(id))
		const found = detailsOf(claim.text, skip).flatMap((detail) => {
			if (cited.some((record) => holds(record, detail, true))) return []
			const ids = others.filter(([, record]) => !(detail.small && record.work) && holds(record, detail)).map(([id]) => id)
			return ids.length ? [{ detail: detail.text, ids }] : []
		})
		// "72 hours" says it all: no "72" beside it.
		return found.filter(({ detail }) => !found.some((other) => other.detail.startsWith(`${detail} `)))
	}
}

/** A letter of Serbian that English has not: Latin with a diacritic, or Cyrillic. */
const SERBIAN_LETTER = /[čćžšđČĆŽŠĐЀ-ӿ]/u
/** Text in brackets, and text in quote marks (straight, curly, or the Serbian „…“). */
const BRACKETED = /\(([^()]+)\)/g
const QUOTED = /["“„]([^"“”„]+)["”“]/g
/** English words that Serbian has not: brackets with one ("Opština Kanjiza and one unnamed") explain, they do not quote. */
const ENGLISH = /\b(?:and|or|the|an|of|not|with|for|is|are|by|from|another|other)\b/i

/**
 * The originals a claim quotes from its records: text in quote marks, and text in brackets with a Serbian letter and
 * no English word ("skin damage (oštećenja kore)"), which the Analyst writes after a term it translates.
 */
export function quotedOriginals(text: string): string[] {
	const found = new Set<string>()
	for (const [, inner] of text.matchAll(BRACKETED)) {
		const quoted = [...inner.matchAll(QUOTED)].map((m) => m[1])
		const original = SERBIAN_LETTER.test(inner) && !ENGLISH.test(inner)
		for (const quote of quoted.length ? quoted : original ? [inner] : []) found.add(quote.trim())
	}
	for (const [, quote] of text.matchAll(QUOTED)) if (SERBIAN_LETTER.test(quote)) found.add(quote.trim())
	return [...found].filter((quote) => wordsOf(quote).length > 0)
}

/**
 * The quoted originals of a claim that none of its records holds word for word (ids left out, script, case and
 * diacritics ignored). A Serbian word may take another case ending ("početna" for "početnom"), never another word:
 * "drobna oštećenja" is not in a text that says "sitnim oštećenjima". An ellipsis, a comma or a semicolon splits a
 * quote into parts, so a list of names ("Merkur, Frišmarket") need not keep the record's "and".
 */
export function misquotes(text: string, records: Array<Pick<SourceRecord, "title" | "text">>): string[] {
	const texts = records.map((record) => wordsOf(`${record.title} ${record.text}`))
	return quotedOriginals(text).filter((quote) => {
		const parts = quote.split(/…|\.{3}|[,;]/).map(wordsOf).filter((words) => words.length)
		return !parts.every((part) => texts.some((words) => words.some((_, i) => part.every((word, k) => sameWord(word, words[i + k])))))
	})
}

/** The same word, maybe with another ending: equal, or sharing all but the last three letters and at least three. */
function sameWord(quoted: string, word: string | undefined): boolean {
	if (word === undefined) return false
	if (quoted === word || /\p{N}/u.test(quoted + word)) return quoted === word
	let k = 0
	while (k < quoted.length && quoted[k] === word[k]) k++
	return k >= 3 && k >= Math.max(quoted.length, word.length) - 3
}

/** "a", "a and b", "a, b and c". */
function list(items: string[], last: "and" | "or"): string {
	return items.length > 1 ? `${items.slice(0, -1).join(", ")} ${last} ${items.at(-1)}` : (items[0] ?? "")
}
