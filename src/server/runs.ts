import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import type { Claim, CriticVerdict, Proposal, Task } from "../types"
import type { ApprovalBody, Approvals, RunInfo, RunResults, RunStatus } from "./api"

/** A run with no summary and no trace writes for this long is "stalled", not live. */
const STALL_MS = 2 * 60_000

/**
 * Every run folder the server knows: each folder in `out/` that has a trace.jsonl,
 * plus folders added on the command line (`npm run replay -- some/dir`).
 * A run's id is its folder name.
 */
export class RunRegistry {
	private readonly extra = new Map<string, string>()
	/** Runs this server started that are still running. */
	private readonly running = new Set<string>()
	private readonly cache = new Map<string, { key: string; info: RunInfo }>()

	constructor(readonly outDir: string) {}

	/** Add a run folder outside `out/`. Returns its id. */
	add(dir: string): string {
		const abs = resolve(dir)
		if (!existsSync(join(abs, "trace.jsonl"))) throw new Error(`${dir} has no trace.jsonl`)
		const id = basename(abs)
		this.extra.set(id, abs)
		return id
	}

	markRunning(id: string, running: boolean): void {
		if (running) this.running.add(id)
		else this.running.delete(id)
		this.cache.delete(id)
	}

	dirs(): Map<string, string> {
		const dirs = new Map<string, string>()
		if (existsSync(this.outDir)) {
			for (const name of readdirSync(this.outDir)) {
				const dir = join(this.outDir, name)
				if (name !== "tmp" && existsSync(join(dir, "trace.jsonl"))) dirs.set(name, dir)
			}
		}
		for (const [id, dir] of this.extra) dirs.set(id, dir)
		return dirs
	}

	dir(id: string): string | undefined {
		return this.extra.get(id) ?? this.dirs().get(id)
	}

	list(): RunInfo[] {
		const runs: RunInfo[] = []
		for (const id of this.dirs().keys()) {
			const info = this.info(id)
			if (info) runs.push(info)
		}
		return runs.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""))
	}

	status(id: string): RunStatus {
		const dir = this.dir(id)
		if (!dir) return "ended"
		if (existsSync(join(dir, "summary.json"))) return "ended"
		if (this.running.has(id)) return "live"
		const mtime = statSync(join(dir, "trace.jsonl")).mtimeMs
		return Date.now() - mtime < STALL_MS ? "live" : "stalled"
	}

	info(id: string): RunInfo | undefined {
		const dir = this.dir(id)
		if (!dir) return undefined
		const trace = statSync(join(dir, "trace.jsonl"))
		const status = this.status(id)
		const key = `${trace.size}:${trace.mtimeMs}:${status}`
		const cached = this.cache.get(id)
		if (cached?.key === key) return cached.info

		const summary = readJson<Summary>(join(dir, "summary.json"))
		const first = parseLine(firstLine(join(dir, "trace.jsonl")))
		const last = parseLine(lastLine(join(dir, "trace.jsonl")))
		const tasks = summary?.tasks ?? []
		const info: RunInfo = {
			id,
			status,
			mock: summary?.mock ?? id.endsWith("-mock"),
			startedAt: first?.t ?? (summary ? new Date(summary.budget.startedAt).toISOString() : null),
			durationMs: last?.ms ?? null,
			tokens: summary?.budget.tokensUsed ?? 0,
			costUsd: summary?.budget.costUsd ?? 0,
			tasks: {
				total: tasks.length,
				done: tasks.filter((t) => t.status === "done").length,
				failed: tasks.filter((t) => t.status === "failed").length,
			},
			has: {
				summary: Boolean(summary),
				results: existsSync(join(dir, "results.json")),
				sources: existsSync(join(dir, "sources.json")),
			},
		}
		this.cache.set(id, { key, info })
		return info
	}
}

interface Summary {
	runId: string
	mock: boolean
	budget: { tokensUsed: number; costUsd: number; startedAt: number }
	tasks?: Task[]
	[key: string]: unknown
}

/**
 * The run's results, from `results.json` when the run wrote one, else pieced together
 * from the separate files and summary.json fields. Missing parts are empty.
 */
export function readResults(dir: string): RunResults {
	const read = (name: string) => readJson<unknown>(join(dir, name))
	const results = read("results.json") as Partial<RunResults> | undefined
	const summary = read("summary.json") as Record<string, unknown> | undefined
	const pairs = read("pairs.json")
	const pick = <T>(key: keyof RunResults, file: unknown, summaryKey: string = key): T[] =>
		(results?.[key] as T[] | undefined) ?? listOf<T>(file, key) ?? listOf<T>(summary?.[summaryKey]) ?? []

	return {
		needs: pick("needs", read("needs.json")),
		profiles: pick("profiles", read("profiles.json")),
		pairs: pick("pairs", pairs, "candidates"),
		// pairs.json may be a bare PairCandidate[]: then it has no noMatches.
		noMatches: pick("noMatches", Array.isArray(pairs) ? undefined : pairs),
		proposals: (() => {
			const found = pick<Proposal>("proposals", read("proposals.json"))
			return found.length ? found : markdownProposals(dir)
		})(),
		verdicts: (() => {
			const found = pick<CriticVerdict>("verdicts", read("verdicts.json"))
			return found.length ? found : traceVerdicts(dir)
		})(),
		approvals: results?.approvals ?? readApprovals(dir),
	}
}

export function readApprovals(dir: string): Approvals {
	return readJson<Approvals>(join(dir, "approvals.json")) ?? {}
}

export function writeApproval(dir: string, body: ApprovalBody): Approvals {
	const approvals = readApprovals(dir)
	if (body.decision === null) delete approvals[body.pairId]
	else {
		approvals[body.pairId] = {
			pairId: body.pairId,
			decision: body.decision,
			note: body.note?.trim() || undefined,
			decidedAt: new Date().toISOString(),
		}
	}
	writeFileSync(join(dir, "approvals.json"), JSON.stringify(approvals, null, 2) + "\n")
	return approvals
}

/** Every dataset id the run's results cite or are about. */
export function citedIds(results: RunResults): string[] {
	const ids = new Set<string>()
	const claims = (list: (Claim | null | undefined)[]) => {
		for (const claim of list) for (const id of claim?.sourceIds ?? []) ids.add(id)
	}
	for (const need of results.needs) {
		ids.add(need.challengeId).add(need.companyId)
		claims([need.restatement, ...need.assets, ...need.constraints])
	}
	for (const profile of results.profiles) {
		ids.add(profile.researcherId)
		claims([...profile.expertise, ...profile.industryFit, profile.availability])
	}
	for (const pair of results.pairs) {
		ids.add(pair.challengeId).add(pair.researcherId)
		claims([...pair.why, pair.problem, ...pair.risks])
	}
	for (const proposal of results.proposals) claims(proposal.claims)
	for (const verdict of results.verdicts) claims(verdict.rejected.map((r) => r.claim))
	ids.delete("")
	return [...ids].sort()
}

/** Reads a growing NDJSON file line by line: each read() returns the complete lines added since the last one. */
export class LineReader {
	private position = 0
	private rest = ""

	constructor(readonly path: string) {}

	read(): string[] {
		if (!existsSync(this.path)) return []
		const size = statSync(this.path).size
		if (size < this.position) {
			// Truncated or replaced: start over.
			this.position = 0
			this.rest = ""
		}
		if (size === this.position) return []
		const buffer = Buffer.alloc(size - this.position)
		const fd = openSync(this.path, "r")
		try {
			readSync(fd, buffer, 0, buffer.length, this.position)
		} finally {
			closeSync(fd)
		}
		this.position = size
		const lines = (this.rest + buffer.toString("utf8")).split("\n")
		this.rest = lines.pop() ?? ""
		return lines.filter((line) => line.trim())
	}
}

/** The Critic's verdicts on proposals, from `critic.verdict` events in the trace. */
function traceVerdicts(dir: string): CriticVerdict[] {
	const path = join(dir, "trace.jsonl")
	if (!existsSync(path)) return []
	const verdicts: CriticVerdict[] = []
	for (const line of readFileSync(path, "utf8").split("\n")) {
		if (!line.includes('"critic.verdict"')) continue
		const record = parseRecord(line)
		const data = record?.data as { kind?: string; id?: string; revision?: number; ok?: boolean; rejected?: CriticVerdict["rejected"] } | undefined
		if (record?.kind !== "critic.verdict" || data?.kind !== "proposal" || !data.id) continue
		verdicts.push({ proposalId: data.id, revision: data.revision ?? 0, ok: Boolean(data.ok), rejected: data.rejected ?? [] })
	}
	return verdicts
}

function parseRecord(line: string): { kind?: string; data?: unknown } | undefined {
	try {
		return JSON.parse(line)
	} catch {
		return undefined
	}
}

function markdownProposals(dir: string): Proposal[] {
	const folder = join(dir, "proposals")
	if (!existsSync(folder)) return []
	return readdirSync(folder)
		.filter((name) => name.endsWith(".md"))
		.sort()
		.map((name) => {
			const markdown = readFileSync(join(folder, name), "utf8")
			const id = name.replace(/\.md$/, "")
			return {
				id,
				// `C001-CH1-R1008.md` is the proposal for pair `C001-CH1:R1008`.
				pairId: id.replace(/^(C\d+-CH\d+)-(R\d+)$/, "$1:$2"),
				kind: /\bphd\b/i.test(markdown) ? "industrial-phd" : "joint-project",
				title: markdown.match(/^#+\s+(.+)$/m)?.[1]?.trim() ?? name,
				markdown,
				claims: [],
				revision: 0,
			}
		})
}

/** An array, an object's `key` array, or an object of records keyed by id. */
function listOf<T>(value: unknown, key?: string): T[] | undefined {
	if (Array.isArray(value)) return value as T[]
	if (!value || typeof value !== "object") return undefined
	if (key) {
		const inner = (value as Record<string, unknown>)[key]
		return Array.isArray(inner) ? (inner as T[]) : undefined
	}
	const values = Object.values(value)
	return values.every((v) => v && typeof v === "object") ? (values as T[]) : undefined
}

export function readJson<T>(path: string): T | undefined {
	if (!existsSync(path)) return undefined
	try {
		return JSON.parse(readFileSync(path, "utf8")) as T
	} catch {
		return undefined
	}
}

function firstLine(path: string): string {
	const fd = openSync(path, "r")
	try {
		const buffer = Buffer.alloc(8192)
		const n = readSync(fd, buffer, 0, buffer.length, 0)
		return buffer.toString("utf8", 0, n).split("\n")[0] ?? ""
	} finally {
		closeSync(fd)
	}
}

function lastLine(path: string): string {
	const size = statSync(path).size
	const length = Math.min(size, 64 * 1024)
	const fd = openSync(path, "r")
	try {
		const buffer = Buffer.alloc(length)
		readSync(fd, buffer, 0, length, size - length)
		const lines = buffer.toString("utf8").split("\n").filter((line) => line.trim())
		return lines.at(-1) ?? ""
	} finally {
		closeSync(fd)
	}
}

function parseLine(line: string): { t: string; ms: number } | undefined {
	try {
		return JSON.parse(line)
	} catch {
		return undefined
	}
}
