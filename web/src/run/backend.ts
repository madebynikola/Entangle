import type { ApprovalBody, Approvals, CompanyInfo, DatasetInfo, Health, RunInfo, RunResults, RunStatus, StartRunBody } from "@shared/server/api"
import type { SourceRecord, TraceRecord } from "@shared/types"
import { SAMPLE_ID, sampleRun } from "@/fixtures/sample-run"

/**
 * Where run data comes from. "server": the local server's /api (live runs, SSE, approvals on disk).
 * "static": a hosted build's runs/ folder (replay only; approvals stay in this browser).
 * The sample run is built in and works with both.
 */
export interface Backend {
	kind: "server" | "static"
	health: Health | null
	listRuns(): Promise<RunInfo[]>
	getRun(id: string): Promise<RunInfo>
	getTrace(id: string): Promise<TraceRecord[]>
	/** Live runs only: calls onRecords as the trace grows. Returns a stop function. */
	streamTrace(id: string, handlers: StreamHandlers): () => void
	getResults(id: string): Promise<RunResults>
	getSource(id: string, runId?: string): Promise<SourceRecord | null>
	setApproval(runId: string, body: ApprovalBody): Promise<Approvals>
	/** A mock or real run on the first companies, or a reverse search on a described `problem`. */
	startRun(options: StartRunBody): Promise<string>
	/** The data a run can read: the EINSTEIN dataset, the fixture, your uploads. Empty in a static build. */
	listDatasets(): Promise<DatasetInfo[]>
	/** The companies of one dataset, for the New run screen's picker. */
	listCompanies(datasetId: string): Promise<CompanyInfo[]>
	/** Your own data: files in the dataset's format, kept by the local server in data/uploads/. */
	uploadDataset(name: string, files: File[]): Promise<DatasetInfo>
	deleteDataset(id: string): Promise<void>
}

export interface StreamHandlers {
	onRecords(records: TraceRecord[]): void
	onStatus?(status: RunStatus): void
	onEnd?(): void
	onError?(message: string): void
}

let detected: Promise<Backend> | undefined

/** The backend for this page, found once: the server if /api answers, else the static build's files. */
export function getBackend(): Promise<Backend> {
	detected ??= (async () => {
		try {
			// A static build ships api/health as a file with { ok: false }; only the server answers ok: true.
			const response = await fetch("api/health", { headers: { Accept: "application/json" } })
			const health = response.ok ? ((await response.json().catch(() => null)) as Health | null) : null
			if (health?.ok === true) return serverBackend(health)
		} catch {
			// No server: a static build.
		}
		return staticBackend()
	})()
	return detected
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
	const response = await fetch(url, { ...init, headers: { Accept: "application/json", ...init?.headers } })
	if (!response.ok) {
		const body = await response.json().catch(() => null)
		throw new Error(body?.error ?? `${init?.method ?? "GET"} ${url}: ${response.status} ${response.statusText}`)
	}
	return (await response.json()) as T
}

function parseNdjson(text: string): TraceRecord[] {
	const records: TraceRecord[] = []
	for (const line of text.split("\n")) {
		if (!line.trim()) continue
		try {
			records.push(JSON.parse(line))
		} catch {
			// A half-written last line of a live trace.
		}
	}
	return records
}

const enc = encodeURIComponent

function serverBackend(health: Health): Backend {
	return {
		kind: "server",
		health,
		async listRuns() {
			return [...(await json<RunInfo[]>("api/runs")), sampleRun.info]
		},
		async getRun(id) {
			return id === SAMPLE_ID ? sampleRun.info : json(`api/runs/${enc(id)}`)
		},
		async getTrace(id) {
			if (id === SAMPLE_ID) return sampleRun.trace
			const response = await fetch(`api/runs/${enc(id)}/trace`)
			if (!response.ok) throw new Error(`No trace for run ${id}`)
			return parseNdjson(await response.text())
		},
		streamTrace(id, handlers) {
			const source = new EventSource(`api/runs/${enc(id)}/events`)
			source.addEventListener("records", (event) => handlers.onRecords(JSON.parse((event as MessageEvent).data)))
			source.addEventListener("status", (event) => handlers.onStatus?.(JSON.parse((event as MessageEvent).data)))
			source.addEventListener("end", () => {
				source.close()
				handlers.onEnd?.()
			})
			source.onerror = () => {
				if (source.readyState === EventSource.CLOSED) handlers.onError?.("Lost the connection to the server.")
			}
			return () => source.close()
		},
		async getResults(id) {
			return id === SAMPLE_ID ? withLocalApprovals(id, sampleRun.results) : json(`api/runs/${enc(id)}/results`)
		},
		async getSource(id, runId) {
			if (runId === SAMPLE_ID) return sampleRun.sources[id] ?? null
			const query = runId ? `?run=${enc(runId)}` : ""
			return json<SourceRecord>(`api/sources/${enc(id)}${query}`).catch(() => null)
		},
		async setApproval(runId, body) {
			if (runId === SAMPLE_ID) return localApproval(runId, body)
			return json(`api/runs/${enc(runId)}/approvals`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			})
		},
		async startRun(options) {
			const { runId } = await json<{ runId: string }>("api/runs", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(options),
			})
			return runId
		},
		async listDatasets() {
			return json("api/datasets")
		},
		async listCompanies(datasetId) {
			return json(`api/datasets/${enc(datasetId)}/companies`)
		},
		async uploadDataset(name, files) {
			const form = new FormData()
			form.set("name", name)
			for (const file of files) form.append("files", file, file.name)
			return json("api/datasets", { method: "POST", body: form })
		},
		async deleteDataset(id) {
			const response = await fetch(`api/datasets/${enc(id)}`, { method: "DELETE" })
			if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? `DELETE ${id}: ${response.status}`)
		},
	}
}

function staticBackend(): Backend {
	const sourceCache = new Map<string, Promise<Record<string, SourceRecord>>>()
	const runs = () => json<RunInfo[]>("runs/index.json").catch(() => [] as RunInfo[])
	return {
		kind: "static",
		health: null,
		async listRuns() {
			return [...(await runs()), sampleRun.info]
		},
		async getRun(id) {
			if (id === SAMPLE_ID) return sampleRun.info
			const run = (await runs()).find((r) => r.id === id)
			if (!run) throw new Error(`This build has no run ${id}.`)
			return run
		},
		async getTrace(id) {
			if (id === SAMPLE_ID) return sampleRun.trace
			const response = await fetch(`runs/${enc(id)}/trace.jsonl`)
			if (!response.ok) throw new Error(`This build has no trace for run ${id}.`)
			return parseNdjson(await response.text())
		},
		streamTrace(_id, handlers) {
			handlers.onEnd?.()
			return () => {}
		},
		async getResults(id) {
			if (id === SAMPLE_ID) return withLocalApprovals(id, sampleRun.results)
			return withLocalApprovals(id, await json<RunResults>(`runs/${enc(id)}/results.json`))
		},
		async getSource(id, runId) {
			if (!runId) return null
			if (runId === SAMPLE_ID) return sampleRun.sources[id] ?? null
			if (!sourceCache.has(runId)) {
				sourceCache.set(runId, json<Record<string, SourceRecord>>(`runs/${enc(runId)}/sources.json`).catch(() => ({})))
			}
			return (await sourceCache.get(runId)!)[id] ?? null
		},
		async setApproval(runId, body) {
			return localApproval(runId, body)
		},
		async startRun() {
			throw new Error("This is a static build. Run `npm run dev` to start runs.")
		},
		async listDatasets() {
			return []
		},
		async listCompanies() {
			return []
		},
		async uploadDataset() {
			throw new Error("This is a static build. Run `npm run dev` to add your own data.")
		},
		async deleteDataset() {
			throw new Error("This is a static build.")
		},
	}
}

// Approvals where there is no server to write them: this browser's storage.

function approvalsKey(runId: string): string {
	return `entangle.approvals.${runId}`
}

function readLocalApprovals(runId: string): Approvals {
	try {
		return JSON.parse(localStorage.getItem(approvalsKey(runId)) ?? "{}")
	} catch {
		return {}
	}
}

function localApproval(runId: string, body: ApprovalBody): Approvals {
	const approvals = readLocalApprovals(runId)
	if (body.decision === null) delete approvals[body.pairId]
	else approvals[body.pairId] = { pairId: body.pairId, decision: body.decision, note: body.note, decidedAt: new Date().toISOString() }
	try {
		localStorage.setItem(approvalsKey(runId), JSON.stringify(approvals))
	} catch {
		// Storage blocked: the decision lasts until reload.
	}
	return approvals
}

function withLocalApprovals(runId: string, results: RunResults): RunResults {
	return { ...results, approvals: { ...results.approvals, ...readLocalApprovals(runId) } }
}
