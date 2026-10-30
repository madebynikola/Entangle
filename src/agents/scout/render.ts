import { INNOVATION_FUND_URL, grantText } from "../../data/eucalls"
import type { FundingMatch } from "../../types"

/**
 * The Scout's answer as a proposal section. Title, programme, deadline, grant and link come from the portal;
 * only the reason and the check are the Scout's. The Critic does not review this section, so it says so.
 */
export function fundingMarkdown(match: FundingMatch): string {
	const lines = ["## Where to apply", ""]
	if (match.calls.length) {
		lines.push("Open or upcoming EU calls that cover this work, found by the Funding Scout in the EU Funding & Tenders portal:", "")
		for (const { call, reason, check } of match.calls) {
			const when = call.status === "open" ? `Open, deadline ${call.deadline}` : `Opens ${call.opens ?? "soon"}, deadline ${call.deadline}`
			const kind = [call.programme, call.action, call.openCallBy && `open call of ${call.openCallBy}`, grantText(call.grant)].filter(Boolean).join(" · ")
			lines.push(`- **[${call.title}](${call.url})** (${call.identifier}). ${kind}. ${when}.`)
			lines.push(`  ${reason}${check ? ` Check: ${check}` : ""}`)
		}
	} else {
		lines.push(`No open EU call fits this work. ${match.noneReason ?? ""}`.trim())
	}
	lines.push(
		"",
		`Serbia's Innovation Fund has no API: see its current calls at ${INNOVATION_FUND_URL}.`,
		"",
		"_The Scout picks calls and writes the reason. The call facts come from the portal. The Critic does not review this section._",
	)
	return lines.join("\n") + "\n"
}
