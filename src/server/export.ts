/**
 * Second half of `npm run build`: copy runs into the static build, so it can be hosted with no server.
 *
 *   npm run build                         every finished, non-mock run in out/
 *   npm run build -- out/golden out/x     exactly these run folders
 *
 * Writes web/dist/runs/index.json (RunInfo[]), web/dist/runs/<id>/{trace.jsonl,results.json,sources.json}
 * and web/dist/api/health ({ ok: false }, so the app knows it has no server).
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"
import type { RunInfo } from "./api"
import { readResults, RunRegistry } from "./runs"
import { collectRunSources } from "./sources"

const ROOT = resolve(import.meta.dirname, "../..")

async function main(): Promise<void> {
	const { positionals } = parseArgs({ allowPositionals: true })
	const dist = resolve(ROOT, "web/dist")
	if (!existsSync(join(dist, "index.html"))) throw new Error(`No build in web/dist. Run \`vite build\` first.`)

	const registry = new RunRegistry(resolve(ROOT, "out"))
	const ids = positionals.length
		? positionals.map((folder) => registry.add(folder))
		: registry
				.list()
				.filter((run) => run.status === "ended" && !run.mock)
				.map((run) => run.id)

	const index: RunInfo[] = []
	for (const id of ids) {
		const dir = registry.dir(id)!
		const target = join(dist, "runs", id)
		mkdirSync(target, { recursive: true })
		copyFileSync(join(dir, "trace.jsonl"), join(target, "trace.jsonl"))
		writeFileSync(join(target, "results.json"), JSON.stringify(readResults(dir)))
		const sources = await collectRunSources(dir)
		writeFileSync(join(target, "sources.json"), JSON.stringify(sources))
		const info = registry.info(id)!
		index.push({ ...info, status: "ended", has: { summary: info.has.summary, results: true, sources: true } })
		console.log(`  runs/${id}  ${Object.keys(sources).length} sources`)
	}
	mkdirSync(join(dist, "runs"), { recursive: true })
	writeFileSync(join(dist, "runs/index.json"), JSON.stringify(index))
	// The app asks api/health first; this file tells it there is no server here.
	mkdirSync(join(dist, "api"), { recursive: true })
	writeFileSync(join(dist, "api/health"), JSON.stringify({ ok: false }))
	if (!ids.length) console.log(`  No finished, non-mock runs in out/. The build has the sample run only.`)
	console.log(`  Static build in web/dist with ${ids.length} run(s). Host the folder as is.`)
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error)
	process.exit(1)
})
