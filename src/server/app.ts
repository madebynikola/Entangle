import { createReadStream, existsSync } from "node:fs"
import { join } from "node:path"
import { Readable } from "node:stream"
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { problemError } from "../data/problem"
import type { TraceRecord } from "../types"
import type { ApprovalBody, Health, StartRunBody } from "./api"
import { LineReader, readApprovals, readResults, writeApproval, type RunRegistry } from "./runs"
import { collectRunSources, datasetSources, findSource } from "./sources"
import { startRun } from "./spawn"

export interface AppOptions {
	root: string
	registry: RunRegistry
}

const KEY_VARS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"]
/** Records per SSE message while catching up on a long trace. */
const BATCH = 500

/** The REST + SSE API under /api. */
export function createApi({ root, registry }: AppOptions): Hono {
	const api = new Hono().basePath("/api")

	api.onError((error, c) => {
		console.error(`  ${c.req.method} ${c.req.path}:`, error.message)
		return c.json({ error: error.message }, 500)
	})

	api.get("/health", async (c) => {
		const health: Health = {
			ok: true,
			dataset: Boolean(await Promise.race([datasetSources(), Promise.resolve(null)])),
			canStartRuns: true,
			hasKeys: KEY_VARS.some((name) => process.env[name]) || process.env.LOCAL_CLAUDE === "1",
		}
		return c.json(health)
	})

	api.get("/runs", (c) => c.json(registry.list()))

	api.post("/runs", async (c) => {
		const body = await c.req.json<StartRunBody>().catch(() => ({}) as StartRunBody)
		if (body.companies != null && !(Number.isInteger(body.companies) && body.companies > 0 && body.companies <= 200)) {
			return c.json({ error: "companies must be a whole number from 1 to 200." }, 400)
		}
		if (body.problem != null) {
			const error = typeof body.problem === "string" ? problemError(body.problem) : "problem must be text."
			if (error) return c.json({ error }, 400)
			if (body.sector != null && (typeof body.sector !== "string" || body.sector.length > 100)) return c.json({ error: "sector must be text under 100 characters." }, 400)
		}
		const runId = await startRun(root, registry, body)
		return c.json({ runId }, 201)
	})

	api.get("/runs/:id", (c) => {
		const info = registry.info(c.req.param("id"))
		return info ? c.json(info) : notFound(c, "run")
	})

	api.get("/runs/:id/trace", (c) => {
		const dir = registry.dir(c.req.param("id"))
		if (!dir) return notFound(c, "run")
		const stream = Readable.toWeb(createReadStream(join(dir, "trace.jsonl"))) as ReadableStream
		return c.body(stream, 200, { "Content-Type": "application/x-ndjson; charset=utf-8" })
	})

	/**
	 * The trace as it grows. Sends what is there, then new lines every 200 ms, then `end` once the run has ended.
	 * The SSE id is the number of trace lines sent, so a reconnect (Last-Event-ID) resumes where it stopped.
	 */
	api.get("/runs/:id/events", (c) => {
		const id = c.req.param("id")
		const dir = registry.dir(id)
		if (!dir) return notFound(c, "run")
		const resumeAfter = Number(c.req.header("Last-Event-ID") ?? c.req.query("after") ?? 0) || 0

		return streamSSE(c, async (stream) => {
			const reader = new LineReader(join(dir, "trace.jsonl"))
			let aborted = false
			stream.onAbort(() => {
				aborted = true
			})
			let line = 0
			let lastStatus: string | undefined
			let quietSince = Date.now()

			while (!aborted) {
				const batch: TraceRecord[] = []
				const flush = async () => {
					if (!batch.length) return
					await stream.writeSSE({ event: "records", data: JSON.stringify(batch), id: String(line) })
					batch.length = 0
				}
				const lines = reader.read()
				for (const text of lines) {
					line++
					if (line <= resumeAfter) continue
					try {
						batch.push(JSON.parse(text))
					} catch {
						continue
					}
					if (batch.length >= BATCH) await flush()
				}
				await flush()

				const status = registry.status(id)
				if (status !== lastStatus) {
					await stream.writeSSE({ event: "status", data: JSON.stringify(status) })
					lastStatus = status
				}
				if (status !== "live" && !lines.length) {
					await stream.writeSSE({ event: "end", data: JSON.stringify({ lines: line }) })
					break
				}
				if (lines.length) quietSince = Date.now()
				else if (Date.now() - quietSince > 15_000) {
					await stream.writeSSE({ event: "ping", data: "" })
					quietSince = Date.now()
				}
				await stream.sleep(lines.length ? 50 : 200)
			}
		})
	})

	api.get("/runs/:id/results", (c) => {
		const dir = registry.dir(c.req.param("id"))
		return dir ? c.json(readResults(dir)) : notFound(c, "run")
	})

	api.get("/runs/:id/pairs", (c) => {
		const dir = registry.dir(c.req.param("id"))
		if (!dir) return notFound(c, "run")
		const { pairs, noMatches, approvals } = readResults(dir)
		return c.json({ pairs, noMatches, approvals })
	})

	api.get("/runs/:id/proposals", (c) => {
		const dir = registry.dir(c.req.param("id"))
		if (!dir) return notFound(c, "run")
		const { proposals, verdicts } = readResults(dir)
		return c.json({ proposals, verdicts })
	})

	api.get("/runs/:id/proposals/:pid", (c) => {
		const dir = registry.dir(c.req.param("id"))
		if (!dir) return notFound(c, "run")
		const { proposals, verdicts } = readResults(dir)
		const proposal = proposals.find((p) => p.id === c.req.param("pid"))
		if (!proposal) return notFound(c, "proposal")
		return c.json({ proposal, verdicts: verdicts.filter((v) => v.proposalId === proposal.id) })
	})

	api.get("/runs/:id/approvals", (c) => {
		const dir = registry.dir(c.req.param("id"))
		return dir ? c.json(readApprovals(dir)) : notFound(c, "run")
	})

	api.post("/runs/:id/approvals", async (c) => {
		const dir = registry.dir(c.req.param("id"))
		if (!dir) return notFound(c, "run")
		const body = await c.req.json<ApprovalBody>().catch(() => null)
		if (!body?.pairId || !["approved", "rejected", null].includes(body.decision)) {
			return c.json({ error: `Send { pairId, decision: "approved" | "rejected" | null, note? }.` }, 400)
		}
		return c.json(writeApproval(dir, body))
	})

	api.get("/runs/:id/sources", async (c) => {
		const dir = registry.dir(c.req.param("id"))
		return dir ? c.json(await collectRunSources(dir)) : notFound(c, "run")
	})

	api.get("/sources/:id", async (c) => {
		const run = c.req.query("run")
		const dir = run ? registry.dir(run) : undefined
		const source = await findSource(c.req.param("id"), dir)
		return source ? c.json(source) : notFound(c, "source")
	})

	api.all("*", (c) => c.json({ error: `No API route ${c.req.method} ${c.req.path}` }, 404))

	return api
}

function notFound(c: { json: (body: unknown, status: 404) => Response }, what: string): Response {
	return c.json({ error: `No such ${what}` }, 404)
}

/** True when `web/dist` has a build to serve. */
export function hasBuild(root: string): boolean {
	return existsSync(join(root, "web/dist/index.html"))
}
