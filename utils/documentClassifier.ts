/**
 * Classify uploads against the client's required checklist.
 * Order: (1) all case-template document names + keywords on filename,
 *        (2) OCR on scan, (3) optional Gemini.
 */

import { extractDocumentText } from './documentOcr.js';
import {
  OCR_PHRASE_HINTS,
  getOcrCategoriesForDocName,
  PREDEFINED_DOCUMENT_NAMES,
} from './documentCatalog.js';
import {
  buildTemplateDocumentCatalog,
  resolveClientDocForCatalogName,
  scoreCatalogEntry,
  type CatalogDocumentEntry,
} from './templateDocumentIndex.js';
import {
  containsTerm,
  isVagueFilename,
  normalize,
  scoreDistinctiveFilenameHint,
  significantWords,
  tokenOverlapScore,
} from './matchTerms.js';

export interface RequiredDocRef {
  code: string;
  name: string;
  description?: string;
  submitted?: boolean;
}

export interface ClassificationResult {
  documentCode: string | null;
  documentName: string | null;
  confidence: number;
  method: 'keywords' | 'template-catalog' | 'ocr' | 'gemini' | 'none';
  reason?: string;
  ocrPreview?: string;
}

export interface ClassifyDocumentOptions {
  /** All rows from GET /api/case-templates — used before OCR */
  allTemplates?: Array<{ required_documents?: Array<{ name?: string; code?: string }> }>;
}

const DOCUMENT_TYPE_KEYWORDS: Record<string, string[]> = {
  passport: ['pasaporte', 'passport', 'passporte', 'republica', 'nationality', 'nacionalidad'],
  passport_copy: ['copia completa del pasaporte', 'copia pasaporte', 'passport copy'],
  old_passport: ['pasaporte anterior', 'old passport'],
  visa: ['visa', 'visado', 'schengen'],
  tie: ['tie', 'tarjeta de residencia', 'residence card', 'extranjero', 'identidad de extranjero'],
  nie: ['nie', 'certificado de registro', 'ciudadano ue', 'union europea'],
  dni: ['dni', 'documento nacional de identidad', 'ministerio del interior', 'copia de dni'],
  empadronamiento: ['empadronamiento', 'padron', 'padrón', 'ayuntamiento'],
  convivencia: ['convivencia', 'cohabitation'],
  criminal_record: ['antecedentes penales', 'criminal record', 'penados', 'penales'],
  medical: ['certificado medico', 'certificado médico', 'medical certificate'],
  health_insurance: ['seguro de salud', 'health insurance', 'seguro medico'],
  work_contract: ['contrato de trabajo', 'employment contract'],
  payslip: ['nomina', 'nómina', 'payslip', 'devengos', 'salario'],
  tax: ['irpf', 'impuesto', 'declaracion', 'declaración', 'hacienda', 'renta'],
  bank: ['extracto bancario', 'bank statement', 'certificado bancario', 'iban'],
  birth_certificate: ['nacimiento', 'birth certificate', 'registro civil'],
  marriage: ['matrimonio', 'marriage certificate'],
  divorce: ['divorcio', 'sentencia', 'separacion', 'separación'],
  family_book: ['libro de familia', 'family book'],
  education: ['titulacion', 'titulación', 'homologada', 'universidad'],
  labor_report: ['vida laboral', 'labor history', 'tesoro publico'],
  economic_means: ['medios economicos', 'medios económicos'],
  vat: ['iva', 'vat', 'modelo 303'],
  social_security: ['seguridad social', 'social security'],
  tax_agency: ['agencia tributaria', 'tax agency'],
  employer_dni: ['empleador', 'employer'],
  authorization_parent: ['autorizacion', 'autorización', 'progenitor'],
  immigration_form: [
    'formulario ex',
    'solicitud ex',
    'modelo ex',
    'ex 24',
    'ex-24',
    'ex 15',
    'ex-15',
    'ex 17',
    'ex-17',
    'expediente ex',
  ],
};

/** Minimum score to assign a required-document slot (avoids wrong guesses). */
export const MIN_CONFIDENCE = 58;
const PRE_OCR_MIN_CONFIDENCE = 62;
const OCR_PREVIEW_LEN = 120;

const PASSPORT_LIKE = /pasaporte|passport/i;

function scoreRequiredDoc(
  searchText: string,
  doc: RequiredDocRef,
  source: 'filename' | 'ocr'
): { score: number; reason: string } {
  const docName = normalize(doc.name);
  const docCode = normalize(doc.code);
  let score = 0;
  const reasons: string[] = [];
  const ocrBoost = source === 'ocr' ? 1.15 : 1;

  const filenameHint = scoreDistinctiveFilenameHint(searchText, doc.name);
  if (filenameHint.score > 0) {
    score += Math.round(filenameHint.score * ocrBoost);
    reasons.push(filenameHint.reason);
  }

  if (containsTerm(searchText, doc.name)) {
    score += Math.round(92 * ocrBoost);
    reasons.push(source === 'ocr' ? 'OCR matches document name' : 'filename matches document name');
  } else {
    const nameWords = significantWords(doc.name);
    if (nameWords.length >= 2 && nameWords.every((w) => containsTerm(searchText, w))) {
      score += Math.round(85 * ocrBoost);
      reasons.push('all document name words found');
    }
  }

  score += Math.round(tokenOverlapScore(searchText, doc.name) * ocrBoost);
  if (doc.description) {
    score += Math.min(Math.round(tokenOverlapScore(searchText, doc.description) * ocrBoost), 18);
  }

  if (docCode.length >= 4 && containsTerm(searchText, doc.code)) {
    score += Math.round(35 * ocrBoost);
    reasons.push('matches document code');
  }

  for (const [, keywords] of Object.entries(DOCUMENT_TYPE_KEYWORDS)) {
    const docHits = keywords.some((k) => containsTerm(doc.name, k));
    if (!docHits) continue;

    const matchedKeywords = keywords.filter((k) => containsTerm(searchText, k));
    if (matchedKeywords.length === 0) continue;

    const isPassportDoc = PASSPORT_LIKE.test(doc.name);
    if (isPassportDoc && matchedKeywords.length < 2 && source === 'ocr') {
      continue;
    }

    score += Math.round((40 + matchedKeywords.length * 22) * ocrBoost);
    reasons.push(`keyword: ${matchedKeywords[0]}`);
  }

  const ocrCategories = getOcrCategoriesForDocName(doc.name);
  let phraseHitCount = 0;
  for (const cat of ocrCategories) {
    const phrases = OCR_PHRASE_HINTS[cat] || [];
    for (const p of phrases) {
      if (containsTerm(searchText, p)) {
        phraseHitCount += 1;
        if (phraseHitCount <= 2) {
          score += Math.round(35 * ocrBoost);
          reasons.push(`phrase: ${p}`);
        }
      }
    }
  }

  if (PASSPORT_LIKE.test(doc.name) && phraseHitCount < 2 && source === 'ocr' && score < 70) {
    score = Math.min(score, 50);
  }

  if (!doc.submitted) {
    score += 5;
  }

  return {
    score: Math.min(Math.round(score), 100),
    reason: reasons.join('; ') || `${source} overlap`,
  };
}

type MatchCandidate = {
  doc: RequiredDocRef;
  score: number;
  reason: string;
  method: 'keywords' | 'template-catalog' | 'ocr';
};

function pickBestFromCatalog(
  searchText: string,
  clientDocs: RequiredDocRef[],
  catalog: CatalogDocumentEntry[],
  useOcr: boolean,
  minScore: number
): MatchCandidate | null {
  if (!searchText.trim() || !catalog.length) return null;

  let best: MatchCandidate | null = null;

  for (const entry of catalog) {
    const catalogScore = scoreCatalogEntry(searchText, entry);
    if (catalogScore < minScore) continue;

    const clientDoc = resolveClientDocForCatalogName(entry.name, clientDocs);
    if (!clientDoc) continue;

    const method = useOcr ? 'ocr' : 'template-catalog';
    const reason = `${useOcr ? 'OCR' : 'Filename'} matched template doc "${entry.name}"`;

    if (!best || catalogScore > best.score) {
      best = { doc: clientDoc, score: catalogScore, reason, method };
    }
  }

  return best;
}

function pickBestByClientFilenameHint(
  fileName: string,
  requiredDocuments: RequiredDocRef[]
): MatchCandidate | null {
  let best: MatchCandidate | null = null;
  for (const doc of requiredDocuments) {
    const hint = scoreDistinctiveFilenameHint(fileName, doc.name);
    if (hint.score >= 85 && (!best || hint.score > best.score)) {
      best = {
        doc,
        score: hint.score,
        reason: hint.reason,
        method: 'keywords',
      };
    }
  }
  return best;
}

function preferCandidate(
  current: MatchCandidate | null,
  candidate: MatchCandidate | null
): MatchCandidate | null {
  if (candidate && (!current || candidate.score > current.score)) {
    return candidate;
  }
  return current;
}

function pickBestMatch(
  fileName: string,
  ocrText: string,
  requiredDocuments: RequiredDocRef[],
  catalog: CatalogDocumentEntry[]
): MatchCandidate | null {
  let best: MatchCandidate | null = null;
  const vagueName = isVagueFilename(fileName);
  const filenameHint = pickBestByClientFilenameHint(fileName, requiredDocuments);

  if (!vagueName) {
    best = preferCandidate(
      best,
      pickBestFromCatalog(fileName, requiredDocuments, catalog, false, PRE_OCR_MIN_CONFIDENCE)
    );
  }

  for (const doc of requiredDocuments) {
    const fileScore = scoreRequiredDoc(fileName, doc, 'filename');
    const minFile =
      vagueName
        ? containsTerm(fileName, doc.name)
          ? PRE_OCR_MIN_CONFIDENCE
          : 999
        : PRE_OCR_MIN_CONFIDENCE;
    if (fileScore.score >= minFile) {
      best = preferCandidate(best, {
        doc,
        score: fileScore.score,
        reason: fileScore.reason,
        method: 'keywords',
      });
    }
  }

  if (ocrText.length >= 20) {
    best = preferCandidate(
      best,
      pickBestFromCatalog(ocrText, requiredDocuments, catalog, true, MIN_CONFIDENCE)
    );

    for (const doc of requiredDocuments) {
      const ocrScore = scoreRequiredDoc(ocrText, doc, 'ocr');
      if (ocrScore.score >= MIN_CONFIDENCE) {
        best = preferCandidate(best, {
          doc,
          score: ocrScore.score,
          reason: ocrScore.reason,
          method: 'ocr',
        });
      }
    }
  }

  if (filenameHint !== null && filenameHint.score >= 88) {
    const bestScore = best ? best.score : 0;
    const bestMethod = best ? best.method : 'none';
    if (
      filenameHint.score > bestScore ||
      (filenameHint.score >= 92 && bestMethod === 'ocr' && filenameHint.score > bestScore)
    ) {
      best = filenameHint;
    }
  }

  return best;
}

export function classifyByKeywords(
  fileName: string,
  requiredDocuments: RequiredDocRef[],
  ocrText = '',
  catalog: CatalogDocumentEntry[] = []
): ClassificationResult {
  if (!requiredDocuments?.length) {
    return {
      documentCode: null,
      documentName: null,
      confidence: 0,
      method: 'none',
      reason: 'No required documents on this client',
    };
  }

  const best = pickBestMatch(fileName, ocrText, requiredDocuments, catalog);
  const minScore = ocrText ? MIN_CONFIDENCE : PRE_OCR_MIN_CONFIDENCE;

  if (!best || best.score < minScore) {
    return {
      documentCode: null,
      documentName: null,
      confidence: best?.score ?? 0,
      method: ocrText ? 'ocr' : 'template-catalog',
      reason: best
        ? `Best guess "${best.doc.name}" (${best.score}%) — below threshold`
        : 'No match in templates or keywords',
      ocrPreview: ocrText ? ocrText.slice(0, OCR_PREVIEW_LEN) : undefined,
    };
  }

  return {
    documentCode: best.doc.code,
    documentName: best.doc.name,
    confidence: best.score,
    method: best.method,
    reason: best.reason,
    ocrPreview: ocrText ? ocrText.slice(0, OCR_PREVIEW_LEN) : undefined,
  };
}

async function classifyWithGemini(
  fileName: string,
  mimeType: string,
  buffer: Buffer,
  requiredDocuments: RequiredDocRef[],
  ocrText: string,
  catalog: CatalogDocumentEntry[]
): Promise<ClassificationResult | null> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || requiredDocuments.length === 0) return null;

  const isImage = mimeType.startsWith('image/');
  const isPdf = mimeType === 'application/pdf';
  if (!isImage && !isPdf) return null;

  const allTemplateNames = catalog.map((c) => c.name).slice(0, 60).join('\n- ');
  const docList = requiredDocuments
    .map((d, i) => `${i + 1}. code="${d.code}" name="${d.name}"`)
    .join('\n');

  const prompt = `You are an immigration document classifier for a Spanish law firm.
Pick the ONE best matching required document for this client from the client list.
Use the master template document names as reference types.

Master template document names (from case-templates):
- ${allTemplateNames}

File name: ${fileName}
${ocrText ? `OCR text:\n${ocrText.slice(0, 1500)}` : ''}

Client required documents (pick code from HERE only):
${docList}

Reply ONLY JSON: {"code":"CLIENT_CODE or null","confidence":0-100,"reason":"brief"}`;

  try {
    const parts: Array<Record<string, unknown>> = [
      { text: prompt },
      {
        inline_data: {
          mime_type: mimeType,
          data: buffer.toString('base64'),
        },
      },
    ];

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 256 },
        }),
      }
    );

    if (!res.ok) {
      console.warn('Gemini classify failed:', res.status, await res.text());
      return null;
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as {
      code?: string | null;
      confidence?: number;
      reason?: string;
    };

    if (!parsed.code || parsed.code === 'null' || parsed.code === 'NONE') {
      return {
        documentCode: null,
        documentName: null,
        confidence: parsed.confidence ?? 0,
        method: 'gemini',
        reason: parsed.reason ?? 'Gemini: no match',
        ocrPreview: ocrText?.slice(0, OCR_PREVIEW_LEN),
      };
    }

    const matched = requiredDocuments.find(
      (d) => d.code === parsed.code || normalize(d.code) === normalize(String(parsed.code))
    );
    if (!matched) return null;

    const confidence = Math.min(100, Math.max(0, Number(parsed.confidence) || 75));
    if (confidence < MIN_CONFIDENCE) {
      return {
        documentCode: null,
        documentName: null,
        confidence,
        method: 'gemini',
        reason: parsed.reason,
        ocrPreview: ocrText?.slice(0, OCR_PREVIEW_LEN),
      };
    }

    return {
      documentCode: matched.code,
      documentName: matched.name,
      confidence,
      method: 'gemini',
      reason: parsed.reason ?? 'AI match',
      ocrPreview: ocrText?.slice(0, OCR_PREVIEW_LEN),
    };
  } catch (err) {
    console.warn('Gemini classification error:', err);
    return null;
  }
}

export async function classifyDocument(
  fileName: string,
  mimeType: string,
  buffer: Buffer,
  requiredDocuments: RequiredDocRef[],
  options: ClassifyDocumentOptions = {}
): Promise<ClassificationResult> {
  const catalog = buildTemplateDocumentCatalog(options.allTemplates || []);
  const isScannable = mimeType === 'application/pdf' || mimeType.startsWith('image/');

  console.log(
    `📋 Template catalog: ${catalog.length} document names (pre-OCR match, then OCR if needed)`
  );

  // —— Phase 1: template names + keywords on filename only (no OCR) ——
  const preOcrResult = classifyByKeywords(fileName, requiredDocuments, '', catalog);
  if (preOcrResult.documentCode && preOcrResult.confidence >= PRE_OCR_MIN_CONFIDENCE) {
    console.log(
      `✅ Pre-OCR match: ${preOcrResult.documentName} (${preOcrResult.confidence}%) — ${preOcrResult.reason}`
    );
    return preOcrResult;
  }

  // —— Phase 2: OCR, then match template names + keywords again ——
  let ocrText = '';
  if (isScannable) {
    const extraction = await extractDocumentText(buffer, mimeType, fileName);
    ocrText = extraction.text;
    if (extraction.text) {
      console.log(
        `📄 OCR [${extraction.method}] ${extraction.pageCount ?? '?'} pg: ${extraction.text.slice(0, 80)}…`
      );
    }
  }

  const ocrResult = classifyByKeywords(fileName, requiredDocuments, ocrText, catalog);
  if (ocrResult.documentCode && ocrResult.confidence >= MIN_CONFIDENCE) {
    return ocrResult;
  }

  const geminiResult = await classifyWithGemini(
    fileName,
    mimeType,
    buffer,
    requiredDocuments,
    ocrText,
    catalog
  );
  if (geminiResult?.documentCode && geminiResult.confidence >= MIN_CONFIDENCE) {
    return geminiResult;
  }

  return {
    documentCode: null,
    documentName: null,
    confidence: Math.max(ocrResult.confidence, preOcrResult.confidence),
    method: 'none',
    reason: vagueFilenameLabel(fileName)
      ? `Filename "${fileName}" is too vague — add to All Documents or rename (e.g. pasaporte.pdf)`
      : 'No confident match — file saved to All Documents',
    ocrPreview: ocrText ? ocrText.slice(0, OCR_PREVIEW_LEN) : undefined,
  };
}

function vagueFilenameLabel(fileName: string): boolean {
  return isVagueFilename(fileName);
}
