import { existsSync } from "node:fs"
import { parseArgs } from "node:util"
import { createOrchestrator, writeRun, type RunSummary } from "./agents/orchestrator"
import { DATA_DIR, FIXTURE_DIR, loadDataset, type Dataset } from "./data"
import { join, localClaude, startRuntime } from "./runtime"
import { createTraceObserver } from "./trace"

const USAGE = `Usage: npm run match -- [--mock | --local] [--companies N | all] [--ids C006,C054] [options]

  --mock          Run on the mock model: fake latency, no API keys, no cost.
  --local         Run every model call as a local Claude Code session on your own login, no API key
                  (same as LOCAL_CLAUDE=1 in .env). Needs the \`claude\` CLI, logged in.
  --companies N   How many companies to work on, from the first; \`all\` for every one (default 5).
  --ids LIST      Exactly these companies, comma-separated.
  --analysts N    Industry Analysts (default 4).
  --profilers N   Research Profilers (default 6).
  --writers N     Proposal Writers (default 3).
  --k N           Researchers shortlisted per challenge (default 4).
  --proposals N   Most proposals in the run (default: one per company).

Models per role are in config/models.ts; MODEL_<ROLE> in .env pins one, e.g. MODEL_WRITER=claude-sonnet-5-5.
Limits: BUDGET_USD, BUDGET_MINUTES and BUDGET_TOKENS in .env.`

const KEY_VARS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"]

async function main(): Promise<void> {
	try {
		process.loadEnvFile()
	} catch {
		// No .env: keys come from the shell.
	}

	const { values } = parseArgs({
		options: {
			mock: { type: "boolean", default: false },
			local: { type: "boolean", default: false },
			companies: { type: "string", default: "5" },
			ids: { type: "string" },
			analysts: { type: "string", default: "4" },
			profilers: { type: "string", default: "6" },
			writers: { type: "string", default: "3" },
			k: { type: "string", default: "4" },
			proposals: { type: "string" },
			help: { type: "boolean", short: "h", default: false },
		},
	})
	if (values.help) {
		console.log(USAGE)
		return
	}
	if (values.local) process.env.LOCAL_CLAUDE = "1"
	if (!values.mock && !localClaude() && !KEY_VARS.some((name) => process.env[name])) {
		throw new Error(`No API key set (${KEY_VARS.join(", ")}). Add one to .env, run with --local to use your Claude login, or run with --mock.`)
	}

	// A fresh clone has no data/raw/: the run then uses the test fixtures (5 companies).
	const dataDir = process.env.EINSTEIN_DATA_DIR || (existsSync(DATA_DIR) ? DATA_DIR : FIXTURE_DIR)
	const data = loadDataset(dataDir)
	const companyIds = pickCompanies(data, values.companies, values.ids)

	const runId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + (values.mock ? "-mock" : "")
	const state = startRuntime({ runId, mock: values.mock })
	const trace = createTraceObserver("out")
	join(trace.participant)

	// A failed model call fails its task; this only catches loops that have no task.
	process.on("unhandledRejection", (error) => console.error("[loop error]", error))
	quietRepeatedNotices()

	const orchestrator = createOrchestrator({
		data,
		analysts: count("--analysts", values.analysts),
		profilers: count("--profilers", values.profilers),
		writers: count("--writers", values.writers),
		k: count("--k", values.k),
		maxProposals: values.proposals ? count("--proposals", values.proposals) : undefined,
		mockPlantFakeClaims: state.mock,
		log: (line) => console.log(line),
	})

	const backend = state.mock ? "mock" : localClaude() ? "local Claude Code" : "API"
	console.log(`run ${runId} · ${backend} · ${companyIds.length} companies`)
	if (dataDir === FIXTURE_DIR) console.log(`  no data/raw/: using the test fixtures`)
	const outcome = await orchestrator.run(companyIds)
	const summary = writeRun(trace.dir, outcome, orchestrator.critic.stats(), data.sources)
	await trace.close()
	report(summary, trace.dir)
}

function pickCompanies(data: Dataset, companies: string, ids: string | undefined): string[] {
	if (ids) {
		const list = ids.split(",").map((id) => id.trim()).filter(Boolean)
		for (const id of list) if (!data.companies.has(id)) throw new Error(`Unknown company ${id}`)
		return list
	}
	const all = [...data.companies.keys()]
	return companies === "all" ? all : all.slice(0, count("--companies", companies))
}

function count(flag: string, raw: string): number {
	const n = Number(raw)
	if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} must be a positive integer`)
	return n
}

function report(summary: RunSummary, dir: string): void {
	const { budget, counts, critic, failures } = summary
	const price = summary.mock ? " (simulated)" : localClaude() ? " at API prices" : ""
	console.log(`\ndone in ${duration(summary.durationMs)} · ${budget.tokensUsed.toLocaleString("en")} tokens · $${budget.costUsd.toFixed(2)}${price}`)
	console.log(
		`${summary.companies.length} companies · ${counts.needs} needs · ${counts.profiles} profiles · ${counts.pairs} pairs · ` +
			`${counts.proposals} proposals accepted · ${counts.needsHuman} need human review · ${counts.noMatches} no match`,
	)
	console.log(
		`critic: ${critic.reviews} reviews · ${critic.sentBack} sent back · ${critic.dropped} dropped · ${critic.escalated} escalated · ` +
			`${critic.splits} splits · ${critic.rejectedClaims} claims rejected`,
	)
	if (summary.needsHuman.length) console.log(`needs human review: ${summary.needsHuman.join(", ")}`)
	if (failures.length) {
		console.log(`failed tasks: ${failures.length}`)
		for (const failure of failures.slice(0, 8)) console.log(`  ${failure.taskId.padEnd(12)} ${(failure.subjectId ?? "").padEnd(16)} ${failure.error?.slice(0, 100) ?? ""}`)
	}
	console.log(`out: ${dir}`)
}

function duration(ms: number): string {
	const s = Math.round(ms / 1000)
	return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`
}

/**
 * Mozaik Cloud warns once per loop when it has no key, and with a key it prints a live link per loop.
 * Show each warning once, and only the first link.
 */
function quietRepeatedNotices(): void {
	const seen = new Set<string>()
	const warn = console.warn
	console.warn = (...args: unknown[]) => {
		const key = String(args[0])
		if (seen.has(key)) return
		seen.add(key)
		warn(...args)
	}
	const log = console.log
	let linked = false
	console.log = (...args: unknown[]) => {
		if (String(args[0]).startsWith("▶ mozaik cloud")) {
			if (linked) return
			linked = true
		}
		log(...args)
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error)
	process.exit(1)
})
