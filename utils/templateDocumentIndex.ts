/**
 * Build a searchable index of document names from all case templates
 * (same data as GET /api/case-templates) for pre-OCR classification.
 */

import {
  PREDEFINED_DOCUMENT_NAMES,
  OCR_PHRASE_HINTS,
  getOcrCategoriesForDocName,
} from './documentCatalog.js';
import type { RequiredDocRef } from './documentClassifier.js';
import {
  containsTerm,
  documentNamesAlign,
  normalize,
  significantWords,
  tokenOverlapScore,
} from './matchTerms.js';

export interface CatalogDocumentEntry {
  name: string;
  normalizedName: string;
  keywords: string[];
}

function keywordsForDocumentName(name: string): string[] {
  const words = significantWords(name);
  const set = new Set<string>(words);

  for (const cat of getOcrCategoriesForDocName(name)) {
    for (const phrase of OCR_PHRASE_HINTS[cat] || []) {
      const p = normalize(phrase);
      if (p.length >= 4) set.add(p);
    }
  }

  return [...set];
}

function addEntry(
  catalog: CatalogDocumentEntry[],
  seen: Set<string>,
  name: string
): void {
  const trimmed = name?.trim();
  if (!trimmed) return;
  const normalizedName = normalize(trimmed);
  if (!normalizedName || seen.has(normalizedName)) return;
  seen.add(normalizedName);
  catalog.push({
    name: trimmed,
    normalizedName,
    keywords: keywordsForDocumentName(trimmed),
  });
}

export function buildTemplateDocumentCatalog(
  templates: Array<{ required_documents?: Array<{ name?: string; code?: string }> }>
): CatalogDocumentEntry[] {
  const seen = new Set<string>();
  const catalog: CatalogDocumentEntry[] = [];

  for (const name of PREDEFINED_DOCUMENT_NAMES) {
    addEntry(catalog, seen, name);
  }

  for (const template of templates) {
    for (const doc of template.required_documents || []) {
      if (doc?.name) addEntry(catalog, seen, doc.name);
    }
  }

  return catalog;
}

export { tokenOverlapScore as tokenOverlap };

/** Map catalog document name → one client required_documents row (strict). */
export function resolveClientDocForCatalogName(
  catalogName: string,
  clientDocs: RequiredDocRef[]
): RequiredDocRef | null {
  if (!clientDocs.length) return null;

  const exact = clientDocs.find((d) => normalize(d.name) === normalize(catalogName));
  if (exact) return exact;

  let best: RequiredDocRef | null = null;
  let bestScore = 0;

  for (const doc of clientDocs) {
    if (!documentNamesAlign(catalogName, doc.name)) continue;

    let score = tokenOverlapScore(catalogName, doc.name) + 40;

    const shared = significantWords(catalogName).filter((w) =>
      significantWords(doc.name).includes(w)
    );
    score += shared.length * 12;

    if (score > bestScore) {
      bestScore = score;
      best = doc;
    }
  }

  return bestScore >= 50 ? best : null;
}

export function scoreCatalogEntry(searchText: string, entry: CatalogDocumentEntry): number {
  const text = normalize(searchText);
  if (!text) return 0;

  let score = 0;

  if (containsTerm(searchText, entry.name)) {
    score += 92;
  }

  const nameWords = significantWords(entry.name);
  if (nameWords.length >= 2 && nameWords.every((w) => containsTerm(searchText, w))) {
    score += 80;
  }

  score += tokenOverlapScore(searchText, entry.name);

  let keywordHits = 0;
  for (const kw of entry.keywords) {
    if (containsTerm(searchText, kw)) {
      keywordHits += 1;
      score += 28;
    }
  }

  // Require multiple keyword hits for generic catalog names (reduces passport false positives)
  if (keywordHits === 1 && nameWords.length >= 2) {
    score = Math.min(score, 55);
  }

  return Math.min(score, 100);
}
