import { cn } from "@/lib/utils"
import { ROLE_CLASS, ROLE_INFO, type RoleKey } from "@/lib/roles"

/** The role's colour as a small square. */
export function RoleSquare({ role, className }: { role: RoleKey; className?: string }) {
	return (
		<span
			aria-hidden
			data-slot="role-square"
			className={cn("inline-block size-2.5 shrink-0 rounded-[3px]", ROLE_CLASS[role].bg, className)}
		/>
	)
}

/** Square plus a name: "■ profiler-3". Without children it shows the role's label. */
export function RoleTag({
	role,
	children,
	className,
	tinted,
}: {
	role: RoleKey
	children?: React.ReactNode
	className?: string
	/** Colour the text too, for places where the role is the point. */
	tinted?: boolean
}) {
	return (
		<span
			data-slot="role-tag"
			title={ROLE_INFO[role].job || undefined}
			className={cn("inline-flex min-w-0 items-center gap-1.5", tinted && ROLE_CLASS[role].text, className)}
		>
			<RoleSquare role={role} />
			<span className="truncate">{children ?? ROLE_INFO[role].label}</span>
		</span>
	)
}
