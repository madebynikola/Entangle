import { existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { SourceRecord, SourceStore } from "../types"
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
			if (sources) console.log(`  dataset loaded in ${Date.now() - started} ms`)
			return sources
		} catch (error) {
			console.log(`  dataset not loaded (${firstLine(error)}); sources come from each run's sources.json`)
			return null
		}
	})()
	return store
}

/** Look up one id: the run's sources.json first, then the dataset. */
export async function findSource(id: string, runDir?: string): Promise<SourceRecord | undefined> {
	if (runDir) {
		const own = runSources(runDir)?.[id]
		if (own) return own
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
	const dataset = await datasetSources()
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
