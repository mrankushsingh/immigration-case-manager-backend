/**
 * Pick exactly one required_documents row for an upload (handles duplicate DOC codes).
 */

import type { RequiredDocRef } from './documentClassifier.js';
import type { ClassificationResult } from './documentClassifier.js';
import {
  normalize,
  scoreDistinctiveFilenameHint,
  tokenOverlapScore,
} from './matchTerms.js';

type DocRow = RequiredDocRef & { fileUrl?: string };

function isOpenSlot(doc: DocRow): boolean {
  return !doc.submitted && !doc.fileUrl;
}

/** Prefer empty checklist rows when several share the same code (batch uploads). */
function preferOpenSlots<T extends { d: DocRow; i: number }>(candidates: T[]): T[] {
  const open = candidates.filter(({ d }) => isOpenSlot(d));
  return open.length > 0 ? open : candidates;
}

export function resolveRequiredDocTargetIndex(
  docs: RequiredDocRef[],
  classification: Pick<ClassificationResult, 'documentCode' | 'documentName'>,
  fileName: string
): number {
  if (!docs?.length) return -1;

  const byFilenameHint = pickBestIndexByFilenameHint(docs, fileName);
  if (byFilenameHint >= 0) {
    const hint = scoreDistinctiveFilenameHint(fileName, docs[byFilenameHint].name);
    if (hint.score >= 85) return byFilenameHint;
  }

  if (classification.documentName) {
    const normTarget = normalize(classification.documentName);
    const exactMatches = docs
      .map((d, i) => ({ d, i }))
      .filter(({ d }) => normalize(d.name) === normTarget);
    if (exactMatches.length === 1) return exactMatches[0].i;
    if (exactMatches.length > 1) {
      return pickBestScoredIndex(preferOpenSlots(exactMatches), fileName);
    }
  }

  if (classification.documentCode) {
    const sameCode = preferOpenSlots(
      docs
        .map((d, i) => ({ d, i }))
        .filter(({ d }) => d.code === classification.documentCode)
    );

    if (sameCode.length === 1) return sameCode[0].i;

    if (sameCode.length > 1) {
      return pickBestScoredIndex(sameCode, fileName);
    }
  }

  if (classification.documentName) {
    const fuzzyMatches = preferOpenSlots(
      docs
        .map((d, i) => ({ d, i }))
        .filter(({ d }) =>
          normalize(d.name).includes(normalize(classification.documentName!))
        )
    );
    if (fuzzyMatches.length > 0) return fuzzyMatches[0].i;
  }

  if (classification.documentCode) {
    const codeMatches = preferOpenSlots(
      docs.map((d, i) => ({ d, i })).filter(({ d }) => d.code === classification.documentCode)
    );
    if (codeMatches.length > 0) return codeMatches[0].i;
  }

  return -1;
}

function pickBestScoredIndex(
  candidates: Array<{ d: DocRow; i: number }>,
  fileName: string
): number {
  let bestIdx = candidates[0].i;
  let bestScore = -1;
  for (const { d, i } of candidates) {
    const hint = scoreDistinctiveFilenameHint(fileName, d.name);
    const score = hint.score + tokenOverlapScore(fileName, d.name);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function pickBestIndexByFilenameHint(docs: RequiredDocRef[], fileName: string): number {
  let bestIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < docs.length; i += 1) {
    const hint = scoreDistinctiveFilenameHint(fileName, docs[i].name);
    const row = docs[i] as DocRow;
    const openBonus = isOpenSlot(row) ? 0.5 : 0;
    const score = hint.score + openBonus;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function applyFileToRequiredDocAtIndex(
  docs: RequiredDocRef[],
  targetIndex: number,
  filePayload: {
    fileUrl: string;
    fileName: string;
    fileSize: number;
    uploadedBy: string;
  }
): RequiredDocRef[] {
  if (targetIndex < 0 || targetIndex >= docs.length) return docs;

  return docs.map((doc, i) => {
    if (i !== targetIndex) return doc;

    return {
      ...doc,
      submitted: true,
      fileUrl: filePayload.fileUrl,
      uploadedAt: new Date().toISOString(),
      fileName: filePayload.fileName,
      fileSize: filePayload.fileSize,
      uploadedBy: filePayload.uploadedBy,
    };
  });
}
