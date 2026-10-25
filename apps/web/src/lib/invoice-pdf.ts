import { apiFetch } from './session';

/**
 * Downloads an invoice PDF. The API needs the login token, which a plain link cannot send, so the file is
 * fetched with it and saved from memory. Resolves to an error message, or null on success.
 */
export async function downloadInvoicePdf(invoiceId: string, invoiceNumber: string): Promise<string | null> {
  try {
    const res = await apiFetch(`/api/invoices/${invoiceId}/pdf`);
    if (!res.ok) return `Could not download the invoice (${res.status}).`;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `Invoice-${invoiceNumber.replace(/[^A-Za-z0-9-]/g, '-')}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return null;
  } catch {
    return 'Could not reach the server. Check your connection and try again.';
  }
}
