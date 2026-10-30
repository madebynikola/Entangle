/** Plain-word formatting for dense metric lines: "61k tokens · ~$0.42 · 1m 12s". */

export function tokens(n: number): string {
	if (n < 1000) return String(Math.round(n))
	if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`
	if (n < 1_000_000) return `${Math.round(n / 1000)}k`
	return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`
}

/** "~$0.42". Small amounts keep enough digits to be non-zero. */
export function usd(n: number | null | undefined): string {
	if (n == null) return "—"
	if (n === 0) return "$0"
	if (n < 0.01) return `~$${n.toFixed(4)}`
	if (n < 10) return `~$${n.toFixed(2)}`
	return `~$${n.toFixed(1)}`
}

/** 850 ms, 4.2 s, 1m 12s, 1h 03m. */
export function duration(ms: number | null | undefined): string {
	if (ms == null || !Number.isFinite(ms)) return "—"
	if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`
	const s = ms / 1000
	if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`
	const m = Math.floor(s / 60)
	if (m < 60) return `${m}m ${String(Math.floor(s % 60)).padStart(2, "0")}s`
	return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`
}

/** Playhead clock: 0:42, 12:05, 1:02:03. */
export function clock(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000))
	const h = Math.floor(total / 3600)
	const m = Math.floor((total % 3600) / 60)
	const s = String(total % 60).padStart(2, "0")
	return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`
}

/** "just now", "3 min ago", "yesterday", "26 Oct". */
export function ago(iso: string | number | null | undefined, now = Date.now()): string {
	if (iso == null) return "—"
	const t = typeof iso === "number" ? iso : Date.parse(iso)
	const s = (now - t) / 1000
	if (s < 45) return "just now"
	if (s < 3600) return `${Math.round(s / 60)} min ago`
	if (s < 86_400) return `${Math.round(s / 3600)} h ago`
	if (s < 172_800) return "yesterday"
	return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" })
}

/** "30 Oct, 10:52", or "30 Oct, 10:52:07" with seconds. */
export function dateTime(iso: string | number | null | undefined, seconds = false): string {
	if (iso == null) return "—"
	return new Date(iso).toLocaleString(undefined, {
		day: "numeric",
		month: "short",
		hour: "2-digit",
		minute: "2-digit",
		second: seconds ? "2-digit" : undefined,
	})
}

export function plural(n: number, one: string, many = `${one}s`): string {
	return `${n} ${n === 1 ? one : many}`
}

/** 0.82 → "82%". Only for pair fit, never for people. */
export function percent(n: number): string {
	return `${Math.round(n * 100)}%`
}
