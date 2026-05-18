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
    const exactIdx = docs.findIndex((d) => normalize(d.name) === normTarget);
    if (exactIdx >= 0) return exactIdx;
  }

  if (classification.documentCode) {
    const sameCode = docs
      .map((d, i) => ({ d, i }))
      .filter(({ d }) => d.code === classification.documentCode);

    if (sameCode.length === 1) return sameCode[0].i;

    if (sameCode.length > 1) {
      let bestIdx = sameCode[0].i;
      let bestScore = -1;
      for (const { d, i } of sameCode) {
        const hint = scoreDistinctiveFilenameHint(fileName, d.name);
        const score = hint.score + tokenOverlapScore(fileName, d.name);
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
      return bestIdx;
    }
  }

  if (classification.documentName) {
    const fuzzyIdx = docs.findIndex((d) =>
      normalize(d.name).includes(normalize(classification.documentName!))
    );
    if (fuzzyIdx >= 0) return fuzzyIdx;
  }

  if (classification.documentCode) {
    return docs.findIndex((d) => d.code === classification.documentCode);
  }

  return -1;
}

function pickBestIndexByFilenameHint(docs: RequiredDocRef[], fileName: string): number {
  let bestIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < docs.length; i += 1) {
    const hint = scoreDistinctiveFilenameHint(fileName, docs[i].name);
    if (hint.score > bestScore) {
      bestScore = hint.score;
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
