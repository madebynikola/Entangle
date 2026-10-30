/**
 * The data layer: load the EINSTEIN dataset once, normalise it, look up any cited id, search it.
 * No LLM and no API keys. See docs/dataset.md for what the data looks like and why it is cleaned this way.
 *
 *   const data = loadDataset()                 // or loadDataset(FIXTURE_DIR) for 5 companies, 30 researchers
 *   data.sources.get("SYN-PUB-00001")          // SourceStore for the Critic
 *   findResearchersForNeed(data, "anomaly detection in industrial network traffic", 10)
 *   createDataTools(data)                      // Mozaik tools for agents
 *   shardCompanies(data, 4)                    // id ranges for parallel Analysts
 */
export * from "./dataset"
export * from "./search"
export * from "./shards"
export * from "./tools"
export { DUPLICATES, type ResearcherStatus } from "./normalize"
export { fold, toLatin } from "./text"
