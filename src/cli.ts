import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join as joinPath, relative, resolve } from "node:path"
import { parseArgs } from "node:util"
import { createOrchestrator, writeRun, type RunOutcome, type RunSummary } from "./agents/orchestrator"
import { DATA_DIR, FIXTURE_DIR, addProblem, loadDataset, problemError, type Dataset, type DescribedProblem } from "./data"
import { dataLabel } from "./data/import"
import { createOpenAlex } from "./data/openalex"
import { decisionEndpoint, join, localClaude, screen, screenSettings, startRuntime, subq, subqSettings } from "./runtime"
import { createTraceObserver } from "./trace"

const USAGE = `Usage: npm run match -- [--mock | --local] [--subq] [--screen] [--companies N | all | --ids C006,C054 | --problem TEXT] [options]

  --mock          Run on the mock model: fake latency, no API keys, no cost.
  --local         Run every model call as a local Claude Code session on your own login, no API key
                  (same as LOCAL_CLAUDE=1 in .env). Needs the \`claude\` CLI, logged in.
  --subq          Run the second Critic on a decision model, subq-snap-1.1 by default (same as SUBQ=1 in .env).
                  Needs SUBQ_API_KEY, or TYPESAFE_API_KEY for SUBQ_MODEL=jev-latest.
  --screen        Rate 8 candidates per need on the same decision model before profiling, and profile only the
                  2 most likely (same as SCREEN=1 in .env). Needs the same key as --subq.
  --companies N   How many companies to work on, from the first; \`all\` for every one (default 5).
  --ids LIST      Exactly these companies, comma-separated.
  --problem TEXT  Reverse search: a company describes one problem in its own words, and the run finds researchers
                  for it instead of reading dataset companies. Say what is wrong, what you tried and what you have.
  --sector TEXT   With --problem: the company's sector, if you want the Funding Scout to search it too.
  --data DIR      Read this dataset folder instead of data/raw/data: your own data in the dataset's format,
                  such as an upload from the app's New run screen (data/uploads/<name>). Same as EINSTEIN_DATA_DIR.
  --analysts N    Industry Analysts (default 4).
  --profilers N   Research Profilers (default 6).
  --writers N     Proposal Writers (default 3).
  --k N           Researchers shortlisted per challenge (default 4, 2 with --screen, 6 with --problem).
  --proposals N   Most proposals in the run (default: one per company).

Models per role are in config/models.ts; MODEL_<ROLE> in .env pins one, e.g. MODEL_CRITIC=claude-haiku-4-5.
Limits: BUDGET_USD, BUDGET_MINUTES and BUDGET_TOKENS in .env.
With OPENALEX_API_KEY in .env, each proposal gets a Prior work section of real works from OpenAlex (not in --mock).`

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
			subq: { type: "boolean", default: false },
			screen: { type: "boolean", default: false },
			companies: { type: "string", default: "5" },
			ids: { type: "string" },
			problem: { type: "string" },
			sector: { type: "string" },
			data: { type: "string" },
			analysts: { type: "string", default: "4" },
			profilers: { type: "string", default: "6" },
			writers: { type: "string", default: "3" },
			k: { type: "string" },
			proposals: { type: "string" },
			help: { type: "boolean", short: "h", default: false },
		},
	})
	if (values.help) {
		console.log(USAGE)
		return
	}
	if (values.local) process.env.LOCAL_CLAUDE = "1"
	if (values.subq) process.env.SUBQ = "1"
	if (values.screen) process.env.SCREEN = "1"
	if (!values.mock && subq()) checkDecisionModel("SUBQ", subqSettings().model)
	if (!values.mock && screen()) checkDecisionModel("SCREEN", screenSettings().model)
	if (!values.mock && !localClaude() && !KEY_VARS.some((name) => process.env[name])) {
		throw new Error(`No API key set (${KEY_VARS.join(", ")}). Add one to .env, run with --local to use your Claude login, or run with --mock.`)
	}

	// A fresh clone has no data/raw/: the run then uses the test fixtures (5 companies).
	const dataDir = values.data ? resolve(values.data) : process.env.EINSTEIN_DATA_DIR || (existsSync(DATA_DIR) ? DATA_DIR : FIXTURE_DIR)
	const data = loadDataset(dataDir)
	const problem = values.problem !== undefined ? describe(data, values.problem, values.sector, values.ids) : undefined
	const companyIds = problem ? [problem.companyId] : pickCompanies(data, values.companies, values.ids)

	const runId = claimRunId(new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19), values.mock ? "-mock" : "")
	const state = startRuntime({ runId, mock: values.mock })
	const trace = createTraceObserver("out")
	join(trace.participant)
	// The server and the web app read it to show the run as a reverse search, while it runs and after.
	if (problem) writeFileSync(joinPath(trace.dir, "problem.json"), JSON.stringify(problem, null, 2) + "\n")
	// A run on other data than the EINSTEIN dataset says which, so the app labels it and looks its sources up there.
	const label = dataLabel(dataDir)
	if (label) {
		const dir = relative(process.cwd(), dataDir)
		writeFileSync(joinPath(trace.dir, "dataset.json"), JSON.stringify({ ...label, dir: dir.startsWith("..") ? dataDir : dir }, null, 2) + "\n")
	}

	// A failed model call fails its task; this only catches loops that have no task.
	process.on("unhandledRejection", (error) => console.error("[loop error]", error))
	quietRepeatedNotices()

	// Real works on each need's topic, never a person's name. A mock run stays offline.
	const openAlexKey = process.env.OPENALEX_API_KEY
	const openAlex = !state.mock && openAlexKey ? createOpenAlex({ apiKey: openAlexKey }) : undefined
	const orchestrator = createOrchestrator({
		data,
		analysts: count("--analysts", values.analysts),
		profilers: count("--profilers", values.profilers),
		writers: count("--writers", values.writers),
		k: count("--k", values.k ?? String(problem ? 6 : screen() ? screenSettings().k : 4)),
		maxProposals: values.proposals ? count("--proposals", values.proposals) : undefined,
		mockPlantFakeClaims: state.mock,
		openAlex,
		log: (line) => console.log(line),
	})

	const backend =
		(state.mock ? "mock" : localClaude() ? "local Claude Code" : "API") +
		(subq() ? ` · critic-2 on ${subqSettings().model}` : "") +
		(screen() ? ` · shortlist filter on ${screenSettings().model}` : "") +
		(openAlex ? " · prior work from OpenAlex" : "")
	console.log(`run ${runId} · ${backend} · ${problem ? `reverse search on ${problem.challengeId}` : `${companyIds.length} companies`}`)
	if (label?.kind === "upload") console.log(`  your data: ${label.name} (${relative(process.cwd(), dataDir)})`)
	else if (dataDir === FIXTURE_DIR) console.log(values.data ? `  data: the test fixtures` : `  no data/raw/: using the test fixtures`)
	const outcome = await orchestrator.run(companyIds)
	const summary = writeRun(trace.dir, outcome, orchestrator.critic.stats(), orchestrator.sources)
	await trace.close()
	report(summary, trace.dir)
	if (problem) reportProblem(problem, outcome)
}

/**
 * The run's folder name, made in out/ at once: two runs started in the same second (two clicks in the app) would
 * otherwise write one trace. The second gets `-2` before the `-mock` ending that marks mock runs.
 */
function claimRunId(stamp: string, ending: string): string {
	mkdirSync("out", { recursive: true })
	for (let n = 1; ; n++) {
		const id = `${stamp}${n > 1 ? `-${n}` : ""}${ending}`
		try {
			mkdirSync(joinPath("out", id))
			return id
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
		}
	}
}

/** Add the described problem to the dataset as company C999. It needs no dataset company, so --ids cannot join it. */
function describe(data: Dataset, text: string, sector: string | undefined, ids: string | undefined): DescribedProblem {
	if (ids) throw new Error("Use --problem or --ids, not both: a reverse search works on the described problem alone.")
	const error = problemError(text)
	if (error) throw new Error(error)
	return addProblem(data, { text, sector })
}

/** The answer to a reverse search: who fits the problem, best fit first, with the first reason for each. */
function reportProblem(problem: DescribedProblem, outcome: RunOutcome): void {
	const need = outcome.needs.find((n) => n.challengeId === problem.challengeId)
	const noMatch = outcome.noMatches.find((n) => n.challengeId === problem.challengeId)
	const pairs = outcome.pairs.filter((pair) => pair.challengeId === problem.challengeId).sort((a, b) => b.fit - a.fit)
	const profiles = new Map(outcome.profiles.map((profile) => [profile.researcherId, profile]))
	console.log(`\nreverse search · ${problem.challengeId}${need ? ` · triage: ${need.triage}` : ""}`)
	if (need?.triage && need.triage !== "research" && need.triageReason) console.log(`  ${need.triageReason}`)
	if (!pairs.length) {
		console.log(`  no researcher passed the Critic${noMatch ? `: ${noMatch.reason}` : ""}`)
		return
	}
	for (const pair of pairs) {
		const profile = profiles.get(pair.researcherId)
		const who = profile ? `${profile.name}, ${profile.title}, ${profile.faculty}` : pair.researcherId
		const chosen = outcome.chosen.includes(pair.id) ? " · proposal" : ""
		console.log(`  ${pair.researcherId}  fit ${pair.fit.toFixed(2)}  ${who}${chosen}`)
		// The researcher's side of the evidence says most about why them; the problem's side is the same for every pair.
		const why = pair.why.find((claim) => claim.sourceIds.some((id) => !id.startsWith(problem.companyId))) ?? pair.why[0]
		if (why) console.log(`         ${why.text}`)
	}
	console.log(`  Pairs, not people: each fit is for this problem only. A coordinator approves a pair before anyone is contacted.`)
}

/** A switch that puts a role on a decision model needs that model's key. */
function checkDecisionModel(name: string, model: string): void {
	const decision = decisionEndpoint(model)
	if (decision?.apiKey) return
	const need = decision ? `${decision.keyVar} is not set` : `${model} is not a decision model (subq-snap-*, jev-*)`
	throw new Error(`${name} is on but ${need}. Fix .env, or run with --mock.`)
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
			`${critic.splits} splits · ${critic.rejectedClaims} claims rejected` +
			(critic.trimmed ? ` · ${critic.trimmed} kept after cutting a claim` : ""),
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
