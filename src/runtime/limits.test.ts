/**
 * The runner's slot queue.
 *
 *   node --import tsx --test src/runtime/limits.test.ts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { Semaphore } from "./limits"

describe("Semaphore", () => {
	it("gives a freed slot to the highest rank, in arrival order within one rank", async () => {
		const slots = new Semaphore(1)
		await slots.acquire()
		const order: string[] = []
		const waiters = [
			["analyze-1", 0],
			["profile-1", 2],
			["write-1", 5],
			["profile-2", 2],
			["analyze-2", 0],
			["write-2", 5],
		].map(([name, rank]) => slots.acquire(rank as number).then(() => order.push(name as string)))
		// Each release is the current holder finishing; the slot passes to the next waiter.
		for (const _ of waiters) {
			slots.release()
			await new Promise((resolve) => setImmediate(resolve))
		}
		await Promise.all(waiters)
		assert.deepEqual(order, ["write-1", "write-2", "profile-1", "profile-2", "analyze-1", "analyze-2"])
		assert.equal(slots.inFlight, 1)
	})

	it("hands out free slots at once, whatever the rank", async () => {
		const slots = new Semaphore(2)
		await slots.acquire(0)
		await slots.acquire(5)
		assert.equal(slots.inFlight, 2)
		slots.release()
		slots.release()
		assert.equal(slots.inFlight, 0)
	})
})
