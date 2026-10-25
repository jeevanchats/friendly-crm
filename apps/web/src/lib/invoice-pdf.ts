import { apiFetch } from './session';

/**
 * Downloads a file from the API. The API needs the login token, which a plain link cannot send, so the file is
 * fetched with it and saved from memory. Resolves to an error message, or null on success.
 */
export async function downloadAuthedFile(apiPath: string, filename: string): Promise<string | null> {
  try {
    const res = await apiFetch(apiPath);
    if (!res.ok) return `Could not download the file (${res.status}).`;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return null;
  } catch {
    return 'Could not reach the server. Check your connection and try again.';
  }
}

const safeName = (s: string) => s.replace(/[^A-Za-z0-9-]/g, '-');

export const downloadInvoicePdf = (invoiceId: string, invoiceNumber: string) =>
  downloadAuthedFile(`/api/invoices/${invoiceId}/pdf`, `Invoice-${safeName(invoiceNumber)}.pdf`);

export const downloadCreditNotePdf = (creditNoteId: string, creditNoteNumber: string) =>
  downloadAuthedFile(`/api/credit-notes/${creditNoteId}/pdf`, `CreditNote-${safeName(creditNoteNumber)}.pdf`);

export const downloadQuotationPdf = (quotationId: string, quoteNumber: string) =>
  downloadAuthedFile(`/api/sales/quotations/${quotationId}/pdf`, `Quotation-${safeName(quoteNumber)}.pdf`);
