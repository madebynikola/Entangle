import { SituationSpecification, createHuman, type Human, type SituationContext } from "@mozaik-ai/core"
import { join, state, whenSettled } from "../../runtime"
import type { ArtifactPosted, CompanyNeed, ResearcherProfile, Task } from "../../types"
import { ARTIFACT_POSTED } from "../critic/protocol"
import { emit } from "../matchmaker/shared"
import { createProfiler, type Profiler, type ProfilerOptions } from "./profiler"
import { shortlistFor, type Shortlist } from "./shortlist"

export interface ProfilerPoolOptions extends Omit<ProfilerOptions, "name"> {
	/** Profilers in the pool, named `profiler-1` … Default 4. */
	size?: number
	/** Candidates per need. Default 8. */
	k?: number
	/**
	 * Shortlist and profile each need as soon as an Analyst posts it (`artifact.posted`), so profiling starts
	 * while other companies are still being read. Default true. Off: call `forNeed` yourself.
	 */
	followNeeds?: boolean
}

export interface ProfilerPool {
	profilers: Profiler[]
	/** The `shortlist` participant: retrieval, no model. It emits `shortlist.ready` for each need. */
	dispatcher: Human
	/**
	 * Profile one researcher, once per run: a second call (from another need) returns the first task.
	 * Goes to the profiler with the fewest open tasks; every task is its own loop, so they all run at once.
	 */
	profile(researcherId: string): Task
	/** Shortlist a need's candidates and start profiling them. Once per challenge; later calls return the first shortlist. */
	forNeed(need: CompanyNeed, sourceTaskId?: string): Shortlist
	shortlist(challengeId: string): Shortlist | undefined
	/**
	 * Resolves when every candidate on the need's shortlist has a settled profile task: the profiles on the
	 * blackboard, in shortlist order (a failed or dropped one is left out). Throws for a need with no shortlist yet.
	 */
	whenProfiled(challengeId: string): Promise<ResearcherProfile[]>
}

class NeedPosted extends SituationSpecification {
	isSatisfiedBy({ event }: SituationContext): boolean {
		return event.type === ARTIFACT_POSTED && (event.payload as ArtifactPosted).kind === "need"
	}
}

/**
 * The Profiler fan-out: a pool of Profilers and a `shortlist` participant that turns each posted need into
 * candidates (`find_researchers_for_need` on the Analyst's search terms) and hands them out. Only shortlisted
 * researchers are profiled, each once, however many needs pick them.
 */
export function createProfilerPool(options: ProfilerPoolOptions): ProfilerPool {
	const { data, size = 4, k = 8, followNeeds = true, ...rest } = options
	const profilers = Array.from({ length: Math.max(1, size) }, (_, i) =>
		createProfiler({ ...rest, data, name: `profiler-${i + 1}`, mockPlantFakeClaim: rest.mockPlantFakeClaim && i === 0 }),
	)
	const byResearcher = new Map<string, Task>()
	const shortlists = new Map<string, Shortlist>()

	const dispatcher = createHuman({
		name: "shortlist",
		capabilities: ["retrieval"],
		handlers: followNeeds
			? [
					{
						specification: new NeedPosted(),
						processor: {
							apply: ({ event }) => {
								const { id, taskId } = event.payload as ArtifactPosted
								// After this event's fan-out, so every participant sees the post first. A re-post after a fix keeps the shortlist.
								queueMicrotask(() => {
									const need = state().needs.get(id)
									if (need && !shortlists.has(id)) forNeed(need, taskId)
								})
							},
						},
					},
				]
			: [],
	})
	join(dispatcher)

	function profile(researcherId: string): Task {
		const id = data.canonicalId(researcherId)
		const existing = byResearcher.get(id)
		if (existing) return existing
		const open = (p: Profiler) => [...byResearcher.values()].filter((t) => t.assignee === p.agent.getId() && (t.status === "queued" || t.status === "running")).length
		const profiler = profilers.reduce((best, p) => (open(p) < open(best) ? p : best))
		const task = profiler.profile(id)
		byResearcher.set(id, task)
		return task
	}

	function forNeed(need: CompanyNeed, sourceTaskId?: string): Shortlist {
		const known = shortlists.get(need.challengeId)
		if (known) return known
		const list = shortlistFor(data, need, { k })
		shortlists.set(need.challengeId, list)
		const tasks = list.researcherIds.map(profile)
		emit(dispatcher.getId(), "shortlist.ready", {
			taskId: sourceTaskId,
			challengeId: need.challengeId,
			researcherIds: list.researcherIds,
			profileTaskIds: tasks.map((t) => t.id),
			skipped: list.skipped,
			reason: list.reason,
		})
		return list
	}

	async function whenProfiled(challengeId: string): Promise<ResearcherProfile[]> {
		const list = shortlists.get(challengeId)
		if (!list) throw new Error(`No shortlist for ${challengeId} yet`)
		await whenSettled(list.researcherIds.map((id) => byResearcher.get(id)!.id))
		const s = state()
		return list.researcherIds.map((id) => s.profiles.get(id)).filter((p): p is ResearcherProfile => p !== undefined)
	}

	return { profilers, dispatcher, profile, forNeed, shortlist: (id) => shortlists.get(id), whenProfiled }
}

