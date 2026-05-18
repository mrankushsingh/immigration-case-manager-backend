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

export interface CatalogDocumentEntry {
  name: string;
  normalizedName: string;
  keywords: string[];
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function keywordsForDocumentName(name: string): string[] {
  const words = normalize(name)
    .split(' ')
    .filter((w) => w.length > 3);
  const set = new Set<string>(words);

  for (const cat of getOcrCategoriesForDocName(name)) {
    for (const phrase of OCR_PHRASE_HINTS[cat] || []) {
      const p = normalize(phrase);
      if (p.length > 2) set.add(p);
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

/** All unique document names from predefined list + every case template. */
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

export function tokenOverlap(a: string, b: string): number {
  const wordsA = new Set(normalize(a).split(' ').filter((w) => w.length > 3));
  const wordsB = normalize(b).split(' ').filter((w) => w.length > 3);
  if (wordsA.size === 0 || wordsB.length === 0) return 0;
  let hits = 0;
  for (const w of wordsB) {
    if (wordsA.has(w)) hits += 1;
  }
  return Math.round((hits / Math.max(wordsB.length, 1)) * 40);
}

/** Map a catalog / template document name to this client's required_documents slot. */
export function resolveClientDocForCatalogName(
  catalogName: string,
  clientDocs: RequiredDocRef[]
): RequiredDocRef | null {
  if (!clientDocs.length) return null;

  const normCatalog = normalize(catalogName);

  const exact = clientDocs.find((d) => normalize(d.name) === normCatalog);
  if (exact) return exact;

  let best: RequiredDocRef | null = null;
  let bestScore = 0;

  for (const doc of clientDocs) {
    const normDoc = normalize(doc.name);
    let score = tokenOverlap(catalogName, doc.name);

    if (normCatalog.includes(normDoc) || normDoc.includes(normCatalog)) {
      score += 50;
    }

    const catalogWords = normCatalog.split(' ').filter((w) => w.length > 4);
    const docWords = normDoc.split(' ').filter((w) => w.length > 4);
    const shared = catalogWords.filter((w) => docWords.includes(w));
    score += shared.length * 15;

    if (score > bestScore) {
      bestScore = score;
      best = doc;
    }
  }

  return bestScore >= 28 ? best : null;
}

export function scoreCatalogEntry(searchText: string, entry: CatalogDocumentEntry): number {
  const text = normalize(searchText);
  if (!text) return 0;

  let score = 0;

  if (text.includes(entry.normalizedName)) {
    score += 90;
  }

  const nameWords = entry.normalizedName.split(' ').filter((w) => w.length > 4);
  if (nameWords.length > 0 && nameWords.every((w) => text.includes(w))) {
    score += 85;
  }

  score += tokenOverlap(searchText, entry.name);

  for (const kw of entry.keywords) {
    if (kw.length > 3 && text.includes(kw)) {
      score += 35;
    }
  }

  return Math.min(score, 100);
}
