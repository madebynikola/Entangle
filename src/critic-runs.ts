import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join as joinPath } from "node:path"
import { parseArgs } from "node:util"
import { checkByCode, claimsOf, FakeSourceStore } from "./agents/critic"
import type { MatchState } from "./runtime"
import type { ArtifactKind, CompanyNeed, PairCandidate, Proposal, ResearcherProfile, SourceRecord } from "./types"

const USAGE = `Usage: npm run critic:runs -- [--summary] [run-dir ...]

Runs the Critic's code checks (checkByCode) on every need, profile, pair and proposal (the escalated ones too) in the results of past runs: every
real run in out/ that has results.json and sources.json, or only the run dirs you name. It prints each claim that the
uncited-detail or misquote check rejects, then a total per run and over all runs. No model runs: it costs nothing and gives the same
answer each time, so it measures a change to the code checks on the claims of real runs.

  --summary   Print only the totals, not each rejected claim.

A mock run is left out, and so is a copy of a run already counted (out/golden is a copy of the run in its summary.json).`

const OUT = "out"
const KINDS: ArtifactKind[] = ["need", "profile", "pair", "proposal"]

interface Results {
	needs: CompanyNeed[]
	profiles: ResearcherProfile[]
	pairs: PairCandidate[]
	proposals: Proposal[]
	/** Proposals that the Critic escalated to a human. */
	needsHuman?: Proposal[]
}

interface Tally {
	claims: number
	rejected: number
	byCheck: Map<string, number>
}

/** The checks whose rejects are printed one by one: the word checks, whose false rejects a change can bring. */
const PRINTED = new Set(["uncited-detail", "misquote"])

const tally = (): Tally => ({ claims: 0, rejected: 0, byCheck: new Map() })

function readJson<T>(dir: string, file: string): T | undefined {
	const path = joinPath(dir, file)
	return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : undefined
}

/** The run dirs to check: those named, or every real run of out/ that has both files, each run once. */
function runDirs(named: string[]): string[] {
	if (named.length) return named
	const seen = new Set<string>()
	const dirs: string[] = []
	for (const name of readdirSync(OUT).sort()) {
		const dir = joinPath(OUT, name)
		if (!existsSync(joinPath(dir, "results.json")) || !existsSync(joinPath(dir, "sources.json"))) continue
		const summary = readJson<{ runId?: string; mock?: boolean }>(dir, "summary.json")
		if (summary?.mock ?? name.endsWith("-mock")) continue
		const runId = summary?.runId ?? name
		if (seen.has(runId)) continue
		seen.add(runId)
		dirs.push(dir)
	}
	return dirs
}

function checkRun(dir: string, summaryOnly: boolean): Tally {
	const results = readJson<Results>(dir, "results.json")
	const sources = readJson<Record<string, SourceRecord>>(dir, "sources.json")
	if (!results || !sources) throw new Error(`${dir} has no results.json and sources.json.`)
	const store = new FakeSourceStore(Object.values(sources))
	// checkByCode reads only the profiles and pairs of the blackboard, to find the pair of a proposal and its researcher.
	const s = {
		profiles: new Map((results.profiles ?? []).map((profile) => [profile.researcherId, profile])),
		candidates: new Map((results.pairs ?? []).map((pair) => [pair.id, pair])),
	} as unknown as MatchState
	const artifacts: Record<ArtifactKind, Array<{ id: string; artifact: CompanyNeed | ResearcherProfile | PairCandidate | Proposal }>> = {
		need: (results.needs ?? []).map((artifact) => ({ id: artifact.challengeId, artifact })),
		profile: (results.profiles ?? []).map((artifact) => ({ id: artifact.researcherId, artifact })),
		pair: (results.pairs ?? []).map((artifact) => ({ id: artifact.id, artifact })),
		proposal: [...(results.proposals ?? []), ...(results.needsHuman ?? [])].map((artifact) => ({ id: artifact.id, artifact })),
	}

	const total = tally()
	for (const kind of KINDS) {
		for (const { id, artifact } of artifacts[kind]) {
			total.claims += claimsOf(kind, artifact).length
			for (const { claim, reason, check = "other" } of checkByCode(kind, artifact, s, store).rejected) {
				total.rejected++
				total.byCheck.set(check, (total.byCheck.get(check) ?? 0) + 1)
				if (PRINTED.has(check) && !summaryOnly) {
					console.log(`  ${kind} ${id}: ${claim.text.trim()} [${claim.sourceIds.join(", ")}]\n    ${reason}`)
				}
			}
		}
	}
	return total
}

function describe({ claims, rejected, byCheck }: Tally): string {
	const rest = [...byCheck].filter(([check]) => check !== "uncited-detail").map(([check, n]) => `${n} ${check}`)
	const uncited = byCheck.get("uncited-detail") ?? 0
	return `${claims} claims, ${uncited} uncited-detail rejects${rest.length ? `, ${rest.join(", ")}` : ""} (${rejected} rejects in all)`
}

function main(): void {
	const { values, positionals } = parseArgs({
		options: {
			summary: { type: "boolean", default: false },
			help: { type: "boolean", short: "h", default: false },
		},
		allowPositionals: true,
	})
	if (values.help) {
		console.log(USAGE)
		return
	}

	const dirs = runDirs(positionals)
	if (!dirs.length) throw new Error(`No real run with results.json and sources.json in ${OUT}/.`)
	const all = tally()
	for (const dir of dirs) {
		const run = checkRun(dir, values.summary)
		console.log(`${dir}: ${describe(run)}\n`)
		all.claims += run.claims
		all.rejected += run.rejected
		for (const [check, n] of run.byCheck) all.byCheck.set(check, (all.byCheck.get(check) ?? 0) + n)
	}
	console.log(`${dirs.length} runs: ${describe(all)}`)
}

try {
	main()
} catch (error) {
	console.error(error instanceof Error ? error.message : error)
	process.exit(1)
}
