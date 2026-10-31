import { spawn } from "node:child_process"
import type { StartRunBody } from "./api"
import type { RunRegistry } from "./runs"

/**
 * Start `npm run match` as a child process and resolve with its run id, read from the CLI's
 * first line (`run <id> · ...`). The trace it writes is what the web app streams.
 */
export function startRun(root: string, registry: RunRegistry, body: StartRunBody): Promise<string> {
	const args = ["--import", "tsx", "src/cli.ts"]
	if (body.mock) args.push("--mock")
	if (body.problem) args.push("--problem", body.problem.trim())
	else if (body.companies) args.push("--companies", String(body.companies))
	if (body.problem && body.sector?.trim()) args.push("--sector", body.sector.trim())

	const child = spawn(process.execPath, args, { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"] })
	let output = ""
	let runId: string | undefined

	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => fail(`The run did not start within 30 s.`), 30_000)
		const fail = (message: string) => {
			clearTimeout(timer)
			reject(new Error(`${message}\n${output.trim().split("\n").slice(-5).join("\n")}`.trim()))
		}
		const onData = (chunk: Buffer) => {
			output += chunk.toString()
			if (runId) return
			const match = output.match(/^run (\S+)/m)
			if (!match) return
			runId = match[1]
			registry.markRunning(runId, true)
			clearTimeout(timer)
			resolve(runId)
		}
		child.stdout.on("data", onData)
		child.stderr.on("data", onData)
		child.on("error", (error) => fail(error.message))
		child.on("exit", (code) => {
			if (runId) {
				registry.markRunning(runId, false)
				console.log(`  run ${runId} exited with code ${code}`)
			} else fail(`The run exited with code ${code} before it started.`)
		})
	})
}
