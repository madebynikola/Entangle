import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join as joinPath } from "node:path"
import { parseArgs } from "node:util"
import { formatScore, reviewLabels, scoreCritic, type CriticLabels, type CriticScore } from "./agents/critic"
import { localClaude, modelFor, startRuntime } from "./runtime"

const USAGE = `Usage: npm run critic:eval -- [--mock | --local]

Runs only the Critic on the hand-labelled claims in test/fixtures/critic-labels.json (129 claims of 6 proposals),
with both reviewers as on proposals in a match, and scores it: the share of wrong claims it rejects, the share of
ok claims it rejects, and a confusion matrix by label. The per-claim result goes to out/critic-eval/.

  --mock    The mock Critic (lexical overlap): no API keys, no cost.
  --local   Every model call as a local Claude Code session on your own login (same as LOCAL_CLAUDE=1).

Models: the critic route in config/models.ts; MODEL_CRITIC and MODEL_CRITIC_2 in .env pin them.`

const LABELS = "test/fixtures/critic-labels.json"
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
			help: { type: "boolean", short: "h", default: false },
		},
	})
	if (values.help) {
		console.log(USAGE)
		return
	}
	if (values.local) process.env.LOCAL_CLAUDE = "1"
	if (!values.mock && !localClaude() && !KEY_VARS.some((name) => process.env[name])) {
		throw new Error(`No API key set (${KEY_VARS.join(", ")}). Add one to .env, run with --local, or run with --mock.`)
	}

	const labels = JSON.parse(readFileSync(LABELS, "utf8")) as CriticLabels
	const runId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + (values.mock ? "-mock" : "")
	const state = startRuntime({ runId, mock: values.mock })
	const review = await reviewLabels(labels, { model: () => modelFor("critic") })

	const models = review.reviewers.map(({ name, model }) => `${name} ${model}`).join(", ")
	const cost = state.mock ? "mock" : `$${review.costUsd.toFixed(2)} at API prices`
	console.log(`Critic on ${review.claims.length} labelled claims (${models}): ${(review.ms / 1000).toFixed(0)} s, ${cost}.\n`)
	const scores: Record<string, CriticScore> = { panel: scoreCritic(review.claims) }
	for (const { name } of review.reviewers) scores[name] = scoreCritic(review.claims, name)
	scores.code = scoreCritic(review.claims, "code")
	console.log(formatScore(scores.panel, "Both reviewers (a claim fails when either rejects it):"))
	for (const { name, model } of review.reviewers) {
		const { recall, caught, bad, falseRejects, good } = scores[name]
		console.log(`\n${name} (${model}) alone: caught ${caught} of ${bad} (${Math.round(recall * 100)}%), rejected ${falseRejects} of ${good} ok.`)
	}
	console.log(`\nCode checks alone: caught ${scores.code.caught} of ${scores.code.bad}, rejected ${scores.code.falseRejects} of ${scores.code.good} ok.`)
	for (const phase of new Set(review.claims.map((claim) => claim.phase))) {
		const { caught, bad, falseRejects, good } = scoreCritic(review.claims.filter((claim) => claim.phase === phase))
		console.log(`Claims from the ${phase} run: caught ${caught} of ${bad}, rejected ${falseRejects} of ${good} ok.`)
	}

	const dir = joinPath("out", "critic-eval")
	mkdirSync(dir, { recursive: true })
	const file = joinPath(dir, `${runId}.json`)
	const summary = Object.fromEntries(Object.entries(scores).map(([name, { missed, falselyRejected, ...rest }]) => [name, rest]))
	writeFileSync(file, `${JSON.stringify({ runId, reviewers: review.reviewers, costUsd: review.costUsd, ms: review.ms, scores: summary, claims: review.claims }, null, "\t")}\n`)
	console.log(`\nPer claim: ${file}`)
}

main().then(
	() => process.exit(0),
	(error) => {
		console.error(error instanceof Error ? error.message : error)
		process.exit(1)
	},
)
