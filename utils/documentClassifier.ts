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
  tokenOverlap,
  type CatalogDocumentEntry,
} from './templateDocumentIndex.js';

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
  dni: ['dni', 'documento nacional de identidad', 'ministerio del interior'],
  empadronamiento: ['empadronamiento', 'padron', 'padrón', 'ayuntamiento'],
  convivencia: ['convivencia', 'cohabitation'],
  criminal_record: ['antecedentes penales', 'criminal record', 'penados'],
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
};

const MIN_CONFIDENCE = 42;
const PRE_OCR_MIN_CONFIDENCE = 45;
const OCR_PREVIEW_LEN = 120;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreRequiredDoc(
  searchText: string,
  doc: RequiredDocRef,
  source: 'filename' | 'ocr'
): { score: number; reason: string } {
  const text = normalize(searchText);
  const docName = normalize(doc.name);
  const docCode = normalize(doc.code);
  let score = 0;
  const reasons: string[] = [];
  const ocrBoost = source === 'ocr' ? 1.15 : 1;

  if (
    text.includes(docName) ||
    (docName.length > 8 && docName.split(' ').filter((w) => w.length > 4).every((w) => text.includes(w)))
  ) {
    score += Math.round(92 * ocrBoost);
    reasons.push(source === 'ocr' ? 'OCR matches document name' : 'filename matches document name');
  }

  score += Math.round(tokenOverlap(searchText, doc.name) * ocrBoost);
  if (doc.description) {
    score += Math.min(Math.round(tokenOverlap(searchText, doc.description) * ocrBoost), 18);
  }

  if (docCode.length > 3 && text.includes(docCode)) {
    score += Math.round(35 * ocrBoost);
    reasons.push('matches document code');
  }

  for (const [, keywords] of Object.entries(DOCUMENT_TYPE_KEYWORDS)) {
    const textHits = keywords.some((k) => text.includes(normalize(k)));
    const docHits = keywords.some((k) => docName.includes(normalize(k)));
    if (textHits && docHits) {
      score += Math.round(78 * ocrBoost);
      reasons.push(`keyword: ${keywords[0]}`);
    }
  }

  const ocrCategories = getOcrCategoriesForDocName(doc.name);
  for (const cat of ocrCategories) {
    const phrases = OCR_PHRASE_HINTS[cat] || [];
    const phraseHits = phrases.filter((p) => text.includes(normalize(p)));
    if (phraseHits.length > 0) {
      score += Math.round((50 + phraseHits.length * 12) * ocrBoost);
      reasons.push(`phrase: ${phraseHits[0]}`);
    }
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
  useOcr: boolean
): MatchCandidate | null {
  if (!searchText.trim() || !catalog.length) return null;

  let best: MatchCandidate | null = null;

  for (const entry of catalog) {
    const catalogScore = scoreCatalogEntry(searchText, entry);
    if (catalogScore < PRE_OCR_MIN_CONFIDENCE) continue;

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

function pickBestMatch(
  fileName: string,
  ocrText: string,
  requiredDocuments: RequiredDocRef[],
  catalog: CatalogDocumentEntry[]
): MatchCandidate | null {
  let best: MatchCandidate | null = null;

  const consider = (candidate: MatchCandidate | null) => {
    if (candidate && (!best || candidate.score > best.score)) {
      best = candidate;
    }
  };

  consider(pickBestFromCatalog(fileName, requiredDocuments, catalog, false));

  for (const doc of requiredDocuments) {
    const fileScore = scoreRequiredDoc(fileName, doc, 'filename');
    if (fileScore.score >= PRE_OCR_MIN_CONFIDENCE) {
      consider({
        doc,
        score: fileScore.score,
        reason: fileScore.reason,
        method: 'keywords',
      });
    }
  }

  if (ocrText.length >= 15) {
    consider(pickBestFromCatalog(ocrText, requiredDocuments, catalog, true));

    for (const doc of requiredDocuments) {
      const ocrScore = scoreRequiredDoc(ocrText, doc, 'ocr');
      if (ocrScore.score >= MIN_CONFIDENCE) {
        consider({
          doc,
          score: ocrScore.score,
          reason: ocrScore.reason,
          method: 'ocr',
        });
      }
    }

    const combined = `${fileName} ${ocrText}`;
    consider(pickBestFromCatalog(combined, requiredDocuments, catalog, true));
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

  // —— Phase 3: Gemini ——
  const geminiResult = await classifyWithGemini(
    fileName,
    mimeType,
    buffer,
    requiredDocuments,
    ocrText,
    catalog
  );
  if (geminiResult?.documentCode) {
    return geminiResult;
  }

  if (ocrResult.documentCode) {
    return ocrResult;
  }
  if (preOcrResult.documentCode) {
    return preOcrResult;
  }

  return geminiResult ?? ocrResult;
}
