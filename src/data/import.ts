import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { DATA_DIR, FIXTURE_DIR } from "./dataset"
import { DUPLICATES } from "./normalize"
import { PROBLEM_COMPANY_ID } from "./problem"
import type { RawCompany, RawFiles, RawPage, RawPatent, RawProject, RawPublication, RawResearcher } from "./raw"
import { fold } from "./text"

/**
 * Your own data: files a person brings in the EINSTEIN dataset's format (docs/dataset.md), read leniently and
 * written as a dataset folder that `loadDataset` reads like the real one.
 *
 * Accepted: `researchers.json`, `publications.jsonl`, `projects.json`, `patents.json`, `companies.json`,
 * `company-pages.jsonl`, and the CSV copies `researchers.csv` and `companies.csv` (lists joined by `; `). A JSON file
 * may be a bare array, the dataset's `{ researchers: [...] }` wrapper, or one object that holds several lists.
 * Only researchers are required. A missing field gets an empty value, and a link given on one side only
 * (a researcher's `publications`, or a publication's `authors`) is made on both.
 *
 * Ids: the Critic and the app find cited ids in text by their shape (`R0001`, `C001`, `C001-CH1`, `SYN-PUB-00001`,
 * `SYN-PRJ-0001`, `SYN-PAT-001`). An id with another shape gets the next free id of the right shape, and
 * `renamed` maps the original to it. `C999` is the reverse search's own company, so a company with that id moves.
 */

/** Your own data, one folder per upload (gitignored). Each holds the dataset's files, `meta.json` and `ids.json`. */
export const UPLOADS_DIR = fileURLToPath(new URL("../../data/uploads/", import.meta.url))

export interface UploadMeta {
	name: string
	createdAt: string
	/** Records per list after the import, as the server lists them. */
	counts?: Record<string, number>
	/** Original id → new id. */
	renamed: Record<string, string>
	warnings: string[]
}

export function readUploadMeta(dir: string): UploadMeta | undefined {
	const path = resolve(dir, "meta.json")
	if (!existsSync(path)) return undefined
	try {
		return JSON.parse(readFileSync(path, "utf8")) as UploadMeta
	} catch {
		return undefined
	}
}

/** What a run on `dir` read, for its `dataset.json`: undefined for the EINSTEIN dataset, the default. */
export function dataLabel(dir: string): { kind: "fixture" | "upload"; name: string } | undefined {
	const path = resolve(dir)
	if (path === resolve(DATA_DIR) || path === resolve(process.env.EINSTEIN_DATA_DIR ?? DATA_DIR)) return undefined
	if (path === resolve(FIXTURE_DIR)) return { kind: "fixture", name: "Test fixture" }
	return { kind: "upload", name: readUploadMeta(path)?.name ?? path.split(/[\\/]/).filter(Boolean).pop() ?? "Your data" }
}

export interface ImportFile {
	name: string
	text: string
}

export interface ImportResult {
	raw: RawFiles
	/** Original id → new id, for ids that did not have the dataset's shape or clashed. */
	renamed: Record<string, string>
	/** Files read, and what each held. */
	read: { name: string; kind: Kind; records: number }[]
	/** Records skipped or files not used, one line each. */
	warnings: string[]
}

type Kind = keyof RawFiles

const KINDS: Kind[] = ["researchers", "publications", "projects", "patents", "companies", "pages"]

/** Kind of list by file name: `researchers.json`, `my-publications.jsonl`, `company-pages.jsonl`. */
function kindOfName(name: string): Kind | undefined {
	const base = name.toLowerCase().replace(/^.*[\\/]/, "")
	if (/page/.test(base)) return "pages"
	if (/researcher|people|staff/.test(base)) return "researchers"
	if (/publication|paper|works/.test(base)) return "publications"
	if (/project/.test(base)) return "projects"
	if (/patent/.test(base)) return "patents"
	if (/compan|challenge/.test(base)) return "companies"
	return undefined
}

/** Read the files into raw records, fill what is missing, link both sides and give ids the dataset's shape. */
export function importFiles(files: ImportFile[]): ImportResult {
	const lists: Record<Kind, unknown[]> = { researchers: [], publications: [], projects: [], patents: [], companies: [], pages: [] }
	const read: ImportResult["read"] = []
	const warnings: string[] = []

	for (const file of files) {
		const text = file.text.replace(/^﻿/, "")
		const byName = kindOfName(file.name)
		let found: Partial<Record<Kind, unknown[]>>
		try {
			found = parseFile(file.name, text, byName)
		} catch (error) {
			const message = `${file.name}: ${error instanceof Error ? error.message : String(error)}`
			// A file named after a list must read; any other file is only skipped.
			if (byName) throw new Error(message)
			warnings.push(`${message}. Not used.`)
			continue
		}
		const kinds = Object.keys(found) as Kind[]
		if (!kinds.length) {
			warnings.push(`${file.name}: not used. Name it after what it holds, such as researchers.json or publications.jsonl.`)
			continue
		}
		for (const kind of kinds) {
			lists[kind].push(...found[kind]!)
			read.push({ name: file.name, kind, records: found[kind]!.length })
		}
	}

	const raw: RawFiles = {
		researchers: keep(lists.researchers, researcher, "researcher", warnings),
		publications: keep(lists.publications, publication, "publication", warnings),
		projects: keep(lists.projects, project, "project", warnings),
		patents: keep(lists.patents, patent, "patent", warnings),
		companies: keep(lists.companies, company, "company", warnings),
		pages: keep(lists.pages, page, "page", warnings),
	}
	if (!raw.researchers.length) throw new Error("No researchers. Add researchers.json or researchers.csv: each record needs at least a name.")

	const renamed = reshapeIds(raw)
	link(raw)
	return { raw, renamed, read, warnings }
}

/** Write the records as a dataset folder in the dataset's own file format. */
export function writeRaw(dir: string, raw: RawFiles, note: string): void {
	mkdirSync(dir, { recursive: true })
	const wrap = (key: string, list: unknown[]) => JSON.stringify({ name: `uploaded-${key}`, version: "2.0", note, [key]: list }, null, 1) + "\n"
	const lines = (list: unknown[]) => list.map((item) => JSON.stringify(item)).join("\n") + (list.length ? "\n" : "")
	writeFileSync(resolve(dir, "researchers.json"), wrap("researchers", raw.researchers))
	writeFileSync(resolve(dir, "publications.jsonl"), lines(raw.publications))
	writeFileSync(resolve(dir, "projects.json"), wrap("projects", raw.projects))
	writeFileSync(resolve(dir, "patents.json"), wrap("patents", raw.patents))
	writeFileSync(resolve(dir, "companies.json"), wrap("companies", raw.companies))
	writeFileSync(resolve(dir, "company-pages.jsonl"), lines(raw.pages))
}

// ---------------------------------------------------------------------------
// Files

function parseFile(name: string, text: string, byName: Kind | undefined): Partial<Record<Kind, unknown[]>> {
	const lower = name.toLowerCase()
	if (lower.endsWith(".csv")) {
		const rows = parseCsv(text)
		const kind = byName ?? (rows.length && "challenges" in rows[0] ? "companies" : "researchers")
		if (kind === "researchers") return { researchers: rows.map(csvResearcher) }
		if (kind === "companies") return { companies: rows.map(csvCompany) }
		throw new Error("only researchers.csv and companies.csv are read as CSV. Use JSON for the other lists.")
	}
	const trimmed = text.trim()
	if (!trimmed) return {}
	const lines = () => {
		const records = jsonLines(trimmed)
		const kind = byName ?? guessKind(records[0])
		return kind ? { [kind]: records } : {}
	}
	if (lower.endsWith(".jsonl") || lower.endsWith(".ndjson")) return lines()
	let value: unknown
	try {
		value = JSON.parse(trimmed)
	} catch (error) {
		// JSON Lines saved as .json: one object per line.
		if (/^{[^\n]*}\s*\n\s*{/.test(trimmed)) return lines()
		throw new Error(`not valid JSON (${error instanceof Error ? error.message : String(error)})`)
	}
	if (Array.isArray(value)) {
		const kind = byName ?? guessKind(value[0])
		return kind ? { [kind]: value } : {}
	}
	if (value && typeof value === "object") {
		const found: Partial<Record<Kind, unknown[]>> = {}
		const object = value as Record<string, unknown>
		for (const kind of KINDS) {
			const list = object[kind] ?? (kind === "pages" ? object["company_pages"] ?? object["company-pages"] : undefined)
			if (Array.isArray(list)) found[kind] = list
		}
		return found
	}
	return {}
}

function jsonLines(text: string): unknown[] {
	return text
		.split("\n")
		.map((line, i) => [line.trim(), i + 1] as const)
		.filter(([line]) => line)
		.map(([line, n]) => {
			try {
				return JSON.parse(line)
			} catch {
				throw new Error(`line ${n} is not valid JSON`)
			}
		})
}

/** What a record is, from its fields, when its file name does not say. */
function guessKind(record: unknown): Kind | undefined {
	if (!record || typeof record !== "object") return undefined
	const has = (key: string) => key in (record as object)
	if (has("challenges")) return "companies"
	if (has("company_id")) return "pages"
	if (has("inventors")) return "patents"
	if (has("participants") || has("acronym")) return "projects"
	if (has("authors") || has("abstract") || has("venue")) return "publications"
	if (has("name")) return "researchers"
	return undefined
}

/** RFC 4180 CSV with a header row: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): Record<string, string>[] {
	const rows: string[][] = []
	let row: string[] = []
	let field = ""
	let quoted = false
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]
		if (quoted) {
			if (ch === '"' && text[i + 1] === '"') {
				field += '"'
				i++
			} else if (ch === '"') quoted = false
			else field += ch
		} else if (ch === '"') quoted = true
		else if (ch === ",") {
			row.push(field)
			field = ""
		} else if (ch === "\n" || ch === "\r") {
			if (ch === "\r" && text[i + 1] === "\n") i++
			row.push(field)
			field = ""
			if (row.some((cell) => cell.trim())) rows.push(row)
			row = []
		} else field += ch
	}
	row.push(field)
	if (row.some((cell) => cell.trim())) rows.push(row)
	const [header, ...body] = rows
	if (!header) return []
	const keys = header.map((key) => key.trim().toLowerCase().replace(/\s+/g, "_"))
	return body.map((cells) => Object.fromEntries(keys.map((key, i) => [key, (cells[i] ?? "").trim()])))
}

const list = (value: string | undefined) => (value ?? "").split(/\s*;\s*/).filter(Boolean)

function csvResearcher(row: Record<string, string>): unknown {
	return { ...row, fields: list(row.fields), keywords: list(row.keywords), publications: list(row.publications), projects: list(row.projects), patents: list(row.patents), open_to: list(row.open_to) }
}

function csvCompany(row: Record<string, string>): unknown {
	// `C001-CH1: text | C001-CH2: text`, as the dataset's companies.csv writes them.
	const challenges = (row.challenges ?? "")
		.split(/\s*\|\s*/)
		.filter(Boolean)
		.map((part) => {
			const match = part.match(/^([A-Za-z0-9_.-]+-CH\d+):\s*([\s\S]*)$/)
			return match ? { id: match[1], text: match[2] } : { text: part }
		})
	return { ...row, products: list(row.products), tech: list(row.tech), challenges }
}

// ---------------------------------------------------------------------------
// Records: every field the data layer reads, with an empty value when it is missing.

type Loose = Record<string, unknown>

function keep<T>(records: unknown[], make: (record: Loose) => T | string, what: string, warnings: string[]): T[] {
	const out: T[] = []
	let skipped = 0
	let reason = ""
	for (const record of records) {
		if (!record || typeof record !== "object" || Array.isArray(record)) {
			skipped++
			reason ||= "not an object"
			continue
		}
		const made = make(record as Loose)
		if (typeof made === "string") {
			skipped++
			reason ||= made
		} else out.push(made)
	}
	if (skipped) warnings.push(`${skipped} ${what}${skipped === 1 ? "" : "s"} skipped: ${reason}.`)
	return out
}

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "")
const num = (value: unknown): number => {
	const n = typeof value === "number" ? value : Number.parseInt(str(value), 10)
	return Number.isFinite(n) ? n : 0
}
const strings = (value: unknown): string[] =>
	Array.isArray(value) ? value.map(str).filter(Boolean) : typeof value === "string" ? value.split(/\s*[;\n]\s*/).filter(Boolean) : []
const ids = (value: unknown): string[] =>
	Array.isArray(value) ? value.map((item) => str(item && typeof item === "object" ? (item as Loose).id : item)).filter(Boolean) : strings(value)

function researcher(r: Loose): RawResearcher | string {
	const name = str(r.name) || [str(r.first_name), str(r.last_name)].filter(Boolean).join(" ")
	if (!name) return "a researcher needs a name"
	return {
		id: str(r.id),
		name,
		title: str(r.title),
		institution: str(r.institution),
		faculty: str(r.faculty),
		department: str(r.department),
		fields: strings(r.fields),
		keywords: strings(r.keywords),
		bio: str(r.bio),
		publications: ids(r.publications),
		projects: ids(r.projects),
		patents: ids(r.patents),
		open_to: strings(r.open_to),
		industry_experience: str(r.industry_experience),
		notes: str(r.notes),
		language: str(r.language) || "en",
	}
}

function publication(p: Loose): RawPublication | string {
	const title = str(p.title)
	if (!title) return "a publication needs a title"
	const authors = Array.isArray(p.authors)
		? p.authors.map((a) =>
				a && typeof a === "object"
					? { name: str((a as Loose).name), researcher_id: str((a as Loose).researcher_id) || null, affiliation: str((a as Loose).affiliation) }
					: { name: str(a), researcher_id: null, affiliation: "" },
			)
		: strings(p.authors).map((name) => ({ name, researcher_id: null, affiliation: "" }))
	for (const id of ids(p.researcher_ids)) if (!authors.some((a) => a.researcher_id === id)) authors.push({ name: "", researcher_id: id, affiliation: "" })
	return { id: str(p.id), title, abstract: str(p.abstract), year: num(p.year), venue: str(p.venue), type: str(p.type), keywords: strings(p.keywords), authors }
}

function project(p: Loose): RawProject | string {
	const title = str(p.title) || str(p.acronym)
	if (!title) return "a project needs a title"
	const participants = Array.isArray(p.participants)
		? p.participants
				.map((x) => (x && typeof x === "object" ? { researcher_id: str((x as Loose).researcher_id), role: str((x as Loose).role) || "member" } : { researcher_id: str(x), role: "member" }))
				.filter((x) => x.researcher_id)
		: []
	return {
		id: str(p.id),
		acronym: str(p.acronym),
		title,
		programme: str(p.programme),
		years: str(p.years),
		summary: str(p.summary),
		partners: strings(p.partners),
		participants,
	}
}

function patent(p: Loose): RawPatent | string {
	const title = str(p.title)
	if (!title) return "a patent needs a title"
	const inventors = Array.isArray(p.inventors)
		? p.inventors
				.map((x) => (x && typeof x === "object" ? { researcher_id: str((x as Loose).researcher_id), name: str((x as Loose).name) } : { researcher_id: str(x), name: "" }))
				.filter((x) => x.researcher_id)
		: []
	return { id: str(p.id), title, year: num(p.year), status: str(p.status), abstract: str(p.abstract), inventors }
}

function company(c: Loose): RawCompany | string {
	const name = str(c.name)
	if (!name) return "a company needs a name"
	const challenges = (Array.isArray(c.challenges) ? c.challenges : strings(c.challenges))
		.map((ch) => (ch && typeof ch === "object" ? { id: str((ch as Loose).id), text: str((ch as Loose).text), detail: str((ch as Loose).detail) } : { id: "", text: str(ch), detail: "" }))
		.filter((ch) => ch.text)
	return {
		id: str(c.id),
		name,
		sector: str(c.sector),
		employees: num(c.employees),
		founded: num(c.founded),
		location: str(c.location),
		about: str(c.about),
		products: strings(c.products),
		tech: strings(c.tech),
		challenges,
		plans: str(c.plans),
		rd_capacity: str(c.rd_capacity),
		past_collaborations: str(c.past_collaborations),
		language: str(c.language) || "en",
	}
}

function page(p: Loose): RawPage | string {
	const text = str(p.text)
	if (!text) return "a page needs text"
	return { company_id: str(p.company_id), kind: str(p.kind) || "website", title: str(p.title), date: str(p.date), text }
}

// ---------------------------------------------------------------------------
// Ids

/** Give every record an id of the dataset's shape, unique in its list, and rewrite the links to match. */
function reshapeIds(raw: RawFiles): Record<string, string> {
	const renamed: Record<string, string> = {}

	const researchers = reshape(raw.researchers, /^R\d{4}$/, (n) => `R${pad(n, 4)}`, 9999)
	// Two researchers the EINSTEIN data merges as one person keep apart here unless their names agree.
	for (const [alias, main] of Object.entries(DUPLICATES)) {
		const a = raw.researchers.find((r) => researchers.next.get(r) === alias)
		const b = raw.researchers.find((r) => researchers.next.get(r) === main)
		if (a && b && nameKey(a.name) !== nameKey(b.name)) researchers.next.set(a, researchers.fresh())
	}
	const publications = reshape(raw.publications, /^SYN-PUB-\d+$/, (n) => `SYN-PUB-${pad(n, 5)}`)
	const projects = reshape(raw.projects, /^SYN-PRJ-\d+$/, (n) => `SYN-PRJ-${pad(n, 4)}`)
	const patents = reshape(raw.patents, /^SYN-PAT-\d+$/, (n) => `SYN-PAT-${pad(n, 3)}`)
	const companies = reshape(raw.companies, /^C\d{3}$/, (n) => `C${pad(n, 3)}`, 998, [PROBLEM_COMPANY_ID])

	const map = (lookup: Map<string, string>) => (id: string) => lookup.get(id) ?? id
	const researcherId = map(researchers.byOld)
	const publicationId = map(publications.byOld)
	const projectId = map(projects.byOld)
	const patentId = map(patents.byOld)
	const companyId = map(companies.byOld)

	for (const [record, id] of [...researchers.next, ...publications.next, ...projects.next, ...patents.next, ...companies.next]) {
		if (record.id && record.id !== id) renamed[record.id] = id
	}

	for (const r of raw.researchers) {
		r.id = researchers.next.get(r)!
		r.publications = r.publications.map(publicationId)
		r.projects = r.projects.map(projectId)
		r.patents = r.patents.map(patentId)
	}
	for (const p of raw.publications) {
		p.id = publications.next.get(p)!
		for (const a of p.authors) if (a.researcher_id) a.researcher_id = researcherId(a.researcher_id)
	}
	for (const p of raw.projects) {
		p.id = projects.next.get(p)!
		for (const x of p.participants) x.researcher_id = researcherId(x.researcher_id)
	}
	for (const p of raw.patents) {
		p.id = patents.next.get(p)!
		for (const x of p.inventors) x.researcher_id = researcherId(x.researcher_id)
	}
	for (const c of raw.companies) {
		const id = companies.next.get(c)!
		const seen = new Set<string>()
		c.challenges = c.challenges.map((ch, i) => {
			// A challenge id is its company's id and a number: C001-CH1.
			let next = ch.id
			if (!new RegExp(`^${id}-CH\\d+$`).test(next) || seen.has(next)) {
				let n = i + 1
				while (seen.has(`${id}-CH${n}`) || c.challenges.some((other) => other !== ch && other.id === `${id}-CH${n}`)) n++
				next = `${id}-CH${n}`
			}
			seen.add(next)
			if (ch.id && ch.id !== next) renamed[ch.id] = next
			return { ...ch, id: next }
		})
		c.id = id
	}
	raw.pages = raw.pages
		.map((p) => ({ ...p, company_id: companyId(p.company_id) }))
		.filter((p) => raw.companies.some((c) => c.id === p.company_id))
	return renamed
}

/**
 * New ids for a list: an id of the right shape that is not taken stays, anything else gets the next free one.
 * `byOld` maps each original id to its new one (the first record wins when an id repeats).
 */
function reshape<T extends { id: string }>(records: T[], shape: RegExp, make: (n: number) => string, max = Infinity, reserved: string[] = []) {
	const taken = new Set<string>(reserved)
	const next = new Map<T, string>()
	const byOld = new Map<string, string>()
	for (const record of records) {
		if (shape.test(record.id) && !taken.has(record.id)) {
			taken.add(record.id)
			next.set(record, record.id)
		}
	}
	let n = 0
	const fresh = () => {
		let id: string
		do {
			n++
			if (n > max) throw new Error(`Too many records: ids of the shape ${make(1)} run out at ${make(max)}.`)
			id = make(n)
		} while (taken.has(id))
		taken.add(id)
		return id
	}
	for (const record of records) if (!next.has(record)) next.set(record, fresh())
	for (const record of records) if (record.id && !byOld.has(record.id)) byOld.set(record.id, next.get(record)!)
	return { next, byOld, fresh }
}

/** A name's words in any order and script: `Jeremić Mirjana` and `Mirjana Jeremić` are one key. */
function nameKey(name: string): string {
	return fold(name).split(/[\s,.]+/).filter(Boolean).sort().join(" ")
}

function pad(n: number, width: number): string {
	return String(n).padStart(width, "0")
}

/** A link given on one side only is made on both: the data layer reads authors, participants and inventors. */
function link(raw: RawFiles): void {
	const publications = new Map(raw.publications.map((p) => [p.id, p]))
	const projects = new Map(raw.projects.map((p) => [p.id, p]))
	const patents = new Map(raw.patents.map((p) => [p.id, p]))
	for (const r of raw.researchers) {
		for (const id of r.publications) {
			const p = publications.get(id)
			if (p && !p.authors.some((a) => a.researcher_id === r.id)) p.authors.push({ name: r.name, researcher_id: r.id, affiliation: [r.faculty, r.institution].filter(Boolean).join(", ") })
		}
		for (const id of r.projects) {
			const p = projects.get(id)
			if (p && !p.participants.some((x) => x.researcher_id === r.id)) p.participants.push({ researcher_id: r.id, role: "member" })
		}
		for (const id of r.patents) {
			const p = patents.get(id)
			if (p && !p.inventors.some((x) => x.researcher_id === r.id)) p.inventors.push({ researcher_id: r.id, name: r.name })
		}
	}
	const byId = new Map(raw.researchers.map((r) => [r.id, r]))
	for (const p of raw.publications) {
		for (const a of p.authors) {
			const r = a.researcher_id ? byId.get(a.researcher_id) : undefined
			if (!r) a.researcher_id = null
			else {
				a.name ||= r.name
				if (!r.publications.includes(p.id)) r.publications.push(p.id)
			}
		}
	}
	for (const p of raw.projects) {
		p.participants = p.participants.filter((x) => byId.has(x.researcher_id))
		for (const x of p.participants) if (!byId.get(x.researcher_id)!.projects.includes(p.id)) byId.get(x.researcher_id)!.projects.push(p.id)
	}
	for (const p of raw.patents) {
		p.inventors = p.inventors.filter((x) => byId.has(x.researcher_id))
		for (const x of p.inventors) {
			const r = byId.get(x.researcher_id)!
			x.name ||= r.name
			if (!r.patents.includes(p.id)) r.patents.push(p.id)
		}
	}
	// A researcher's list keeps only records that are in the upload.
	for (const r of raw.researchers) {
		r.publications = r.publications.filter((id) => publications.has(id))
		r.projects = r.projects.filter((id) => projects.has(id))
		r.patents = r.patents.filter((id) => patents.has(id))
	}
}
