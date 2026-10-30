import { SituationSpecification, createHuman, type Human } from "@mozaik-ai/core"
import type { Dataset } from "../../data"
import { budgetSpent, failTask, join, modelFor, state } from "../../runtime"
import { runnerSettings } from "../../runtime/config"
import type { ArtifactKind, CompanyNeed, NoMatch, PairCandidate, Proposal, ResearcherProfile, SentBack, Task } from "../../types"
import { analyzeCompanies, createAnalysts } from "../analyst"
import { CRITIC_SENT_BACK, createCritic, type Critic, type ReviewStatus } from "../critic"
import { choosePairs, createMatchmaker } from "../matchmaker"
import { emit } from "../matchmaker/shared"
import { createProfilerPool } from "../profiler"
import { createWriter, proposalId, type Writer } from "../writer"

export interface OrchestratorOptions {
	data: Dataset
	/** Industry Analysts. Default 4. */
	analysts?: number
	/** Research Profilers. Default 6. */
	profilers?: number
	/** Proposal Writers. Default 3. */
	writers?: number
	/** Candidates per challenge. Default 4. */
	k?: number
	/** Most proposals in the run. Default: no limit, so at most one per company. */
	maxProposals?: number
	/** Mock runs only: plant one invented claim in a need, a profile and a proposal, so the trace shows the Critic send them back. */
	mockPlantFakeClaims?: boolean
	/** One line per milestone, for the CLI. */
	log?: (line: string) => void
}

/** What a run produced: the artifacts the Critic accepted, plus the proposals it left for a person. */
export interface RunOutcome {
	companyIds: string[]
	needs: CompanyNeed[]
	profiles: ResearcherProfile[]
	pairs: PairCandidate[]
	/** Pair ids handed to the Writers, in the order they were chosen. */
	chosen: string[]
	noMatches: NoMatch[]
	proposals: Proposal[]
	/** Proposals on the blackboard the Critic did not accept: escalated after the last fix, or unfinished. A person decides. */
	needsHuman: Proposal[]
	ms: number
}

export interface Orchestrator {
	/** The `orchestrator` participant. It hands out work and tracks it; it makes no model calls. */
	participant: Human
	critic: Critic
	/** Run the whole team on these companies. Resolves when no task runs and no review is left. */
	run(companyIds: string[]): Promise<RunOutcome>
}

interface CompanyWork {
	id: string
	challenges: string[]
	analysis?: Task
	analysisLogged: boolean
	/** True once the company's pair is chosen, or it is clear there is none. */
	decided: boolean
}

interface ChallengeWork {
	/** The shortlisted candidates are still being profiled. */
	profiling: boolean
	match?: Task
	skipped?: string
}

/** How a proposal ended, for the log. `sent-back` here means its fix task failed. */
const OUTCOME: Record<ReviewStatus, string> = {
	reviewing: "in review",
	accepted: "accepted",
	"sent-back": "fix failed",
	dropped: "dropped by the Critic",
	"needs-human": "needs human review",
	error: "review failed",
}

class AnyEvent extends SituationSpecification {
	isSatisfiedBy(): boolean {
		return true
	}
}

/**
 * The Orchestrator: builds the team, hands out work as soon as its input exists, and assembles the result.
 *
 * Nothing runs in fixed stages. Every company is analysed at once. Each need, as it lands, is shortlisted and
 * its candidates profiled (the Profiler pool does this by itself). When a need's candidates are profiled, the
 * Orchestrator gives the need to the Matchmaker. When every review of a company has ended, it chooses that
 * company's pair and gives it to a free Writer, while other companies are still being read. The Critic reviews
 * each artifact as it lands and sends rejects back to their producer; the Orchestrator only waits for that.
 *
 * Only artifacts the Critic accepted reach the result. Join the trace observer before you create it.
 */
export function createOrchestrator(options: OrchestratorOptions): Orchestrator {
	const { data, k = 4, maxProposals = Infinity, log = () => {} } = options
	const plant = options.mockPlantFakeClaims ?? false
	const companies = new Map<string, CompanyWork>()
	const challenges = new Map<string, ChallengeWork>()
	/** `${kind}:${id}` → the producer's fix task of the latest send-back. */
	const fixes = new Map<string, string>()
	const handoffs = new Set<Promise<void>>()
	const chosen: string[] = []
	/** Proposal id → its first write task. */
	const writes = new Map<string, Task>()
	const usedResearchers = new Set<string>()
	const reported = new Set<string>()
	const waiters: Array<() => void> = []
	let scheduled = false
	let started = Date.now()

	const participant = createHuman({
		name: "orchestrator",
		capabilities: ["orchestrator"],
		handlers: [{ specification: new AnyEvent(), processor: { apply: ({ event }) => onEvent(event.type, event.producerId, event.payload) } }],
	})
	const me = participant.getId()
	join(participant)

	const critic = createCritic({ store: data.sources, model: () => modelFor("critic") })
	join(critic.agent)
	const analysts = createAnalysts(options.analysts ?? 4, { data, mockPlantFakeClaim: plant })
	const pool = createProfilerPool({ data, size: options.profilers ?? 6, k, mockPlantFakeClaim: plant })
	const matchmaker = createMatchmaker({})
	const writers = Array.from({ length: Math.max(1, options.writers ?? 3) }, (_, i) =>
		createWriter({ name: `writer-${i + 1}`, sources: data.sources, mockPlantFakeClaim: plant && i === 0 }),
	)

	const elapsed = () => `${Math.round((Date.now() - started) / 1000)}s`.padStart(5)
	const say = (line: string) => log(`${elapsed()}  ${line}`)
	const open = (task: Task) => task.status === "queued" || task.status === "running"
	const openTasks = () => [...state().tasks.values()].filter(open)
	const nameOf = (id: string) => state().getParticipant(id)?.getManifest().name ?? id

	function onEvent(type: string, producerId: string, payload: unknown): void {
		if (producerId === me) return
		if (type === "shortlist.ready") onShortlist(payload as { challengeId: string })
		else if (type === CRITIC_SENT_BACK) {
			const sentBack = payload as SentBack
			fixes.set(`${sentBack.kind}:${sentBack.id}`, sentBack.taskId)
		}
		schedule()
	}

	/** Re-check progress after the current fan-out and its microtasks, so every agent has applied the event first. */
	function schedule(): void {
		if (scheduled) return
		scheduled = true
		setImmediate(() => {
			scheduled = false
			tick()
			waiters.splice(0).forEach((wake) => wake())
		})
	}

	function assigned(task: Task): void {
		emit(me, "orchestrator.assigned", { taskId: task.id, kind: task.kind, subjectId: task.subjectId, assignee: nameOf(task.assignee) })
	}

	/** A need's candidates are on their way: once they are profiled, the need goes to the Matchmaker. */
	function onShortlist({ challengeId }: { challengeId: string }): void {
		if (challenges.has(challengeId) || !companies.has(data.challenges.get(challengeId)?.companyId ?? "")) return
		const work: ChallengeWork = { profiling: true }
		challenges.set(challengeId, work)
		const handoff = pool
			.whenProfiled(challengeId)
			.then((profiles) => {
				// The Critic can drop a need while its candidates are profiled.
				const need = state().needs.get(challengeId)
				const spent = budgetSpent()
				if (!need) work.skipped = "the need was dropped"
				else if (spent) work.skipped = `budget spent: ${spent}`
				else {
					work.match = matchmaker.match(need, profiles)
					assigned(work.match)
				}
			})
			.catch((error) => {
				work.skipped = error instanceof Error ? error.message : String(error)
			})
			.finally(() => {
				work.profiling = false
				handoffs.delete(handoff)
				schedule()
			})
		handoffs.add(handoff)
	}

	/** True while the Critic reviews the artifact, or its producer still fixes a send-back. */
	function inReview(kind: ArtifactKind, id: string): boolean {
		const status = critic.status(kind, id)
		if (status === "reviewing") return true
		if (status !== "sent-back") return false
		const fix = state().tasks.get(fixes.get(`${kind}:${id}`) ?? "")
		return fix !== undefined && open(fix)
	}

	const accepted = (kind: ArtifactKind, id: string) => critic.status(kind, id) === "accepted"

	/** A company is ready when its needs are matched and every review of its needs, pairs and their profiles has ended. */
	function ready(company: CompanyWork): boolean {
		const s = state()
		if (!company.analysis || open(company.analysis)) return false
		for (const challengeId of company.challenges) {
			if (inReview("need", challengeId)) return false
			if (!s.needs.has(challengeId)) continue
			const work = challenges.get(challengeId)
			if (!work || work.profiling || (work.match && open(work.match))) return false
		}
		for (const pair of s.candidates.values()) {
			if (pair.companyId !== company.id) continue
			if (inReview("pair", pair.id) || inReview("profile", pair.researcherId)) return false
		}
		return true
	}

	/**
	 * Choose the company's pair and hand it to the Writer with the fewest open tasks. Only a pair whose need,
	 * profile and pair all passed the Critic counts. Each researcher gets one proposal per run: the company
	 * that is ready first takes them.
	 */
	function decide(company: CompanyWork): void {
		company.decided = true
		const s = state()
		const pairs = [...s.candidates.values()].filter(
			(pair) => pair.companyId === company.id && accepted("pair", pair.id) && accepted("need", pair.challengeId) && accepted("profile", pair.researcherId),
		)
		const free = pairs.filter((pair) => !usedResearchers.has(pair.researcherId))
		const spent = budgetSpent()
		let pick: PairCandidate | undefined
		let reason = ""
		if (!pairs.length) reason = "no pair passed the Critic"
		else if (chosen.length >= maxProposals) reason = "the proposal limit is reached"
		else if (spent) reason = `budget spent: ${spent}`
		else if (!free.length) reason = "every accepted researcher already has a proposal"
		else if (!(pick = choosePairs(free, {}, company.challenges)[0])) reason = "no pair has a fit of 0.5 or more"

		let task: Task | null = null
		if (pick) {
			task = idlest(writers).write(pick.id)
			if (task) {
				chosen.push(pick.id)
				writes.set(proposalId(pick), task)
				usedResearchers.add(pick.researcherId)
				assigned(task)
			} else reason = "its need or profile left the blackboard"
		}
		emit(me, "orchestrator.decided", { taskId: task?.id, companyId: company.id, acceptedPairs: pairs.length, pairId: task ? pick!.id : null, reason: reason || undefined })
		say(`${company.id}  ${pairs.length} pair(s) accepted · ${task ? `writing ${proposalId(pick!)} (${nameOf(task.assignee)})` : reason}`)
	}

	function idlest(list: Writer[]): Writer {
		const load = (writer: Writer) => openTasks().filter((task) => task.assignee === writer.agent.getId()).length
		return list.reduce((best, writer) => (load(writer) < load(best) ? writer : best))
	}

	function tick(): void {
		const s = state()
		for (const company of companies.values()) {
			if (!company.analysisLogged && company.analysis && !open(company.analysis)) {
				company.analysisLogged = true
				const needs = company.challenges.map((id) => s.needs.get(id)).filter((need) => need !== undefined)
				const notResearch = needs.filter((need) => need.triage === "not-research").length
				say(`${company.id}  ${company.analysis.status === "done" ? `read · ${needs.length} need(s)${notResearch ? `, ${notResearch} not research` : ""}` : `analysis failed: ${company.analysis.error}`}`)
			}
			if (!company.decided && ready(company)) decide(company)
		}
		for (const [id, write] of writes) {
			if (reported.has(id) || open(write) || inReview("proposal", id)) continue
			reported.add(id)
			const status = critic.status("proposal", id)
			const revision = s.proposals.get(id)?.revision ?? 0
			const after = revision ? ` after ${revision} fix(es)` : ""
			say(`${id}  ${status ? `${OUTCOME[status]}${after}` : `not written: ${write.error ?? "no usable answer"}`}`)
		}
	}

	/** Resolves on the next progress check, or after `ms`. */
	function changed(ms = 1000): Promise<void> {
		return new Promise((resolve) => {
			const timer = setTimeout(resolve, ms)
			waiters.push(() => {
				clearTimeout(timer)
				resolve()
			})
		})
	}

	const nextTurn = () => new Promise((resolve) => setImmediate(resolve))

	/** Fail work that can no longer finish: tasks past the wall clock, and fix tasks that never started. */
	function stopOverdue(): void {
		const s = state()
		const overWall = Date.now() - s.budget.startedAt > s.budget.maxWallMs * (1 + runnerSettings().budgetSlack)
		for (const task of openTasks()) {
			if (overWall) failTask(task, "timeout: wall clock")
			else if (task.status === "queued" && Date.now() - task.createdAt > 30_000) failTask(task, "never started")
		}
	}

	/** Wait until no task runs, no review is left and every company is decided. */
	async function settle(): Promise<void> {
		let lastNote = Date.now()
		for (;;) {
			await changed()
			stopOverdue()
			if (Date.now() - lastNote > 30_000) {
				lastNote = Date.now()
				const all = [...state().tasks.values()]
				const count = (status: Task["status"]) => all.filter((task) => task.status === status).length
				say(`${count("running") + count("queued")} task(s) running · ${count("done")} done · ${count("failed")} failed · $${state().budget.costUsd.toFixed(2)}`)
			}
			if (handoffs.size || openTasks().length) continue
			await critic.idle()
			await nextTurn()
			if (handoffs.size || openTasks().length) continue
			tick()
			// Nothing is in flight, so a company still waiting waits for nothing: decide with what passed.
			for (const company of companies.values()) if (!company.decided) decide(company)
			if (!openTasks().length) return
		}
	}

	async function run(companyIds: string[]): Promise<RunOutcome> {
		started = Date.now()
		for (const id of companyIds) {
			const company = data.companies.get(id)
			if (!company) throw new Error(`Unknown company ${id}`)
			companies.set(id, { id, challenges: company.challenges, analysisLogged: false, decided: false })
		}
		emit(me, "orchestrator.plan", {
			companies: companyIds,
			challenges: [...companies.values()].reduce((sum, company) => sum + company.challenges.length, 0),
			analysts: analysts.length,
			profilers: pool.profilers.length,
			writers: writers.length,
			k,
			maxProposals: Number.isFinite(maxProposals) ? maxProposals : null,
		})
		for (const task of analyzeCompanies(analysts, data, companyIds)) {
			companies.get(task.subjectId!)!.analysis = task
			assigned(task)
		}
		await settle()

		const s = state()
		const ours = (challengeId: string) => companies.has(data.challenges.get(challengeId)?.companyId ?? "")
		const outcome: RunOutcome = {
			companyIds,
			needs: [...s.needs.values()].filter((need) => ours(need.challengeId) && accepted("need", need.challengeId)),
			profiles: [...s.profiles.values()].filter((profile) => accepted("profile", profile.researcherId)),
			pairs: [...s.candidates.values()].filter((pair) => accepted("pair", pair.id)),
			chosen: [...chosen],
			noMatches: [...s.noMatches.values()].filter((noMatch) => ours(noMatch.challengeId) && s.needs.has(noMatch.challengeId)),
			proposals: [...s.proposals.values()].filter((proposal) => accepted("proposal", proposal.id)),
			// Escalated by the Critic, or left unfinished: its fix or its review could not run.
			needsHuman: [...s.proposals.values()].filter((proposal) => !accepted("proposal", proposal.id)),
			ms: Date.now() - started,
		}
		emit(me, "orchestrator.done", {
			ms: outcome.ms,
			needs: outcome.needs.length,
			profiles: outcome.profiles.length,
			pairs: outcome.pairs.length,
			proposals: outcome.proposals.map((proposal) => proposal.id),
			needsHuman: outcome.needsHuman.map((proposal) => proposal.id),
			noMatches: outcome.noMatches.length,
		})
		return outcome
	}

	return { participant, critic, run }
}
