import { writeFileSync } from "node:fs"
import { join as joinPath } from "node:path"
import { parseArgs } from "node:util"
import { join, localClaude, startRuntime } from "./runtime"
import { runDemo } from "./runtime/demo"
import { createTraceObserver } from "./trace"

const USAGE = `Usage: npm run match -- [--mock | --local] [--companies N] [--model NAME]

  --mock          Run on the mock model: fake latency, no API keys, no cost.
  --local         Run every model call as a local Claude Code session on your own login, no API key
                  (same as LOCAL_CLAUDE=1 in .env). Needs the \`claude\` CLI, logged in.
  --companies N   How many companies to work on (default 3).
  --model NAME    Model for the agents (default claude-haiku-4-5).`

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
			companies: { type: "string", default: "3" },
			model: { type: "string", default: "claude-haiku-4-5" },
			help: { type: "boolean", short: "h", default: false },
		},
	})
	if (values.help) {
		console.log(USAGE)
		return
	}
	const companies = Number(values.companies)
	if (!Number.isInteger(companies) || companies < 1) throw new Error(`--companies must be a positive integer`)
	if (values.local) process.env.LOCAL_CLAUDE = "1"
	if (!values.mock && !localClaude() && !KEY_VARS.some((name) => process.env[name])) {
		throw new Error(`No API key set (${KEY_VARS.join(", ")}). Add one to .env, run with --local to use your Claude login, or run with --mock.`)
	}

	const runId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + (values.mock ? "-mock" : "")
	const state = startRuntime({ runId, mock: values.mock })
	const trace = createTraceObserver("out")
	join(trace.participant)

	// runLoop does not await its loop, so a failed model call surfaces here. Hardening (#9) adds retries.
	process.on("unhandledRejection", (error) => console.error("[loop error]", error))
	quietRepeatedWarnings()

	const backend = values.mock ? "mock" : localClaude() ? `${values.model} via local Claude Code` : values.model
	console.log(`run ${runId} · ${backend} · ${companies} companies`)
	const tasks = await runDemo(companies, values.model)

	for (const task of tasks) {
		const ms = (task.finishedAt ?? Date.now()) - (task.startedAt ?? task.createdAt)
		const agent = state.getParticipant(task.assignee)?.getManifest().name
		console.log(`  ${task.id.padEnd(8)} ${String(agent).padEnd(8)} ${task.status.padEnd(6)} ${ms} ms  ${task.output ?? task.error ?? ""}`)
	}
	const { tokensUsed, costUsd, startedAt } = state.budget
	const simulated = state.mock ? " (simulated)" : ""
	console.log(`${tokensUsed} tokens · $${costUsd.toFixed(4)}${simulated} · ${Date.now() - startedAt} ms`)

	writeFileSync(
		joinPath(trace.dir, "summary.json"),
		JSON.stringify({ runId, mock: state.mock, budget: state.budget, tasks: [...state.tasks.values()] }, null, 2),
	)
	await trace.close()
	console.log(`trace: ${trace.path}`)
}

/** Mozaik Cloud warns once per loop when it has no key. Show each warning once. */
function quietRepeatedWarnings(): void {
	const seen = new Set<string>()
	const warn = console.warn
	console.warn = (...args: unknown[]) => {
		const key = String(args[0])
		if (seen.has(key)) return
		seen.add(key)
		warn(...args)
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error)
	process.exit(1)
})
