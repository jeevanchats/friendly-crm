import { INDUSTRY_TEMPLATES, IndustryKey, LocalizedString } from '../templates';

/**
 * Industries are fully data-driven: they are whatever exists in industry-templates.json.
 * To add an industry, add a template entry there (and its key to IndustryKey in templates.ts).
 * The former hard-coded IndustryType enum (RETAIL / MANUFACTURING / SERVICES / DISTRIBUTION)
 * has been removed so there is a single source of truth.
 */
export interface IndustryMetadata {
  key: IndustryKey;
  name: LocalizedString;
  /** Order stage ids in pipeline order. */
  defaultOrderStages: string[];
}

export function listIndustries(): IndustryMetadata[] {
  return Object.values(INDUSTRY_TEMPLATES).map((t) => ({
    key: t.key,
    name: t.name,
    defaultOrderStages: t.orderStages.map((s) => s.id),
  }));
}
