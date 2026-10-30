import type { SourceId, SourceRecord, SourceStore } from "../../types"

/**
 * An in-memory SourceStore for tests and for runs before the data layer (#8) is wired in.
 * `aliases` maps a merged duplicate's id to its main id, as the real store does (R0139 → R0539).
 */
export class FakeSourceStore implements SourceStore {
	private readonly records = new Map<SourceId, SourceRecord>()

	constructor(
		records: SourceRecord[],
		private readonly aliases: Record<SourceId, SourceId> = {},
	) {
		for (const record of records) this.records.set(record.id, record)
	}

	get(id: SourceId): SourceRecord | undefined {
		return this.records.get(this.aliases[id] ?? id)
	}

	has(id: SourceId): boolean {
		return this.get(id) !== undefined
	}
}
