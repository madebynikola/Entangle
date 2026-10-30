import type { RunInfo } from "@shared/server/api"
import * as format from "@/lib/format"

const TIMESTAMP_ID = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/

/** How a run is named in lists: "Sample run", a named folder ("golden"), or its start time ("30 Oct, 10:52:07"). */
export function runLabel(info: Pick<RunInfo, "id" | "startedAt" | "sample">): string {
	if (info.sample) return "Sample run"
	if (!TIMESTAMP_ID.test(info.id)) return info.id
	return format.dateTime(info.startedAt ?? info.id.slice(0, 10), true)
}
