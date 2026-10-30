export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/** At most `max` holders at once. A freed slot goes to the waiter with the highest rank; within one rank, in arrival order. */
export class Semaphore {
	private active = 0
	private readonly queue: Array<{ rank: number; resolve: () => void }> = []

	constructor(readonly max: number) {}

	get inFlight(): number {
		return this.active
	}

	async acquire(rank = 0): Promise<void> {
		if (this.active < this.max) {
			this.active++
			return
		}
		// release() hands its slot straight to us, so `active` does not change.
		await new Promise<void>((resolve) => {
			const behind = this.queue.findIndex((waiter) => waiter.rank < rank)
			this.queue.splice(behind < 0 ? this.queue.length : behind, 0, { rank, resolve })
		})
	}

	release(): void {
		const next = this.queue.shift()
		if (next) next.resolve()
		else this.active--
	}
}

/**
 * Holds up to `perMinute` tokens and refills at that rate. take(n) waits until n are there.
 * Takers are served in arrival order, so a large take is not starved by small ones.
 * A limit of 0 (or less) turns the counting off; pause() still holds takers.
 */
export class TokenBucket {
	private tokens: number
	private last = Date.now()
	private pausedUntil = 0
	private tail: Promise<void> = Promise.resolve()

	constructor(readonly perMinute: number) {
		this.tokens = perMinute
	}

	take(n: number): Promise<void> {
		if (this.perMinute <= 0 && this.pausedUntil <= Date.now()) return Promise.resolve()
		const turn = this.tail.then(() => this.wait(Math.min(n, this.perMinute)))
		this.tail = turn
		return turn
	}

	/** Hold every taker for `ms`, e.g. after a 429 with retry-after. */
	pause(ms: number): void {
		this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms)
	}

	private async wait(n: number): Promise<void> {
		for (;;) {
			const paused = this.pausedUntil - Date.now()
			if (paused > 0) {
				await sleep(paused)
				continue
			}
			if (this.perMinute <= 0) return
			this.refill()
			if (this.tokens >= n) {
				this.tokens -= n
				return
			}
			await sleep(Math.ceil(((n - this.tokens) / this.perMinute) * 60_000))
		}
	}

	private refill(): void {
		const now = Date.now()
		this.tokens = Math.min(this.perMinute, this.tokens + ((now - this.last) * this.perMinute) / 60_000)
		this.last = now
	}
}
