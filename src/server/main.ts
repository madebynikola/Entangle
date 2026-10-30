/**
 * The local server: the web app plus the API.
 *
 *   npm run dev                      app with hot reload + API (the server restarts when src/ changes)
 *   npm run replay [-- out/<run>]    open a run folder in the app; with no folder, the newest run
 *   npm start                        the built app (web/dist) + API
 *
 * Options: --port N (or PORT; default 4317, the next free port is used), --open / --no-open.
 * It listens on 127.0.0.1 only: the API starts processes and writes files. Set HOST=0.0.0.0 to show it on your network.
 */
import { exec } from "node:child_process"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { resolve } from "node:path"
import { parseArgs } from "node:util"
import { getRequestListener } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { Hono } from "hono"
import { createApi, hasBuild } from "./app"
import { RunRegistry } from "./runs"
import { datasetSources } from "./sources"

const ROOT = resolve(import.meta.dirname, "../..")
const USAGE = `Usage: tsx src/server/main.ts [dev | start | replay [run-folder]] [--port N] [--open | --no-open]`

async function main(): Promise<void> {
	try {
		process.loadEnvFile(resolve(ROOT, ".env"))
	} catch {
		// No .env: keys come from the shell.
	}
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			port: { type: "string" },
			open: { type: "boolean" },
			"no-open": { type: "boolean" },
			help: { type: "boolean", short: "h" },
		},
	})
	if (values.help) return console.log(USAGE)
	const [command = "dev", folder] = positionals
	if (!["dev", "start", "replay"].includes(command)) throw new Error(USAGE)

	const registry = new RunRegistry(resolve(ROOT, "out"))
	let path = "/"
	if (command === "replay") {
		const id = folder ? registry.add(folder) : registry.list().find((run) => run.status === "ended")?.id
		if (!id) throw new Error(`No finished run in out/. Run \`npm run match -- --mock\` first, or pass a folder.`)
		path = `/#/runs/${encodeURIComponent(id)}/live?replay`
	}

	const prod = command === "start"
	if (prod && !hasBuild(ROOT)) throw new Error(`No build in web/dist. Run \`npm run build\` first.`)

	const api = getRequestListener(createApi({ root: ROOT, registry }).fetch)
	const site = prod ? getRequestListener(staticSite().fetch) : undefined
	let vite: { middlewares: (req: IncomingMessage, res: ServerResponse) => void } | undefined

	const server = createServer((req, res) => {
		if (req.url?.startsWith("/api/")) return void api(req, res)
		if (site) return void site(req, res)
		if (vite) return vite.middlewares(req, res)
		res.writeHead(503).end("Starting…")
	})

	const port = await listen(server, Number(values.port ?? process.env.PORT ?? 4317))
	if (!prod) {
		const { createServer: createVite } = await import("vite")
		vite = await createVite({
			configFile: resolve(ROOT, "web/vite.config.ts"),
			server: { middlewareMode: true, hmr: { server } },
			appType: "spa",
			clearScreen: false,
		})
	}

	const url = `http://localhost:${port}${path}`
	const mode = prod ? "built app" : command === "replay" ? "replay" : "dev, hot reload"
	console.log(`\n  Entangle  ${url}  (${mode})\n`)
	void datasetSources()

	const open = values["no-open"] ? false : (values.open ?? command === "replay")
	if (open) openBrowser(url)
}

function staticSite(): Hono {
	const dist = resolve(ROOT, "web/dist")
	return new Hono()
		.use("*", serveStatic({ root: dist }))
		.get("*", serveStatic({ root: dist, path: "index.html" }))
}

/** Listen on `port`, or on the next free one: parallel sessions each run their own server. */
function listen(server: ReturnType<typeof createServer>, port: number, tries = 20): Promise<number> {
	return new Promise((resolvePort, reject) => {
		const onError = (error: NodeJS.ErrnoException) => {
			server.off("listening", onListening)
			if (error.code === "EADDRINUSE" && tries > 1) resolvePort(listen(server, port + 1, tries - 1))
			else reject(error)
		}
		const onListening = () => {
			server.off("error", onError)
			resolvePort(port)
		}
		server.once("error", onError)
		server.once("listening", onListening)
		server.listen(port, process.env.HOST ?? "127.0.0.1")
	})
}

function openBrowser(url: string): void {
	const command =
		process.platform === "darwin" ? "open" : process.platform === "win32" ? 'start ""' : "xdg-open"
	exec(`${command} "${url}"`, (error) => {
		if (error) console.log(`  Open ${url} in your browser.`)
	})
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error)
	process.exit(1)
})
