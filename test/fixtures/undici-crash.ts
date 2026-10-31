import { createServer } from "node:net"
import { guardRun } from "../../src/runtime/crash"

/**
 * Run by test/crash.test.ts as its own process, since it needs real uncaught errors. Modes:
 * `bare` and `guarded` fetch answers whose body is read late from a server that closes the socket, which makes undici
 * throw its socket assertion; `guarded` runs under guardRun. `crash` throws an ordinary error and `sigterm` gets a
 * SIGTERM, both under guardRun. Prints one JSON line.
 */
const mode = process.argv[2]
const out = (value: unknown) => console.log(JSON.stringify(value))

if (mode !== "bare") {
	guardRun({
		save: (reason) => out({ saved: reason }),
		log: () => {},
	})
}

if (mode === "crash") setTimeout(() => {
	throw new Error("boom")
}, 10)
else if (mode === "sigterm") {
	// Busy like a run, so the process is still there when the signal lands.
	setInterval(() => {}, 1000)
	setTimeout(() => process.kill(process.pid, "SIGTERM"), 10)
}
else {
	const sizes: number[] = []
	const server = createServer((socket) => {
		socket.once("data", () => {
			socket.write("HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Type: application/json\r\n\r\n")
			socket.end(JSON.stringify({ a: "x".repeat(sizes.shift() ?? 0) }))
		})
	})
	server.listen(0, async () => {
		const { port } = server.address() as { port: number }
		const results = { read: 0, timedOut: 0, other: 0 }
		for (let size = 1000; size < 200_000; size += 1777) {
			sizes.push(size)
			try {
				const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) })
				// Read late, as a busy run does: the parser pauses and the server's close arrives first.
				await new Promise((resolve) => setTimeout(resolve, 5))
				await response.json()
				results.read++
			} catch (error) {
				if ((error as Error).name === "TimeoutError") results.timedOut++
				else results.other++
			}
		}
		out(results)
		server.close()
	})
}
