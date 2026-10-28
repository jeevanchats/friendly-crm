import { Injectable, Logger } from '@nestjs/common';
import { tmpdir } from 'os';
import { join } from 'path';

export interface OcrResult {
  text: string;
  /** 0-100, how sure the OCR engine is of what it read. Handwriting scores low. */
  confidence: number;
}

/** Below this the "text" is mostly guesswork (typically handwriting or a bad photo). */
export const MIN_OCR_CONFIDENCE = 60;

/**
 * Text that can be taken from files on this server, with no outside service:
 * the text layer of a PDF, and printed text in a photo (Tesseract, open-source OCR; English).
 * Handwriting is not something it can read: that is what the AI reader is for.
 */
@Injectable()
export class DocumentTextService {
  private readonly logger = new Logger(DocumentTextService.name);
  private workerPromise: Promise<any> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  /** Text inside a PDF. Empty for a scanned PDF (pictures of pages) and for anything unreadable. */
  async pdfText(data: Buffer): Promise<string> {
    let parser: any;
    try {
      const { PDFParse } = await import('pdf-parse');
      parser = new PDFParse({ data: new Uint8Array(data) });
      const out = await parser.getText();
      return String(out?.text ?? '')
        .replace(/^-- \d+ of \d+ --$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    } catch (err: any) {
      this.logger.warn(`Could not read PDF text: ${err?.message}`);
      return '';
    } finally {
      try {
        await parser?.destroy();
      } catch {
        // ignore
      }
    }
  }

  private worker(): Promise<any> {
    if (!this.workerPromise) {
      this.workerPromise = (async () => {
        const { createWorker } = await import('tesseract.js');
        // The English language file is downloaded once, then kept here. Set OCR_CACHE_DIR to keep it somewhere permanent.
        return createWorker('eng', 1, { cachePath: process.env.OCR_CACHE_DIR || join(tmpdir(), 'friendly-crm-ocr') });
      })().catch((err) => {
        this.workerPromise = null; // try again next time (for example once the network is back)
        throw err;
      });
    }
    return this.workerPromise;
  }

  /** Printed text in a photo. Returns null when the OCR engine is not available here. One image at a time. */
  async ocrImage(data: Buffer): Promise<OcrResult | null> {
    const run = async (): Promise<OcrResult | null> => {
      try {
        const worker = await this.worker();
        const r = await worker.recognize(data);
        return { text: String(r?.data?.text ?? '').trim(), confidence: Number(r?.data?.confidence ?? 0) };
      } catch (err: any) {
        this.logger.warn(`OCR unavailable: ${err?.message}`);
        return null;
      }
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async onModuleDestroy(): Promise<void> {
    try {
      const w = await this.workerPromise;
      await w?.terminate();
    } catch {
      // ignore
    }
  }
}
