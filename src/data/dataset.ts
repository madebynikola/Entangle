import { existsSync, readFileSync } from "node:fs"
import { isAbsolute, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { SourceId, SourceRecord, SourceStore } from "../types"
import { Bm25 } from "./bm25"
import {
	DUPLICATES,
	availabilityOf,
	canonFaculty,
	canonInstitution,
	canonProgramme,
	canonRole,
	canonTitle,
	latinName,
	redactPersonal,
	researcherStatus,
	type ResearcherStatus,
} from "./normalize"
import type { RawAuthor, RawCompany, RawFiles, RawPage, RawPatent, RawProject, RawPublication, RawResearcher } from "./raw"
import { fold, maskEmails } from "./text"

const ROOT = fileURLToPath(new URL("../../", import.meta.url))

/** The full dataset, cloned into `data/raw/` (gitignored). */
export const DATA_DIR = resolve(ROOT, "data/raw/data")
/** 5 companies and 30 researchers in the same format, committed for fast runs (see test/fixtures/README.md). */
export const FIXTURE_DIR = resolve(ROOT, "test/fixtures/data")

export interface Researcher {
	/** Canonical id. Merged duplicates keep the main profile's id. */
	id: string
	/** Shadow profile ids merged into this one. */
	aliases: string[]
	/** Latin script. */
	name: string
	/** Every spelling of the name in the dataset, main and alias profiles, original script. */
	names: string[]
	/** Canonical English title, e.g. `docent` → Assistant Professor. */
	title: string
	faculty: string
	department: string
	institution: string
	fields: string[]
	keywords: string[]
	bio: string
	openTo: string[]
	industryExperience: string
	/** Private remarks with personal reasons removed. Use as constraints; never quote them. */
	notes: string
	language: string
	status: ResearcherStatus
	/** The notes' sentences that limit availability, or null. */
	availability: string | null
	/** False for emeritus and departed researchers: never propose them as PI or supervisor. */
	canLead: boolean
	/** From `authors[].researcher_id`, the dataset's truth. */
	publications: string[]
	projects: string[]
	patents: string[]
}

export interface Publication extends Omit<RawPublication, "authors"> {
	/** `researcher_id` is canonical (aliases resolved), or null for outside co-authors. */
	authors: RawAuthor[]
	researcherIds: string[]
}

export interface Project extends Omit<RawProject, "participants"> {
	participants: Array<{ researcherId: string; role: string }>
	researcherIds: string[]
}

export interface Patent extends RawPatent {
	researcherIds: string[]
}

export interface Challenge {
	/** `C001-CH1` */
	id: string
	companyId: string
	text: string
	detail: string
}

export interface Page {
	/** `C001/job/2024-02-05/<title>`: pages have no id of their own. */
	id: string
	companyId: string
	kind: string
	date: string
	title: string
	/** Email addresses masked, personal reasons removed. */
	text: string
}

export interface Company extends Omit<RawCompany, "challenges" | "rd_capacity" | "past_collaborations"> {
	rdCapacity: string
	pastCollaborations: string
	challenges: string[]
	pages: string[]
}

/** A document in the research index, tied to researchers through dataset links. */
export interface ResearchDoc {
	kind: "publication" | "project" | "patent" | "researcher"
	id: string
	researcherIds: string[]
}

/** A document in the company index: challenges, job ads, and one profile per company. */
export interface CompanyDoc {
	kind: "challenge" | "page" | "company"
	id: string
	companyId: string
}

export class Dataset {
	readonly researchers = new Map<string, Researcher>()
	readonly publications = new Map<string, Publication>()
	readonly projects = new Map<string, Project>()
	readonly patents = new Map<string, Patent>()
	readonly companies = new Map<string, Company>()
	readonly challenges = new Map<string, Challenge>()
	readonly pages = new Map<string, Page>()
	/** Alias id → canonical id, for the duplicates present in this dataset. */
	readonly aliases = new Map<string, string>()
	/** The Critic's view: any cited id → its record and text. */
	readonly sources: SourceStore = { get: (id) => this.source(id), has: (id) => this.source(id) !== undefined }

	private readonly pageByPrefix = new Map<string, string | null>()
	private researchIndexCache?: Bm25<ResearchDoc>
	private companyIndexCache?: Bm25<CompanyDoc>

	constructor(
		readonly dir: string,
		raw: RawFiles,
	) {
		const rawIds = new Set(raw.researchers.map((r) => r.id))
		for (const [alias, main] of Object.entries(DUPLICATES)) {
			if (rawIds.has(alias) && rawIds.has(main)) this.aliases.set(alias, main)
		}
		const canon = (id: string) => this.aliases.get(id) ?? id

		for (const r of raw.researchers) if (!this.aliases.has(r.id)) this.researchers.set(r.id, researcherFrom(r))
		for (const r of raw.researchers) {
			const main = this.aliases.has(r.id) ? this.researchers.get(canon(r.id)) : undefined
			if (main) mergeShadow(main, r)
		}

		for (const p of raw.publications) {
			const authors = p.authors.map((a) => ({ ...a, researcher_id: a.researcher_id && canon(a.researcher_id) }))
			const researcherIds = unique(authors.map((a) => a.researcher_id).filter((id): id is string => !!id && this.researchers.has(id)))
			this.publications.set(p.id, { ...p, authors, researcherIds })
			for (const id of researcherIds) this.researchers.get(id)!.publications.push(p.id)
		}
		for (const p of raw.projects) {
			const participants = p.participants.map((x) => ({ researcherId: canon(x.researcher_id), role: canonRole(x.role) }))
			const researcherIds = unique(participants.map((x) => x.researcherId).filter((id) => this.researchers.has(id)))
			this.projects.set(p.id, { ...p, programme: canonProgramme(p.programme), participants, researcherIds })
			for (const id of researcherIds) this.researchers.get(id)!.projects.push(p.id)
		}
		for (const p of raw.patents) {
			const researcherIds = unique(p.inventors.map((x) => canon(x.researcher_id)).filter((id) => this.researchers.has(id)))
			this.patents.set(p.id, { ...p, researcherIds })
			for (const id of researcherIds) this.researchers.get(id)!.patents.push(p.id)
		}

		for (const c of raw.companies) this.putCompany(c)
		for (const p of raw.pages) {
			const page = pageFrom(p)
			this.pages.set(page.id, page)
			this.companies.get(p.company_id)?.pages.push(page.id)
			const prefix = page.id.split("/").slice(0, 3).join("/")
			this.pageByPrefix.set(prefix, this.pageByPrefix.has(prefix) ? null : page.id)
		}
	}

	/**
	 * Add a company that is not in the dataset files, such as a problem described for the reverse search
	 * (see `addProblem`). It is cleaned like the others and becomes citable at once. Its id must be new.
	 */
	addCompany(c: RawCompany): Company {
		if (this.companies.has(c.id) || c.challenges.some((ch) => this.challenges.has(ch.id))) throw new Error(`The dataset already has ${c.id}`)
		this.companyIndexCache = undefined
		return this.putCompany(c)
	}

	private putCompany(c: RawCompany): Company {
		const { challenges, rd_capacity, past_collaborations, ...rest } = c
		const company: Company = {
			...rest,
			about: clean(c.about),
			plans: clean(c.plans),
			rdCapacity: clean(rd_capacity),
			pastCollaborations: clean(past_collaborations),
			challenges: challenges.map((ch) => ch.id),
			pages: [],
		}
		this.companies.set(c.id, company)
		for (const ch of challenges) this.challenges.set(ch.id, { id: ch.id, companyId: c.id, text: clean(ch.text), detail: clean(ch.detail) })
		return company
	}

	/** Canonical researcher id: resolves duplicate aliases. */
	canonicalId(id: string): string {
		return this.aliases.get(id) ?? id
	}

	researcher(id: string): Researcher | undefined {
		return this.researchers.get(this.canonicalId(id))
	}

	/** A page by its full id, or by `C001/job/2024-02-05` when that prefix is unique. */
	page(id: string): Page | undefined {
		return this.pages.get(id) ?? this.pages.get(this.pageByPrefix.get(id) ?? "")
	}

	/** Any record by its dataset id, as a citable source with its text. */
	source(id: SourceId): SourceRecord | undefined {
		const key = id.trim()
		const r = this.researcher(key)
		if (r) return { id: r.id, kind: "researcher", title: r.name, text: researcherText(r), researcherIds: [r.id] }
		const pub = this.publications.get(key)
		if (pub) return { id: pub.id, kind: "publication", title: pub.title, text: publicationText(pub), researcherIds: pub.researcherIds, year: pub.year }
		const prj = this.projects.get(key)
		if (prj) return { id: prj.id, kind: "project", title: prj.title, text: projectText(prj), researcherIds: prj.researcherIds, year: startYear(prj.years) }
		const pat = this.patents.get(key)
		if (pat) return { id: pat.id, kind: "patent", title: pat.title, text: patentText(pat), researcherIds: pat.researcherIds, year: pat.year }
		const ch = this.challenges.get(key)
		if (ch) return { id: ch.id, kind: "challenge", title: ch.text, text: [ch.text, ch.detail].filter(Boolean).join("\n\n"), researcherIds: [], companyId: ch.companyId }
		const c = this.companies.get(key)
		if (c) return { id: c.id, kind: "company", title: c.name, text: companyText(c), researcherIds: [], companyId: c.id, year: c.founded || undefined }
		const page = this.page(key)
		if (page) {
			const year = Number(page.date.slice(0, 4)) || undefined
			return { id: page.id, kind: "page", title: page.title, text: page.text, researcherIds: [], companyId: page.companyId, year }
		}
		return undefined
	}

	/** BM25 over publications, projects, patents and researcher profiles. Built on first use. */
	get researchIndex(): Bm25<ResearchDoc> {
		if (this.researchIndexCache) return this.researchIndexCache
		const index = new Bm25<ResearchDoc>()
		for (const p of this.publications.values()) {
			// Titles count twice; keywords cover the publications without an abstract. Affiliations stay out.
			index.add({ kind: "publication", id: p.id, researcherIds: p.researcherIds }, `${p.title}. ${p.title}. ${p.keywords.join(", ")}. ${p.abstract}`)
		}
		for (const p of this.projects.values()) {
			index.add({ kind: "project", id: p.id, researcherIds: p.researcherIds }, `${p.acronym} ${p.title}. ${p.title}. ${p.summary}`)
		}
		for (const p of this.patents.values()) {
			index.add({ kind: "patent", id: p.id, researcherIds: p.researcherIds }, `${p.title}. ${p.title}. ${p.abstract}`)
		}
		for (const r of this.researchers.values()) {
			index.add(
				{ kind: "researcher", id: r.id, researcherIds: [r.id] },
				[r.fields.join(", "), r.keywords.join(", "), r.bio, r.openTo.join(". "), r.industryExperience].join(". "),
			)
		}
		return (this.researchIndexCache = index)
	}

	/** BM25 over challenges, job ads and company profiles, for the reverse search. Built on first use. */
	get companyIndex(): Bm25<CompanyDoc> {
		if (this.companyIndexCache) return this.companyIndexCache
		const index = new Bm25<CompanyDoc>()
		for (const ch of this.challenges.values()) {
			index.add({ kind: "challenge", id: ch.id, companyId: ch.companyId }, `${ch.text} ${ch.text} ${ch.detail}`)
		}
		for (const p of this.pages.values()) {
			if (p.kind === "job") index.add({ kind: "page", id: p.id, companyId: p.companyId }, `${p.title}. ${p.text}`)
		}
		for (const c of this.companies.values()) {
			index.add({ kind: "company", id: c.id, companyId: c.id }, `${c.sector}. ${c.about} ${c.products.join(". ")} ${c.tech.join(", ")}`)
		}
		return (this.companyIndexCache = index)
	}

	/** Record counts, for logs. */
	stats(): Record<string, number> {
		return {
			researchers: this.researchers.size,
			aliases: this.aliases.size,
			publications: this.publications.size,
			projects: this.projects.size,
			patents: this.patents.size,
			companies: this.companies.size,
			challenges: this.challenges.size,
			pages: this.pages.size,
		}
	}
}

const cache = new Map<string, Dataset>()

/**
 * Load a dataset folder once per process (about 0.5 s for the full set; indexes build on first search).
 * Default: `$EINSTEIN_DATA_DIR`, else `data/raw/data`. Pass `FIXTURE_DIR` for the small test set.
 */
export function loadDataset(dir: string = process.env.EINSTEIN_DATA_DIR || DATA_DIR): Dataset {
	const path = isAbsolute(dir) ? dir : resolve(process.cwd(), dir)
	let data = cache.get(path)
	if (!data) {
		if (!existsSync(resolve(path, "researchers.json"))) {
			throw new Error(`No dataset in ${path}. Clone jigjoy-ai/einstein-matchmaker-data into data/raw, or use FIXTURE_DIR.`)
		}
		data = new Dataset(path, readRaw(path))
		cache.set(path, data)
	}
	return data
}

export function readRaw(dir: string): RawFiles {
	const json = <T>(file: string, key: string): T[] => JSON.parse(readFileSync(resolve(dir, file), "utf8"))[key]
	const jsonl = <T>(file: string): T[] =>
		readFileSync(resolve(dir, file), "utf8")
			.split("\n")
			.filter((line) => line.trim())
			.map((line) => JSON.parse(line))
	return {
		researchers: json<RawResearcher>("researchers.json", "researchers"),
		publications: jsonl<RawPublication>("publications.jsonl"),
		projects: json<RawProject>("projects.json", "projects"),
		patents: json<RawPatent>("patents.json", "patents"),
		companies: json<RawCompany>("companies.json", "companies"),
		pages: jsonl<RawPage>("company-pages.jsonl"),
	}
}

// ---------------------------------------------------------------------------

function researcherFrom(r: RawResearcher): Researcher {
	const notes = redactPersonal(r.notes)
	const status = researcherStatus(r.title, r.notes)
	return {
		id: r.id,
		aliases: [],
		name: latinName(r.name),
		names: unique([r.name, latinName(r.name)]),
		title: canonTitle(r.title),
		faculty: canonFaculty(r.faculty),
		department: r.department,
		institution: canonInstitution(r.institution),
		fields: r.fields,
		keywords: r.keywords,
		bio: r.bio,
		openTo: r.open_to,
		industryExperience: r.industry_experience,
		notes,
		language: r.language,
		status,
		availability: availabilityOf(notes),
		canLead: status === "active",
		publications: [],
		projects: [],
		patents: [],
	}
}

/** Fold a shadow profile into its main one: keep the alias id and name, add missing fields and keywords. */
function mergeShadow(main: Researcher, shadow: RawResearcher): void {
	main.aliases.push(shadow.id)
	main.names = unique([...main.names, shadow.name, latinName(shadow.name)])
	main.fields = uniqueFolded([...main.fields, ...shadow.fields])
	main.keywords = uniqueFolded([...main.keywords, ...shadow.keywords])
}

function pageFrom(p: RawPage): Page {
	return {
		id: `${p.company_id}/${p.kind}/${p.date}/${p.title}`,
		companyId: p.company_id,
		kind: p.kind,
		date: p.date,
		title: p.title,
		text: clean(p.text),
	}
}

/** Company-side text as agents see it: no email addresses, no personal reasons for leave (C120-CH3 names one). */
function clean(s: string): string {
	return redactPersonal(maskEmails(s))
}

function researcherText(r: Researcher): string {
	return [
		`${r.name} (${r.id}${r.aliases.length ? `, also ${r.aliases.join(", ")}` : ""}): ${r.title}, ${r.department}, ${r.faculty}, ${r.institution}.`,
		r.status !== "active" && `Status: ${r.status}.`,
		r.fields.length && `Fields: ${r.fields.join("; ")}.`,
		r.keywords.length && `Keywords: ${r.keywords.join("; ")}.`,
		r.bio && `Bio: ${r.bio}`,
		r.openTo.length && `Open to: ${r.openTo.join("; ")}.`,
		r.industryExperience && `Industry experience: ${r.industryExperience}`,
		r.notes && `Notes: ${r.notes}`,
	]
		.filter(Boolean)
		.join("\n")
}

function publicationText(p: Publication): string {
	const authors = p.authors.map((a) => (a.researcher_id ? `${a.name} (${a.researcher_id})` : `${a.name} (outside co-author)`))
	return [
		`${p.title} (${p.year}, ${p.type}, ${p.venue}).`,
		`Authors: ${authors.join("; ")}.`,
		p.keywords.length && `Keywords: ${p.keywords.join("; ")}.`,
		p.abstract || "(no abstract)",
	]
		.filter(Boolean)
		.join("\n")
}

function projectText(p: Project): string {
	return [
		`${p.acronym ? `${p.acronym}: ` : ""}${p.title} (${p.programme}, ${p.years}).`,
		`Participants: ${p.participants.map((x) => `${x.researcherId} ${x.role}`).join("; ")}.`,
		p.partners.length && `Partners: ${p.partners.join("; ")}.`,
		p.summary,
	]
		.filter(Boolean)
		.join("\n")
}

function patentText(p: Patent): string {
	const inventors = p.inventors.map((x) => `${x.name} (${x.researcher_id})`).join("; ")
	return [`${p.title} (${p.year}, ${p.status}).`, `Inventors: ${inventors}.`, p.abstract || "(no abstract)"].join("\n")
}

function companyText(c: Company): string {
	// A described problem (reverse search) has none of these, so each is left out when empty.
	const facts = [c.sector, c.location, c.employees && `${c.employees} employees`, c.founded && `founded ${c.founded}`].filter(Boolean)
	return [
		`${c.name} (${c.id})${facts.length ? `: ${facts.join(", ")}` : ""}.`,
		c.about,
		c.products.length && `Products: ${c.products.join("; ")}.`,
		c.tech.length && `Tech: ${c.tech.join("; ")}.`,
		c.plans && `Plans: ${c.plans}`,
		c.rdCapacity && `R&D capacity: ${c.rdCapacity}`,
		c.pastCollaborations && `Past collaborations: ${c.pastCollaborations}`,
	]
		.filter(Boolean)
		.join("\n")
}

function startYear(years: string): number | undefined {
	return Number(years.slice(0, 4)) || undefined
}

function unique<T>(items: T[]): T[] {
	return [...new Set(items)]
}

function uniqueFolded(items: string[]): string[] {
	const seen = new Set<string>()
	return items.filter((item) => {
		const key = fold(item)
		if (seen.has(key)) return false
		seen.add(key)
		return true
	})
}
