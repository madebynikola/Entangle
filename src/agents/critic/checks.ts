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
import { idsIn, sameName } from "./text"

export type Artifact = ResearcherProfile | CompanyNeed | PairCandidate | Proposal

/** Who an artifact is about. Every record a claim cites must belong to one of them. */
export interface Subject {
	/** Canonical researcher id (an alias resolves to its main profile). */
	researcherId?: string
	companyId?: string
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
 * restatement, a profile its availability and one expertise claim, a pair its problem and one reason. False, with
 * nothing changed, when a core claim is rejected, a reject is about the artifact's own ids, or it is a proposal.
 */
export function trimArtifact(s: MatchState, kind: ArtifactKind, id: string, artifact: Artifact, rejected: RejectedClaim[]): boolean {
	if (kind === "proposal") return false
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

/** A proposal's free text only, with every rendered claim cut out, so a fix to a claim does not count as a change. */
export function freeTextOf(proposal: Proposal): string {
	let text = proposalText(proposal)
	for (const claim of proposal.claims ?? []) text = text.split(`${claim.text.trim()} [${claim.sourceIds.join(", ")}]`).join("")
	return text.replace(/\s+/g, " ").trim()
}

/**
 * The checks that need no model: the artifact's own ids exist and fit its names,
 * every claim cites at least one source, every cited id exists, and every cited record
 * belongs to the artifact's researcher or company (ids only, never names).
 */
export function checkByCode(kind: ArtifactKind, artifact: Artifact, s: MatchState, store: SourceStore): CodeCheck {
	const rejected: RejectedClaim[] = []
	const subject = subjectOf(kind, artifact, s, store, rejected)
	const passed: Claim[] = []
	const sources = new Map<string, SourceRecord>()

	for (const claim of claimsOf(kind, artifact)) {
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
		passed.push(claim)
		for (const [id, record] of records) sources.set(id, record)
	}

	if (kind === "proposal") {
		const cited = new Set(claimsOf(kind, artifact).flatMap((claim) => claim.sourceIds ?? []))
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
			return { companyId: n.companyId, line: `company ${label(n.companyId, n.companyId)}, challenge ${n.challengeId}` }
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
