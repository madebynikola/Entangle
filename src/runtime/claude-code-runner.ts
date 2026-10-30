import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join as joinPath } from "node:path"
import {
	FunctionCallItem,
	InputTokenDetails,
	ModelMessageItem,
	OutputTokenDetails,
	SemanticEvent,
	TokenUsage,
	type InferenceInput,
	type InferenceOutput,
	type InferenceRunner,
	type Tool,
} from "@mozaik-ai/core"
import { localClaudeSettings, type LocalClaudeSettings } from "./config"

/**
 * An InferenceRunner that runs every model call as a headless Claude Code session (`claude -p`) on the
 * user's own Claude login, the way Kanbix starts its sessions. No API key is needed or used.
 *
 * Each call is a fresh session with no Claude Code tools, no MCP servers and no user settings or hooks,
 * so the agents' developer message is the whole system prompt. Mozaik tools are emulated: the model
 * returns at most one call per turn in its structured answer, Mozaik runs it, and the next call gets the
 * conversation so far. It runs behind the ResilientRunner: errors carry an HTTP-like `status`
 * (401 not logged in, 400 bad request, 429 rate limit, 504 timeout, 502 bad answer), so only the
 * transient ones are retried.
 */
export class ClaudeCodeRunner implements InferenceRunner {
	private active = 0
	private readonly waiting: Array<() => void> = []
	private readonly cwd: string

	constructor(private readonly settings: LocalClaudeSettings = localClaudeSettings()) {
		// An empty folder, so no project CLAUDE.md is read.
		this.cwd = joinPath(tmpdir(), "einstein-claude-code")
		mkdirSync(this.cwd, { recursive: true })
	}

	async run(input: InferenceInput): Promise<InferenceOutput> {
		await this.acquire()
		try {
			return await this.call(input)
		} finally {
			this.release()
		}
	}

	async *stream(input: InferenceInput): AsyncGenerator<SemanticEvent> {
		yield SemanticEvent.create("inference.output", input.model, await this.run(input))
	}

	private async call(input: InferenceInput): Promise<InferenceOutput> {
		const tools = (input.tools ?? []) as Tool[]
		const { system, prompt } = render(input, tools)
		const answerSchema = input.structuredOutput?.schema
		const schema = tools.length ? envelope(tools, answerSchema) : answerSchema
		const args = [
			"-p",
			"--output-format", "json",
			"--model", claudeModel(input.model),
			"--tools", "",
			"--strict-mcp-config",
			"--no-session-persistence",
			"--setting-sources", "",
			"--system-prompt", system,
		]
		if (schema) args.push("--json-schema", JSON.stringify(schema))
		if (input.reasoningEffort) args.push("--effort", String(input.reasoningEffort))

		const result = await this.exec(args, prompt)
		const items = tools.length ? toolTurn(result.structured_output, tools) : [answerItem(result, answerSchema !== undefined)]
		const usage = result.usage ?? {}
		const cached = usage.cache_read_input_tokens ?? 0
		const inputTokens = (usage.input_tokens ?? 0) + cached + (usage.cache_creation_input_tokens ?? 0)
		const outputTokens = usage.output_tokens ?? 0
		return {
			items,
			tokenUsage: new TokenUsage(
				inputTokens,
				outputTokens,
				inputTokens + outputTokens,
				new InputTokenDetails(cached),
				new OutputTokenDetails(usage.output_tokens_details?.thinking_tokens ?? 0),
			),
			rowResponse: {
				claudeCode: { sessionId: result.session_id, costUsd: result.total_cost_usd, durationMs: result.duration_ms, turns: result.num_turns },
			},
		}
	}

	/** Run one `claude -p` with the prompt on stdin. Resolves with its JSON result, or rejects with a status. */
	private exec(args: string[], prompt: string): Promise<ClaudeResult> {
		// The user's login, never an API key that `.env` put in this process.
		const env = { ...process.env }
		delete env.ANTHROPIC_API_KEY
		return new Promise((resolve, reject) => {
			const child = spawn(this.settings.command, args, { cwd: this.cwd, env, stdio: ["pipe", "pipe", "pipe"] })
			let stdout = ""
			let stderr = ""
			let timedOut = false
			const timer = setTimeout(() => {
				timedOut = true
				child.kill("SIGTERM")
			}, this.settings.timeoutMs)
			child.stdout.on("data", (chunk) => (stdout += chunk))
			child.stderr.on("data", (chunk) => (stderr += chunk))
			child.on("error", (error: NodeJS.ErrnoException) => {
				clearTimeout(timer)
				const missing = error.code === "ENOENT"
				reject(
					fail(
						400,
						missing
							? `Claude Code not found (\`${this.settings.command}\`). Install it, set CLAUDE_BIN, or turn LOCAL_CLAUDE off.`
							: error.message,
					),
				)
			})
			child.on("close", (code) => {
				clearTimeout(timer)
				if (timedOut) return reject(fail(504, `claude -p ran longer than ${this.settings.timeoutMs} ms`))
				let result: ClaudeResult
				try {
					result = JSON.parse(stdout)
				} catch {
					const text = `${stderr} ${stdout}`.trim().slice(0, 500)
					const status = /log ?in|logged|auth|credential|token/i.test(text) ? 401 : 502
					return reject(fail(status, `claude -p exited ${code}: ${text || "no output"}`))
				}
				if (result.is_error) return reject(fail(statusOf(result), `claude -p: ${String(result.result ?? result.subtype).slice(0, 500)}`))
				resolve(result)
			})
			child.stdin.on("error", () => {
				// The process ended before it read the prompt; "close" reports why.
			})
			child.stdin.end(prompt)
		})
	}

	private async acquire(): Promise<void> {
		if (this.active < this.settings.sessions) {
			this.active++
			return
		}
		await new Promise<void>((resolve) => this.waiting.push(resolve))
	}

	private release(): void {
		const next = this.waiting.shift()
		if (next) next()
		else this.active--
	}
}

interface ClaudeResult {
	is_error?: boolean
	subtype?: string
	result?: string
	structured_output?: unknown
	api_error_status?: number | null
	session_id?: string
	total_cost_usd?: number
	duration_ms?: number
	num_turns?: number
	usage?: {
		input_tokens?: number
		output_tokens?: number
		cache_read_input_tokens?: number
		cache_creation_input_tokens?: number
		output_tokens_details?: { thinking_tokens?: number }
	}
}

function fail(status: number, message: string): Error {
	return Object.assign(new Error(message), { status })
}

function statusOf(result: ClaudeResult): number {
	if (typeof result.api_error_status === "number") return result.api_error_status
	const text = `${result.subtype} ${result.result}`
	if (/rate.?limit|usage limit|overloaded|too many/i.test(text)) return 429
	if (/log ?in|auth|credential/i.test(text)) return 401
	return 502
}

/** Claude Code takes Claude model names. Another provider's model gets the Claude model of its tier. */
function claudeModel(model: string): string {
	if (model.startsWith("claude-")) return model
	return /mini|flash|lite|haiku|small/i.test(model) ? "claude-haiku-4-5" : "claude-sonnet-4-6"
}

type Item = { type: string; role?: string; content?: { text?: string }; name?: string; args?: string; callId?: string; output?: { text?: string } }

/** System prompt from the developer and system messages; the rest as the prompt. */
function render(input: InferenceInput, tools: Tool[]): { system: string; prompt: string } {
	const items = input.context.getItems() as unknown as Item[]
	const system = items.filter((item) => item.type === "message" && (item.role === "developer" || item.role === "system")).map(textOf)
	const rest = items.filter((item) => !(item.type === "message" && (item.role === "developer" || item.role === "system")) && item.type !== "reasoning")
	if (tools.length) system.push(toolGuide(tools))

	if (rest.length === 1 && rest[0].type === "message" && rest[0].role === "user") return { system: system.join("\n\n"), prompt: textOf(rest[0]) }
	const names = new Map(rest.filter((item) => item.type === "function_call").map((item) => [item.callId, item.name]))
	const turns = rest.map((item) => {
		if (item.type === "function_call") return `## You called ${item.name}\n${item.args}`
		if (item.type === "function_call_output") return `## ${names.get(item.callId) ?? "The tool"} returned\n${item.output?.text ?? ""}`
		return `## ${item.role === "assistant" ? "You" : "User"}\n${textOf(item)}`
	})
	return { system: system.join("\n\n"), prompt: `The conversation so far:\n\n${turns.join("\n\n")}\n\nContinue from here.` }
}

const textOf = (item: Item) => item.content?.text ?? ""

function toolGuide(tools: Tool[]): string {
	const list = tools.map((tool) => `- ${tool.name}: ${tool.description}\n  Parameters (JSON Schema): ${JSON.stringify(tool.parameters)}`)
	return [
		"You can call these tools:",
		...list,
		'To call one, set "call" to {"name": ..., "arguments": "<the parameters as a JSON object, in a string>"} and "answer" to null. You get its result in the next message. Call one tool per turn.',
		'When you can answer, set "call" to null and put your answer in "answer".',
	].join("\n")
}

/** The structured answer when tools are on: one tool call, or the answer. */
function envelope(tools: Tool[], answerSchema: Record<string, unknown> | undefined) {
	return {
		type: "object",
		additionalProperties: false,
		required: ["call", "answer"],
		properties: {
			call: {
				anyOf: [
					{
						type: "object",
						additionalProperties: false,
						required: ["name", "arguments"],
						properties: { name: { type: "string", enum: tools.map((tool) => tool.name) }, arguments: { type: "string" } },
					},
					{ type: "null" },
				],
			},
			answer: { anyOf: [answerSchema ?? { type: "string" }, { type: "null" }] },
		},
	}
}

function toolTurn(output: unknown, tools: Tool[]) {
	const turn = output as { call?: { name: string; arguments: string } | null; answer?: unknown } | undefined
	if (!turn) throw fail(502, "claude -p gave no structured answer")
	if (turn.call) {
		const tool = tools.find((t) => t.name === turn.call!.name)
		if (!tool) throw fail(502, `claude -p called an unknown tool ${turn.call.name}`)
		return [FunctionCallItem.rehydrate({ callId: `call_${randomUUID()}`, name: tool.name, args: toolArgs(tool, turn.call.arguments) })]
	}
	if (turn.answer === null || turn.answer === undefined) throw fail(502, "claude -p gave neither a tool call nor an answer")
	return [ModelMessageItem.rehydrate({ text: typeof turn.answer === "string" ? turn.answer : JSON.stringify(turn.answer) })]
}

/** The arguments as a JSON object. A bare value for a tool with one required parameter is wrapped. */
function toolArgs(tool: Tool, raw: string): string {
	try {
		const parsed = JSON.parse(raw)
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return JSON.stringify(parsed)
	} catch {
		// Not JSON: maybe a bare value.
	}
	const required = (tool.parameters as { required?: string[] }).required ?? []
	return required.length === 1 ? JSON.stringify({ [required[0]]: raw }) : raw
}

function answerItem(result: ClaudeResult, structured: boolean) {
	if (structured && result.structured_output === undefined) throw fail(502, "claude -p gave no structured answer")
	const text = structured ? JSON.stringify(result.structured_output) : (result.result ?? "")
	return ModelMessageItem.rehydrate({ text })
}
