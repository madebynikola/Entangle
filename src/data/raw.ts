/** Record shapes of `data/raw/data/*` as the dataset ships them (dataset version 2.0, see docs/dataset.md). */

export interface RawResearcher {
	id: string
	name: string
	title: string
	institution: string
	faculty: string
	department: string
	fields: string[]
	keywords: string[]
	bio: string
	publications: string[]
	projects: string[]
	patents: string[]
	open_to: string[]
	industry_experience: string
	notes: string
	language: string
}

export interface RawAuthor {
	name: string
	/** Null for outside co-authors. The only valid link to a researcher. */
	researcher_id: string | null
	affiliation: string
}

export interface RawPublication {
	id: string
	title: string
	abstract: string
	year: number
	venue: string
	type: string
	keywords: string[]
	authors: RawAuthor[]
}

export interface RawProject {
	id: string
	acronym: string
	title: string
	programme: string
	years: string
	summary: string
	partners: string[]
	participants: Array<{ researcher_id: string; role: string }>
}

export interface RawPatent {
	id: string
	title: string
	year: number
	status: string
	abstract: string
	inventors: Array<{ researcher_id: string; name: string }>
}

export interface RawChallenge {
	id: string
	text: string
	detail: string
}

export interface RawCompany {
	id: string
	name: string
	sector: string
	employees: number
	founded: number
	location: string
	about: string
	products: string[]
	tech: string[]
	challenges: RawChallenge[]
	plans: string
	rd_capacity: string
	past_collaborations: string
	language: string
}

export interface RawPage {
	company_id: string
	kind: "job" | "news" | "website" | "blog" | "event" | string
	title: string
	date: string
	text: string
}

/** The JSON files wrap their records: `{ name, version, note, researchers: [...] }`. */
export interface RawFiles {
	researchers: RawResearcher[]
	publications: RawPublication[]
	projects: RawProject[]
	patents: RawPatent[]
	companies: RawCompany[]
	pages: RawPage[]
}
