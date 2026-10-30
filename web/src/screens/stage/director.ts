import { useEffect, useRef, useState } from "react"
import type { FaceId, FaceState } from "@/lib/faces"
import { AUTHOR, type Act, type Line } from "./derive"
import { sayMany, type Names } from "./words"

/**
 * The director turns the run's lines into beats the eye can follow. The run clock decides what has happened; the
 * director decides when it is shown, on the wall clock, so the motion keeps a human pace at any replay speed.
 *
 * Lines that are due wait in a queue. Every BEAT_GAP ms the most important group in the queue (same speaker, same act,
 * same kind of item) becomes one beat, so a burst of six verdicts is one line: "Checked 6 profiles. All sourced."
 * A seek (or the first frame of a finished run) skips the queue: the Stage jumps to that moment, still.
 */

export interface Beat {
	id: number
	/** performance.now() when it started. */
	at: number
	from: FaceId
	to: FaceId[] | "all"
	act: Act
	text: string
	lines: Line[]
	/** The Critic's verdict lands on this face. */
	stamp?: { on: FaceId; ok: boolean }
	/** Amity ties the company side (Spica) to the researcher side (Tycho). */
	link?: boolean
	/** A face's reaction, for MOOD_MS. */
	mood?: { face: FaceId; state: FaceState }
	finale?: boolean
}

/** Timings on the wall clock, in ms. */
export const BEAT_GAP = 760
export const BUSY_GAP = 520
export const BEAT_MS = 2600
export const MOOD_MS = 2200
export const STAMP_AT = 520

/** What deserves the stage first. */
const WEIGHT: Record<Act, number> = {
	done: 10,
	plan: 9,
	"send-back": 8,
	escalate: 8,
	fail: 8,
	drop: 7,
	decide: 7,
	"no-match": 6,
	"pair-dropped": 6,
	post: 5,
	pass: 4,
	shortlist: 3,
	assign: 2,
}

interface Waiting {
	line: Line
	/** When it joined the queue: older groups gain weight, so nothing waits for ever. */
	since: number
}

function groupKey(line: Line): string {
	return `${line.from}|${line.act}|${line.artifact ?? ""}`
}

function beatOf(id: number, at: number, lines: Line[], names: Names): Beat {
	const first = lines[0]
	const author = first.artifact ? AUTHOR[first.artifact] : first.from
	const to = lines.some((line) => line.to === "all")
		? "all"
		: [...new Set(lines.flatMap((line) => (line.to === "all" ? [] : line.to)))]
	const beat: Beat = { id, at, from: first.from, to, act: first.act, text: sayMany(lines, names), lines }
	switch (first.act) {
		case "pass":
			beat.stamp = { on: author, ok: true }
			beat.mood = { face: author, state: "done" }
			break
		case "send-back":
		case "drop":
			beat.stamp = { on: author, ok: false }
			beat.mood = { face: author, state: "reject" }
			break
		case "escalate":
			beat.stamp = { on: author, ok: false }
			beat.mood = { face: "you", state: "working" }
			break
		case "no-match":
			beat.mood = { face: "amity", state: "reject" }
			break
		case "fail":
			beat.mood = { face: first.from, state: "reject" }
			break
		case "post":
			beat.link = first.artifact === "pair"
			break
		case "done":
			beat.finale = true
			break
	}
	return beat
}

export function useDirector({
	lines,
	clock,
	active,
	speed,
	names,
}: {
	lines: Line[]
	clock: number
	/** Live, or a replay that plays. Paused: the queue waits. */
	active: boolean
	/** Run ms per wall ms, to tell a seek from fast play. Infinity for "instant". */
	speed: number
	names: Names
}): Beat[] {
	const [beats, setBeats] = useState<Beat[]>([])
	const state = useRef({ consumed: -1, queue: [] as Waiting[], lastBeat: 0, lastClock: 0, lastWall: 0, nextId: 1 })

	useEffect(() => {
		const s = state.current
		const now = performance.now()
		const wall = now - s.lastWall
		const seek =
			s.consumed < 0 ||
			s.consumed > lines.length ||
			clock < s.lastClock - 1 ||
			clock - s.lastClock > Math.max(4000, wall * Math.min(speed, 1e6) * 2 + 1500)
		s.lastClock = clock
		s.lastWall = now

		if (seek) {
			let consumed = 0
			while (consumed < lines.length && lines[consumed].ms <= clock) consumed++
			s.consumed = consumed
			s.queue = []
			if (beats.length) setBeats([])
			return
		}

		while (s.consumed < lines.length && lines[s.consumed].ms <= clock) s.queue.push({ line: lines[s.consumed++], since: now })

		let next = beats
		const alive = beats.filter((beat) => now - beat.at < BEAT_MS)
		if (alive.length !== beats.length) next = alive

		const groups = new Map<string, Waiting[]>()
		for (const waiting of s.queue) {
			const key = groupKey(waiting.line)
			groups.set(key, [...(groups.get(key) ?? []), waiting])
		}
		const gap = groups.size > 3 ? BUSY_GAP : BEAT_GAP
		if (active && s.queue.length && now - s.lastBeat >= gap) {
			let best: Waiting[] | null = null
			let bestScore = -Infinity
			for (const group of groups.values()) {
				const score = WEIGHT[group[0].line.act] + (now - group[0].since) / 1500
				if (score > bestScore) {
					best = group
					bestScore = score
				}
			}
			const chosen = new Set(best!)
			s.queue = s.queue.filter((waiting) => !chosen.has(waiting))
			s.lastBeat = now
			next = [...next, beatOf(s.nextId++, now, best!.map((waiting) => waiting.line), names)]
		}
		if (next !== beats) setBeats(next)
	})

	// Paused or still: the last beats still need to leave on time.
	useEffect(() => {
		if (active || beats.length === 0) return
		const timer = window.setTimeout(() => setBeats((current) => current.filter((beat) => performance.now() - beat.at < BEAT_MS)), BEAT_MS)
		return () => window.clearTimeout(timer)
	}, [active, beats])

	return beats
}
