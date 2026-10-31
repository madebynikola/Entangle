import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { state } from "../../runtime"
import type { RunResults } from "../../server/api"
import { citedIds } from "../../server/runs"
import { projectRecord } from "../../data/cordis"
import { callRecord } from "../../data/eucalls"
import type { Budget, SourceRecord, SourceStore, Task } from "../../types"
import type { CriticStats } from "../critic"
import { fundingMarkdown } from "../scout"
import type { RunOutcome } from "./orchestrator"

/** `out/<run>/summary.json`. The server reads `runId`, `mock`, `budget` and `tasks`; the rest is for people. */
export interface RunSummary {
	runId: string
	mock: boolean
	companies: string[]
	durationMs: number
	counts: { needs: number; profiles: number; pairs: number; chosen: number; proposals: number; needsHuman: number; noMatches: number }
	critic: CriticStats
	/** Proposals left for a person: the two Critics still rejected them after the last fix, or the fix could not run. */
	needsHuman: string[]
	failures: Array<{ taskId: string; kind: Task["kind"]; subjectId?: string; error?: string }>
	budget: Budget
	tasks: Task[]
	/** Why the run stopped before its work ended (a crash, or a signal). The files then hold its partial results. */
	stopped?: string
}

/**
 * Write the run's files into `dir` (`out/<run>/`): `proposals/<id>.md` for accepted proposals,
 * `needs-human/<id>.md`, each with the Funding Scout's calls at the end, `pairs.json`, `results.json` (RunResults for the web app), `sources.json`
 * (every cited record, so the run replays without the dataset) and `summary.json`. The summary goes last,
 * because the server takes it as the sign that the run has ended.
 */
export function writeRun(dir: string, outcome: RunOutcome, critic: CriticStats, store: SourceStore, stopped?: string): RunSummary {
	const s = state()
	const save = (name: string, value: unknown) => writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + "\n")
	const funding = new Map(outcome.funding.map((match) => [match.pairId, match]))
	for (const [folder, proposals] of [
		["proposals", outcome.proposals],
		["needs-human", outcome.needsHuman],
	] as const) {
		if (!proposals.length) continue
		mkdirSync(join(dir, folder), { recursive: true })
		for (const proposal of proposals) {
			const match = funding.get(proposal.pairId)
			writeFileSync(join(dir, folder, `${proposal.id}.md`), proposal.markdown.trimEnd() + "\n" + (match ? `\n${fundingMarkdown(match)}` : ""))
		}
	}

	save("pairs.json", { chosen: outcome.chosen, pairs: outcome.pairs, noMatches: outcome.noMatches })
	const results: RunResults = {
		needs: outcome.needs,
		profiles: outcome.profiles,
		pairs: outcome.pairs,
		chosen: outcome.chosen,
		noMatches: outcome.noMatches,
		proposals: outcome.proposals,
		needsHuman: outcome.needsHuman,
		verdicts: s.verdicts,
		approvals: {},
		funding: outcome.funding,
	}
	save("results.json", results)
	const sources: Record<string, SourceRecord> = {}
	for (const id of citedIds(results)) {
		const record = store.get(id)
		if (record) sources[id] = record
	}
	// The calls and EU projects are not in any store: the portal's and CORDIS's answers are their source.
	for (const match of outcome.funding) {
		for (const { call } of match.calls) sources[call.id] = callRecord(call)
		for (const { project } of match.projects ?? []) sources[project.id] = projectRecord(project)
	}
	save("sources.json", sources)

	const tasks = [...s.tasks.values()]
	const summary: RunSummary = {
		runId: s.runId,
		mock: s.mock,
		companies: outcome.companyIds,
		durationMs: outcome.ms,
		counts: {
			needs: outcome.needs.length,
			profiles: outcome.profiles.length,
			pairs: outcome.pairs.length,
			chosen: outcome.chosen.length,
			proposals: outcome.proposals.length,
			needsHuman: outcome.needsHuman.length,
			noMatches: outcome.noMatches.length,
		},
		critic,
		needsHuman: outcome.needsHuman.map((proposal) => proposal.id),
		failures: tasks
			.filter((task) => task.status === "failed")
			.map(({ id, kind, subjectId, error }) => ({ taskId: id, kind, subjectId, error })),
		budget: s.budget,
		tasks,
		...(stopped ? { stopped } : {}),
	}
	save("summary.json", summary)
	return summary
}
