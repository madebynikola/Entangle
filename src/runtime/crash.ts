/**
 * Node's fetch (undici) can throw an AssertionError from a socket's `end` event, `assert(!this.paused)` in
 * Parser.finish: the server closed a `Connection: close` response while the parser waited for its body to be read.
 * The error belongs to no request, so it reaches the process as uncaught and used to stop the whole run.
 * The request it hits never settles by itself; its AbortSignal timeout fails it, and the search that sent it
 * goes on with what it has. So the run can ignore this error.
 */
export function isUndiciSocketAssertion(error: unknown): boolean {
	return error instanceof Error && (error as NodeJS.ErrnoException).code === "ERR_ASSERTION" && /undici/.test(error.stack ?? "")
}

export interface RunGuardOptions {
	/** Write what the run has so far. Called at most once, with the reason the run stops. */
	save(reason: string): Promise<void> | void
	log?: (line: string) => void
	/** Tests pass a stub. */
	exit?: (code: number) => void
}

/**
 * Keep a run alive on undici's socket assertion, and save its partial results when it must stop: on any other
 * uncaught exception (exit 1), on SIGINT (130) or on SIGTERM (143). A second signal while it saves exits at once.
 * Returns a function that removes the listeners.
 */
export function guardRun(options: RunGuardOptions): () => void {
	const log = options.log ?? ((line: string) => console.error(line))
	const exit = options.exit ?? ((code: number) => process.exit(code))
	let ignored = 0
	let stopping = false

	async function stop(reason: string, code: number): Promise<void> {
		if (stopping) return exit(code)
		stopping = true
		log(`\nrun stopped: ${reason}. Saving the partial results.`)
		try {
			await options.save(reason)
		} catch (error) {
			log(`could not save the partial results: ${error instanceof Error ? error.message : String(error)}`)
		}
		exit(code)
	}

	const onException = (error: unknown) => {
		if (isUndiciSocketAssertion(error)) {
			if (ignored++ === 0) log("[fetch] a server closed a connection before its answer was read; that request fails on its timeout")
			return
		}
		const text = error instanceof Error ? (error.stack ?? error.message) : String(error)
		log(text)
		void stop(`uncaught error: ${error instanceof Error ? error.message : String(error)}`.split("\n")[0], 1)
	}
	const onSigint = () => void stop("interrupted (SIGINT)", 130)
	const onSigterm = () => void stop("terminated (SIGTERM)", 143)

	process.on("uncaughtException", onException)
	process.on("SIGINT", onSigint)
	process.on("SIGTERM", onSigterm)
	return () => {
		process.off("uncaughtException", onException)
		process.off("SIGINT", onSigint)
		process.off("SIGTERM", onSigterm)
	}
}
