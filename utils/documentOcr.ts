/**
 * Extract text from scanned PDFs and images for document classification.
 * - Reads ALL pages (up to OCR_MAX_PAGES, default 15) from large PDFs
 * - Tesseract OCR per page (no 1MB API limit)
 * - OCR.space only for small files (<1MB) or per-page images under 1MB
 */

import { createWorker, type Worker } from 'tesseract.js';
import { PDFParse } from 'pdf-parse';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface OcrExtractionResult {
  text: string;
  method: 'pdf-parse' | 'pdfjs-text' | 'tesseract' | 'tesseract-pages' | 'ocr-space' | 'none';
  pageCount?: number;
}

const OCR_LANGS = 'spa+eng';
const MIN_USEFUL_TEXT = 35;
/** OCR.space free tier max upload size */
const OCR_SPACE_MAX_BYTES = Number(process.env.OCR_SPACE_MAX_BYTES) || 1024 * 1024;

function getMaxPdfPages(): number {
  const n = Number(process.env.OCR_MAX_PAGES);
  if (Number.isFinite(n) && n > 0) return Math.min(Math.floor(n), 30);
  return 15;
}

let workerPromise: Promise<Worker> | null = null;

async function getTesseractWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker(OCR_LANGS, 1, {
        logger: () => {},
      });
      return worker;
    })();
  }
  return workerPromise;
}

async function getPdfPageCount(buffer: Buffer): Promise<number> {
  try {
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      disableFontFace: true,
    });
    const doc = await loadingTask.promise;
    return doc.numPages;
  } catch {
    return 1;
  }
}

function pageNumbersToProcess(totalPages: number): number[] {
  const max = Math.min(totalPages, getMaxPdfPages());
  return Array.from({ length: max }, (_, i) => i + 1);
}

async function extractWithPdfParse(buffer: Buffer, pageNums: number[]): Promise<string> {
  let parser: PDFParse | null = null;
  try {
    parser = new PDFParse({ data: buffer });
    const result = await parser.getText({
      partial: pageNums.length > 0 ? pageNums : undefined,
    });
    return (result.text || '').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  } finally {
    if (parser) {
      await parser.destroy().catch(() => {});
    }
  }
}

async function extractWithPdfJs(buffer: Buffer, pageNums: number[]): Promise<string> {
  try {
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      disableFontFace: true,
    });
    const doc = await loadingTask.promise;
    const chunks: string[] = [];

    for (const pageNum of pageNums) {
      if (pageNum > doc.numPages) break;
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ('str' in item && typeof item.str === 'string' ? item.str : ''))
        .join(' ');
      chunks.push(pageText);
    }

    return chunks.join('\n').replace(/\s+/g, ' ').trim();
  } catch (err) {
    console.warn('pdfjs text extraction failed:', err);
    return '';
  }
}

async function ocrImageBuffer(imageBuffer: Buffer): Promise<string> {
  try {
    const worker = await getTesseractWorker();
    const { data } = await worker.recognize(imageBuffer);
    return (data.text || '').replace(/\s+/g, ' ').trim();
  } catch (err) {
    console.warn('Tesseract OCR failed:', err);
    return '';
  }
}

/** Render PDF pages to images and OCR each page locally (works for large multi-page PDFs). */
async function ocrPdfPagesWithTesseract(
  buffer: Buffer,
  pageNums: number[]
): Promise<{ text: string; pagesProcessed: number }> {
  if (pageNums.length === 0) return { text: '', pagesProcessed: 0 };

  let parser: PDFParse | null = null;
  try {
    parser = new PDFParse({ data: buffer });
    const shots = await parser.getScreenshot({
      partial: pageNums,
      scale: 1.5,
      desiredWidth: 1400,
      imageBuffer: true,
      imageDataUrl: false,
    });

    const parts: string[] = [];
    for (const page of shots.pages) {
      if (!page.data?.length) continue;
      const pageText = await ocrImageBuffer(Buffer.from(page.data));
      if (pageText.length >= 8) {
        parts.push(pageText);
      }
    }

    return {
      text: parts.join('\n').replace(/\s+/g, ' ').trim(),
      pagesProcessed: shots.pages.length,
    };
  } catch (err) {
    console.warn('Per-page PDF OCR (screenshots) failed:', err);
    return { text: '', pagesProcessed: 0 };
  } finally {
    if (parser) {
      await parser.destroy().catch(() => {});
    }
  }
}

/** OCR.space — max ~1MB per request on free tier; use per-page images for large PDFs. */
async function ocrSpaceExtractBuffer(
  buffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<string> {
  const apiKey = process.env.OCR_SPACE_API_KEY?.trim();
  if (!apiKey || buffer.length > OCR_SPACE_MAX_BYTES) {
    if (buffer.length > OCR_SPACE_MAX_BYTES) {
      console.log(
        `OCR.space skipped: ${(buffer.length / 1024 / 1024).toFixed(2)}MB exceeds ${(OCR_SPACE_MAX_BYTES / 1024 / 1024).toFixed(0)}MB limit`
      );
    }
    return '';
  }

  try {
    const form = new FormData();
    form.append('apikey', apiKey);
    form.append('language', 'spa');
    form.append('isOverlayRequired', 'false');
    form.append('detectOrientation', 'true');
    form.append('scale', 'true');
    form.append('OCREngine', '2');
    form.append('file', new Blob([buffer], { type: mimeType }), fileName);

    const res = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      body: form,
    });

    if (!res.ok) {
      console.warn('OCR.space HTTP error:', res.status);
      return '';
    }

    const json = (await res.json()) as {
      ParsedResults?: Array<{ ParsedText?: string }>;
      IsErroredOnProcessing?: boolean;
      ErrorMessage?: string | string[];
    };

    if (json.IsErroredOnProcessing) {
      console.warn('OCR.space error:', json.ErrorMessage);
      return '';
    }

    return (json.ParsedResults || [])
      .map((r) => r.ParsedText || '')
      .join('\n')
      .replace(/\s+/g, ' ')
      .trim();
  } catch (err) {
    console.warn('OCR.space request failed:', err);
    return '';
  }
}

/** For large PDFs: OCR.space one page image at a time (each usually under 1MB). */
async function ocrSpacePerPdfPages(
  buffer: Buffer,
  pageNums: number[]
): Promise<string> {
  const apiKey = process.env.OCR_SPACE_API_KEY?.trim();
  if (!apiKey || pageNums.length === 0) return '';

  let parser: PDFParse | null = null;
  const parts: string[] = [];

  try {
    parser = new PDFParse({ data: buffer });
    const shots = await parser.getScreenshot({
      partial: pageNums,
      scale: 1.25,
      desiredWidth: 1200,
      imageBuffer: true,
      imageDataUrl: false,
    });

    for (const page of shots.pages) {
      if (!page.data?.length) continue;
      const pageBuf = Buffer.from(page.data);
      if (pageBuf.length > OCR_SPACE_MAX_BYTES) continue;

      const text = await ocrSpaceExtractBuffer(
        pageBuf,
        `page-${page.pageNumber}.png`,
        'image/png'
      );
      if (text) parts.push(text);
    }
  } catch (err) {
    console.warn('OCR.space per-page failed:', err);
  } finally {
    if (parser) {
      await parser.destroy().catch(() => {});
    }
  }

  return parts.join('\n').replace(/\s+/g, ' ').trim();
}

export async function extractDocumentText(
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<OcrExtractionResult> {
  const isPdf = mimeType === 'application/pdf';
  const isImage = mimeType.startsWith('image/');

  if (isPdf) {
    const totalPages = await getPdfPageCount(buffer);
    const pageNums = pageNumbersToProcess(totalPages);

    const fromParse = await extractWithPdfParse(buffer, pageNums);
    if (fromParse.length >= MIN_USEFUL_TEXT) {
      return { text: fromParse, method: 'pdf-parse', pageCount: pageNums.length };
    }

    const fromPdfJs = await extractWithPdfJs(buffer, pageNums);
    if (fromPdfJs.length >= MIN_USEFUL_TEXT) {
      return { text: fromPdfJs, method: 'pdfjs-text', pageCount: pageNums.length };
    }

    const fromTesseractPages = await ocrPdfPagesWithTesseract(buffer, pageNums);
    if (fromTesseractPages.text.length >= 20) {
      return {
        text: fromTesseractPages.text,
        method: 'tesseract-pages',
        pageCount: fromTesseractPages.pagesProcessed,
      };
    }

    let fromOcrSpace = '';
    if (buffer.length <= OCR_SPACE_MAX_BYTES) {
      fromOcrSpace = await ocrSpaceExtractBuffer(buffer, fileName, mimeType);
    } else {
      fromOcrSpace = await ocrSpacePerPdfPages(buffer, pageNums);
    }

    if (fromOcrSpace.length >= 20) {
      return { text: fromOcrSpace, method: 'ocr-space', pageCount: pageNums.length };
    }

    const combined = [fromParse, fromPdfJs, fromTesseractPages.text, fromOcrSpace]
      .filter(Boolean)
      .join(' ')
      .trim();

    return {
      text: combined,
      method: fromTesseractPages.text
        ? 'tesseract-pages'
        : fromOcrSpace
          ? 'ocr-space'
          : combined
            ? 'pdfjs-text'
            : 'none',
      pageCount: pageNums.length,
    };
  }

  if (isImage) {
    const fromOcr = await ocrImageBuffer(buffer);
    return {
      text: fromOcr,
      method: fromOcr ? 'tesseract' : 'none',
      pageCount: 1,
    };
  }

  return { text: '', method: 'none' };
}
