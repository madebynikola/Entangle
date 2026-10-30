import type { Claim, SourceRecord } from "@shared/types"
import { BookOpen, Building2, FileText, Globe, Lightbulb, Target, User } from "lucide-react"
import { useEffect, useState } from "react"
import type * as React from "react"
import { create } from "zustand"
import { Chip } from "@/components/ui/chip"
import { Dialog, DialogDescription, DialogTitle, SheetContent } from "@/components/ui/dialog"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { getBackend } from "@/run/backend"
import { useRunStore } from "@/run/store"

const KIND: Record<SourceRecord["kind"], { label: string; icon: React.ReactNode }> = {
	researcher: { label: "Researcher", icon: <User /> },
	publication: { label: "Publication", icon: <BookOpen /> },
	project: { label: "Project", icon: <FileText /> },
	patent: { label: "Patent", icon: <Lightbulb /> },
	company: { label: "Company", icon: <Building2 /> },
	challenge: { label: "Challenge", icon: <Target /> },
	page: { label: "Company page", icon: <Globe /> },
}

const cache = new Map<string, Promise<SourceRecord | null>>()

/** Fetch one source record (the open run's sources.json first, then the dataset). Cached per run and id. */
export function useSource(id: string | null, runId?: string) {
	const openRun = useRunStore((state) => state.runId)
	runId ??= openRun ?? undefined
	const [state, setState] = useState<{ source: SourceRecord | null; loading: boolean }>({ source: null, loading: Boolean(id) })
	useEffect(() => {
		if (!id) return
		const key = `${runId}:${id}`
		if (!cache.has(key)) cache.set(key, getBackend().then((backend) => backend.getSource(id, runId)))
		let live = true
		setState((prev) => ({ source: prev.source?.id === id ? prev.source : null, loading: true }))
		void cache.get(key)!.then((source) => live && setState({ source, loading: false }))
		return () => {
			live = false
		}
	}, [id, runId])
	return state
}

/** The record behind an id: kind, title, year, text. For a hover card, a sheet or a page. */
export function SourceView({ id, className }: { id: string; className?: string }) {
	const { source, loading } = useSource(id)
	if (loading) {
		return (
			<div className={cn("flex flex-col gap-2", className)}>
				<Skeleton className="h-4 w-24" />
				<Skeleton className="h-5 w-full" />
				<Skeleton className="h-14 w-full" />
			</div>
		)
	}
	if (!source) {
		return (
			<div className={cn("text-sm text-ink-muted", className)}>
				<div className="font-mono text-xs text-ink">{id}</div>
				<p className="mt-1.5">This id is not in the run's sources or the dataset. A claim that cites it has no support.</p>
			</div>
		)
	}
	const kind = KIND[source.kind] ?? KIND.page
	return (
		<div className={cn("flex flex-col gap-1.5", className)}>
			<div className="flex items-center gap-1.5 text-xs text-ink-muted [&_svg]:size-3.5">
				{kind.icon}
				<span>{kind.label}</span>
				<span className="text-ink-subtle">·</span>
				<span className="font-mono">{source.id}</span>
				{source.year && (
					<>
						<span className="text-ink-subtle">·</span>
						<span>{source.year}</span>
					</>
				)}
			</div>
			<div className="font-medium leading-snug text-ink">{source.title}</div>
			<p className="line-clamp-[12] whitespace-pre-line text-sm text-ink-muted">{source.text}</p>
		</div>
	)
}

/** A cited id as a mono chip. Hover (or focus) shows the source record. */
export function SourceChip({ id, className }: { id: string; className?: string }) {
	return (
		<HoverCard openDelay={180} closeDelay={80}>
			<HoverCardTrigger asChild>
				<Chip asChild mono className={className}>
					<button type="button">{id}</button>
				</Chip>
			</HoverCardTrigger>
			<HoverCardContent className="w-96">
				<SourceView id={id} />
			</HoverCardContent>
		</HoverCard>
	)
}

/** A claim with its sources: the text, then one chip per cited id. */
export function ClaimText({ claim, className, struck }: { claim: Claim; className?: string; struck?: boolean }) {
	return (
		<span className={cn("inline", className)}>
			<span className={cn(struck && "text-ink-muted line-through decoration-failed/70")}>{claim.text}</span>
			{claim.sourceIds.length > 0 && (
				<span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">
					{claim.sourceIds.map((id) => (
						<SourceChip key={id} id={id} />
					))}
				</span>
			)}
		</span>
	)
}

// ---------------------------------------------------------------------------
// Source sheet: the full record in a side panel. Open it from anywhere with openSource(id).
// ---------------------------------------------------------------------------

export const useSourceSheet = create<{ id: string | null; open(id: string): void; close(): void }>()((set) => ({
	id: null,
	open: (id) => set({ id }),
	close: () => set({ id: null }),
}))

/** Show a source record in the side panel. */
export function openSource(id: string): void {
	useSourceSheet.getState().open(id)
}

export function SourceSheet() {
	const id = useSourceSheet((state) => state.id)
	return (
		<Dialog open={id != null} onOpenChange={(open) => !open && useSourceSheet.getState().close()}>
			<SheetContent aria-describedby={undefined}>
				<div className="border-b border-hairline px-5 py-4">
					<DialogTitle className="text-md">Source</DialogTitle>
					<DialogDescription>The dataset record a claim cites.</DialogDescription>
				</div>
				<div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-4">{id && <SourceView id={id} />}</div>
			</SheetContent>
		</Dialog>
	)
}
