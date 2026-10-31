import { existsSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { loadDataset } from "../data/dataset"
import type { SourceRecord, SourceStore } from "../types"
import { note } from "./log"
import { citedIds, readJson, readResults } from "./runs"

let store: Promise<SourceStore | null> | undefined

/**
 * The dataset's SourceStore from src/data/, loaded once in the background.
 * Null when the dataset is not on this machine (a fresh clone has no data/raw/): replays then use the run's sources.json.
 */
export function datasetSources(): Promise<SourceStore | null> {
	store ??= (async () => {
		// A variable path, so the server still type-checks and starts without the data layer.
		const path = "../data/index.ts"
		try {
			const data = (await import(path)) as { loadDataset?: () => { sources: SourceStore } }
			const started = Date.now()
			const sources = data.loadDataset?.().sources ?? null
			if (sources) note(`Dataset loaded in ${Date.now() - started} ms. Source lookups now cover every record.`)
			return sources
		} catch (error) {
			note(`No dataset here (${firstLine(error)}). Sources come from each run's sources.json.`)
			return null
		}
	})()
	return store
}

const ROOT = resolve(import.meta.dirname, "../..")

/**
 * The data a run read when it was not the EINSTEIN dataset (its `dataset.json`): the fixture or your own upload.
 * Null when that folder is gone. Undefined for runs on the EINSTEIN dataset.
 */
function runDataSources(runDir: string): SourceStore | null | undefined {
	const label = readJson<{ dir?: string }>(join(runDir, "dataset.json"))
	if (!label?.dir) return undefined
	const dir = resolve(ROOT, label.dir)
	if (!existsSync(join(dir, "researchers.json"))) return null
	try {
		return loadDataset(dir).sources
	} catch {
		return null
	}
}

/** Look up one id: the run's sources.json first, then the data the run read (the EINSTEIN dataset unless it says otherwise). */
export async function findSource(id: string, runDir?: string): Promise<SourceRecord | undefined> {
	if (runDir) {
		const own = runSources(runDir)?.[id]
		if (own) return own
		// Ids repeat across datasets (R0001 is someone else in your data): never answer from the EINSTEIN set here.
		const other = runDataSources(runDir)
		if (other !== undefined) return other?.get(id)
	}
	return (await datasetSources())?.get(id)
}

export function runSources(runDir: string): Record<string, SourceRecord> | undefined {
	return readJson<Record<string, SourceRecord>>(join(runDir, "sources.json"))
}

/**
 * Every source the run cites, keyed by id. Writes `sources.json` into the run folder when it is missing
 * and the dataset is here, so the run can be replayed (and hosted) without the dataset.
 */
export async function collectRunSources(runDir: string): Promise<Record<string, SourceRecord>> {
	const own = runSources(runDir)
	if (own) return own
	const other = runDataSources(runDir)
	const dataset = other === undefined ? await datasetSources() : other
	if (!dataset) return {}
	const sources: Record<string, SourceRecord> = {}
	for (const id of citedIds(readResults(runDir))) {
		const record = dataset.get(id)
		if (record) sources[id] = record
	}
	if (Object.keys(sources).length && !existsSync(join(runDir, "sources.json"))) {
		writeFileSync(join(runDir, "sources.json"), JSON.stringify(sources, null, "\t") + "\n")
	}
	return sources
}

function firstLine(error: unknown): string {
	return String(error instanceof Error ? error.message : error).split("\n")[0]
}
