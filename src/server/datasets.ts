import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { DATA_DIR, Dataset, FIXTURE_DIR, loadDataset, readRaw } from "../data/dataset"
import { UPLOADS_DIR, importFiles, readUploadMeta, writeRaw, type ImportFile, type UploadMeta } from "../data/import"
import type { CompanyInfo, DatasetCounts, DatasetInfo } from "./api"

/**
 * The data a run can read: the EINSTEIN dataset when it is cloned into data/raw/, the 5-company test fixture,
 * and your own uploads in data/uploads/<id>/. Nothing here leaves the machine.
 */

const UPLOAD_ID = /^[a-z0-9][a-z0-9-]{0,47}$/

/** Uploads loaded in this process. Not loadDataset's cache: an upload can be deleted and its id used again. */
const uploads = new Map<string, Dataset>()

function load(id: string, dir: string): Dataset {
	if (id === "einstein" || id === "fixture") return loadDataset(dir)
	let data = uploads.get(id)
	if (!data) uploads.set(id, (data = new Dataset(dir, readRaw(dir))))
	return data
}

function einsteinDir(): string {
	return process.env.EINSTEIN_DATA_DIR || DATA_DIR
}

function hasData(dir: string): boolean {
	return existsSync(join(dir, "researchers.json"))
}

/** The id a run uses when it names none, as the CLI picks it: the EINSTEIN dataset when it is here, else the fixture. */
function defaultId(): string {
	return hasData(einsteinDir()) ? "einstein" : "fixture"
}

/** The folder of a dataset id, or undefined when there is no such data on this machine. */
export function datasetDir(id: string): string | undefined {
	if (id === "einstein") return hasData(einsteinDir()) ? einsteinDir() : undefined
	if (id === "fixture") return FIXTURE_DIR
	if (!UPLOAD_ID.test(id)) return undefined
	const dir = join(UPLOADS_DIR, id)
	return hasData(dir) ? dir : undefined
}

export function listDatasets(): DatasetInfo[] {
	const fallback = defaultId()
	const list: DatasetInfo[] = []
	if (hasData(einsteinDir())) list.push(builtIn("einstein", "EINSTEIN dataset", fallback))
	list.push(builtIn("fixture", "Test fixture", fallback))
	if (existsSync(UPLOADS_DIR)) {
		const found = readdirSync(UPLOADS_DIR)
			.filter((id) => UPLOAD_ID.test(id) && hasData(join(UPLOADS_DIR, id)))
			.map((id) => uploadInfo(id))
			.filter((info): info is DatasetInfo => Boolean(info))
			.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
		list.push(...found)
	}
	return list
}

function builtIn(id: "einstein" | "fixture", name: string, fallback: string): DatasetInfo {
	return { id, name, kind: id, counts: counts(load(id, datasetDir(id)!)), default: id === fallback }
}

function uploadInfo(id: string): DatasetInfo | undefined {
	const dir = join(UPLOADS_DIR, id)
	const meta = readUploadMeta(dir)
	try {
		return {
			id,
			name: meta?.name ?? id,
			kind: "upload",
			counts: (meta?.counts as DatasetCounts | undefined) ?? counts(load(id, dir)),
			default: false,
			createdAt: meta?.createdAt,
			renamed: meta?.renamed ?? {},
			warnings: meta?.warnings ?? [],
		}
	} catch {
		return undefined
	}
}

function counts(data: Dataset): DatasetCounts {
	return {
		researchers: data.researchers.size,
		publications: data.publications.size,
		projects: data.projects.size,
		patents: data.patents.size,
		companies: data.companies.size,
		challenges: data.challenges.size,
	}
}

export function listCompanies(id: string): CompanyInfo[] | undefined {
	const dir = datasetDir(id)
	if (!dir) return undefined
	const data = load(id, dir)
	return [...data.companies.values()].map((company) => ({
		id: company.id,
		name: company.name,
		sector: company.sector,
		challenges: company.challenges.map((challengeId) => ({ id: challengeId, text: data.challenges.get(challengeId)?.text ?? "" })),
	}))
}

/**
 * Save your own files as a dataset: read them leniently (src/data/import.ts), write them in the dataset's format,
 * and load them once to be sure a run can. Throws with a reason a person can act on.
 */
export function saveUpload(name: string, files: ImportFile[]): DatasetInfo {
	const label = name.trim().slice(0, 80) || "Your data"
	const { raw, renamed, warnings } = importFiles(files)
	const id = freeId(label)
	const dir = join(UPLOADS_DIR, id)
	uploads.delete(id)
	try {
		writeRaw(dir, raw, `Uploaded as "${label}" on ${new Date().toISOString()}. Read by Entangle's importer.`)
		// Load it once here, as a run will, so a file that cannot be read fails now and not in a run.
		const data = load(id, dir)
		const meta: UploadMeta = { name: label, createdAt: new Date().toISOString(), counts: { ...counts(data) }, renamed, warnings }
		writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2) + "\n")
	} catch (error) {
		uploads.delete(id)
		rmSync(dir, { recursive: true, force: true })
		throw error
	}
	return uploadInfo(id)!
}

export function deleteUpload(id: string): boolean {
	if (!UPLOAD_ID.test(id) || id === "einstein" || id === "fixture") return false
	const dir = resolve(UPLOADS_DIR, id)
	if (!existsSync(dir)) return false
	rmSync(dir, { recursive: true, force: true })
	uploads.delete(id)
	return true
}

function freeId(label: string): string {
	const base =
		label
			.normalize("NFKD")
			.replace(/[̀-ͯ]/g, "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 40) || "data"
	const safe = base === "einstein" || base === "fixture" ? `${base}-upload` : base
	let id = safe
	for (let n = 2; existsSync(join(UPLOADS_DIR, id)); n++) id = `${safe}-${n}`
	return id
}
