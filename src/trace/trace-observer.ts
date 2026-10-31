import { createWriteStream, mkdirSync } from "node:fs"
import { join as joinPath } from "node:path"
import { SituationSpecification, createHuman, type Human, type SemanticEvent } from "@mozaik-ai/core"
import { costUsd, loopOf, state, type MatchState } from "../runtime"
import type { TraceRecord } from "../types"

export interface TraceObserver {
	participant: Human
	/** `out/<run-id>/` */
	dir: string
	/** `out/<run-id>/trace.jsonl` */
	path: string
	/** Flush and close the file. */
	close(): Promise<void>
}

export interface TraceOptions {
	/** Called with every record as it is written, e.g. to stream it to the web app. */
	onRecord?: (record: TraceRecord) => void
}

class AnyEvent extends SituationSpecification {
	isSatisfiedBy(): boolean {
		return true
	}
}

/**
 * Observer participant that writes every Mozaik event to `<outDir>/<run-id>/trace.jsonl`.
 * Join it right after startRuntime(), before the agents, so it sees their `participant.joined`.
 */
export function createTraceObserver(outDir: string, options: TraceOptions = {}): TraceObserver {
	const s = state()
	const dir = joinPath(outDir, s.runId)
	mkdirSync(dir, { recursive: true })
	const path = joinPath(dir, "trace.jsonl")
	const file = createWriteStream(path, { flags: "w" })

	const participant = createHuman({
		name: "trace",
		capabilities: ["observer"],
		handlers: [
			{
				specification: new AnyEvent(),
				processor: {
					apply({ event }) {
						// A retry's backoff can still emit after the run has closed the file.
						if (file.writableEnded) return
						const record = toRecord(s, event)
						file.write(JSON.stringify(record) + "\n")
						options.onRecord?.(record)
					},
				},
			},
		],
	})

	return { participant, dir, path, close: () => new Promise((resolve) => file.end(resolve)) }
}

export function toRecord(s: MatchState, event: SemanticEvent): TraceRecord {
	const loop = loopOf(s, event)
	const p = event.payload as any
	const record: TraceRecord = {
		t: event.occurredAt.toISOString(),
		ms: event.occurredAt.getTime() - s.budget.startedAt,
		runId: s.runId,
		kind: event.type,
		agentId: event.producerId,
		agent: s.getParticipant(event.producerId)?.getManifest().name ?? p?.name,
		loopId: loop?.loopId,
		taskId: loop?.taskId ?? p?.taskId,
		model: loop?.model,
	}

	switch (event.type) {
		case "participant.joined":
		case "participant.left":
			record.data = { name: p.name, role: p.role, capabilities: p.capabilities }
			break
		case "message.sent":
			record.data = { message: clip(p.message) }
			break
		case "message_received.started":
			record.data = { message: clip(p.content) }
			break
		case "message_received.completed":
		case "inference.stream":
			break
		case "inference.started":
			record.model = p.model
			record.data = {
				contextItems: p.context?.getItems().length,
				tools: p.tools?.map((tool: { name: string }) => tool.name),
				structuredOutput: p.structuredOutput?.name,
			}
			break
		case "inference.completed": {
			const usage = p.tokenUsage
			if (usage) {
				record.tokens = { input: usage.inputTokens, output: usage.outputTokens, total: usage.totalTokens }
				record.costUsd = costUsd(loop?.model, usage.inputTokens, usage.outputTokens)
			}
			record.data = { items: p.items?.map((item: { type: string }) => item.type) }
			break
		}
		case "function_call.started":
			record.data = { name: p.call?.name, args: clip(p.call?.args) }
			break
		case "function_call.completed":
			record.data = { callId: p.callId, output: clip(p.output?.text) }
			break
		case "model.answer":
			record.data = { text: clip(p.answer?.content?.text, 8000) }
			break
		case "interception.started":
		case "interception.finished":
			record.data = { nextStateId: p.nextStateId }
			break
		default:
			// Custom events (task.*, critic verdicts, ...) are ours and small: keep them whole.
			record.data = p
	}
	return record
}

function clip(text: unknown, max = 2000): string | undefined {
	if (typeof text !== "string") return undefined
	return text.length > max ? `${text.slice(0, max)}…[+${text.length - max} chars]` : text
}
