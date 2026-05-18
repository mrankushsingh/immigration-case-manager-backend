/**
 * Strict text matching — avoids "ex 24" matching "extracto" or "passport" via substrings.
 */

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word or whole-phrase match (not substring inside another word). */
export function containsTerm(text: string, term: string): boolean {
  const hay = normalize(text);
  const needle = normalize(term);
  if (!hay || !needle) return false;

  // Ignore very short needles — too many false positives (ex, ir, tie as substring, etc.)
  if (needle.length < 4) return false;

  if (needle.includes(' ')) {
    const pattern = needle
      .split(/\s+/)
      .map((w) => escapeRegex(w))
      .join('\\s+');
    return new RegExp(`(?:^|\\s)${pattern}(?:\\s|$)`, 'i').test(hay);
  }

  return new RegExp(`(?:^|\\s)${escapeRegex(needle)}(?:\\s|$)`, 'i').test(hay);
}

/** Significant words only (length > 3). */
export function significantWords(text: string): string[] {
  return normalize(text).split(' ').filter((w) => w.length > 3);
}

/** Generic words in Spanish document titles — not used alone for filename matching. */
const DOC_NAME_STOP_WORDS = new Set([
  'certificado', 'certificacion', 'documentacion', 'documento', 'copia', 'solicitud',
  'acreditacion', 'acreditativa', 'informe', 'declaracion', 'volante', 'medios',
  'economicos', 'ultimas', 'ultima', 'tres', 'seis', 'pais', 'origen', 'espana',
  'completa', 'completo', 'historico', 'firme', 'registro', 'presentacion',
  'justificante', 'memoria', 'descriptiva', 'ocupacion', 'despacho', 'otra',
  'modelo', 'formulario', 'solicitud', 'del', 'las', 'los', 'una', 'por',
]);

/** Stems often used in filenames (person name + hint), e.g. "Klodian Penales.pdf". */
const FILENAME_DOC_STEMS: Array<{ stem: string; inDocName: RegExp }> = [
  { stem: 'penales', inDocName: /penales|criminal/i },
  { stem: 'antecedentes', inDocName: /antecedentes/i },
  { stem: 'pasaporte', inDocName: /pasaporte|passport/i },
  { stem: 'passport', inDocName: /passport|pasaporte/i },
  { stem: 'empadron', inDocName: /empadronamiento|padron/i },
  { stem: 'padron', inDocName: /empadronamiento|padron/i },
  { stem: 'nomina', inDocName: /nomina/i },
  { stem: 'nominas', inDocName: /nomina/i },
  { stem: 'irpf', inDocName: /irpf/i },
  { stem: 'matrimonio', inDocName: /matrimonio/i },
  { stem: 'nacimiento', inDocName: /nacimiento/i },
  { stem: 'convivencia', inDocName: /convivencia/i },
  { stem: 'divorcio', inDocName: /divorcio/i },
  { stem: 'contrato', inDocName: /contrato/i },
  { stem: 'bancario', inDocName: /bancario|bancarios|extracto/i },
  { stem: 'extracto', inDocName: /extracto|bancario/i },
  { stem: 'medico', inDocName: /medico/i },
  { stem: 'seguro', inDocName: /seguro/i },
  { stem: 'vida', inDocName: /vida laboral/i },
  { stem: 'laboral', inDocName: /vida laboral|laboral/i },
];

function filenameBase(fileName: string): string {
  return normalize(fileName.replace(/\.[a-z0-9]+$/i, ''));
}

/**
 * Match filenames like "Klodian Penales.pdf" to "CERTIFICADO DE ANTECEDENTES PENALES"
 * when the filename contains a distinctive word from the document title.
 */
export function scoreDistinctiveFilenameHint(
  fileNameOrText: string,
  docName: string
): { score: number; reason: string } {
  const hay = filenameBase(fileNameOrText);
  const docNorm = normalize(docName);
  if (!hay || !docNorm) return { score: 0, reason: '' };

  for (const w of significantWords(docName)) {
    if (DOC_NAME_STOP_WORDS.has(w)) continue;
    if (w.length >= 6 && containsTerm(hay, w)) {
      return {
        score: 90,
        reason: `filename contains "${w}" (matches "${docName}")`,
      };
    }
  }

  for (const { stem, inDocName } of FILENAME_DOC_STEMS) {
    if (inDocName.test(docNorm) && containsTerm(hay, stem)) {
      return {
        score: 88,
        reason: `filename "${stem}" matches document type "${docName}"`,
      };
    }
  }

  return { score: 0, reason: '' };
}

export function filenameHasDocumentHint(fileName: string): boolean {
  const hay = filenameBase(fileName);
  if (!hay) return false;
  return FILENAME_DOC_STEMS.some(({ stem }) => containsTerm(hay, stem));
}

export function tokenOverlapScore(a: string, b: string): number {
  const wordsA = new Set(significantWords(a));
  const wordsB = significantWords(b);
  if (wordsA.size === 0 || wordsB.length === 0) return 0;
  let hits = 0;
  for (const w of wordsB) {
    if (wordsA.has(w)) hits += 1;
  }
  return Math.round((hits / Math.max(wordsB.length, 1)) * 40);
}

/** Filenames like "ex 24", "scan1", "img_02" — do not guess from template catalog on name alone. */
export function isVagueFilename(fileName: string): boolean {
  const base = normalize(fileName.replace(/\.[a-z0-9]+$/i, ''));
  if (!base) return true;
  if (base.length < 10) return true;
  if (/^ex[\s_-]*\d{1,4}$/i.test(base.replace(/\s+/g, ''))) return true;
  if (/^(scan|img|doc|file|foto|pdf)[\s_-]*\d*$/i.test(base)) return true;
  const words = base.split(' ').filter(Boolean);
  if (filenameHasDocumentHint(fileName)) return false;
  if (words.length <= 2 && words.every((w) => w.length <= 4 || /^\d+$/.test(w))) return true;
  return false;
}

/** Two template/client document names refer to the same slot (strict). */
export function documentNamesAlign(catalogName: string, clientName: string): boolean {
  const a = normalize(catalogName);
  const b = normalize(clientName);
  if (a === b) return true;

  const wordsA = significantWords(catalogName);
  const wordsB = significantWords(clientName);
  if (wordsA.length === 0 || wordsB.length === 0) return false;

  const shared = wordsA.filter((w) => wordsB.includes(w));
  if (shared.length >= 2) return true;
  if (shared.length === 1 && shared[0].length >= 6) return true;

  const hint = scoreDistinctiveFilenameHint(catalogName, clientName);
  if (hint.score >= 85) return true;

  return false;
}
