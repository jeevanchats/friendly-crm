'use client';

import React, { useEffect, useState } from 'react';
import {
  Printer,
  Share2,
  ArrowLeft,
  Building2,
  User,
  Calendar,
  CheckCircle,
  Phone,
  FileCheck2,
  Sparkles,
} from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { INDUSTRY_TEMPLATES } from '@friendly-crm/shared';

interface QuotationItem {
  id: string;
  itemName: string;
  description?: string | null;
  quantity: string | number;
  unit: string;
  unitPrice: string | number;
  taxPercent: string | number;
  lineTotal: string | number;
}

interface QuotationData {
  quote: {
    id: string;
    quoteNumber: string;
    version: number;
    subTotal: string;
    taxTotal: string;
    discountTotal: string;
    grandTotal: string;
    validUntil: string;
    termsAndConditions?: string | null;
    customData?: Record<string, any>;
    status: string;
    createdAt: string;
  };
  customer: {
    name: string;
    companyName?: string | null;
    phone: string;
    gstin?: string | null;
    billingAddress?: string | null;
  };
  items: QuotationItem[];
  tenant: {
    name: string;
    phone?: string;
    gstNumber?: string;
    address?: string;
    industryKey?: string;
  };
  industryTemplate?: any;
}

export default function QuotationPrintPage() {
  const params = useParams();
  const router = useRouter();
  const quoteId = params?.id as string;

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<QuotationData | null>(null);

  useEffect(() => {
    async function fetchQuote() {
      try {
        const res = await fetch(`/api/sales/quotations/${quoteId}`, {
          headers: { 'x-tenant-id': 't-demo-printing' },
        });
        if (res.ok) {
          const json = await res.json();
          setData(json);
        } else {
          // Fallback with rich default data if ID is demo or newly created
          setData(getDefaultDemoData(quoteId));
        }
      } catch {
        setData(getDefaultDemoData(quoteId));
      } finally {
        setLoading(false);
      }
    }

    if (quoteId) {
      fetchQuote();
    }
  }, [quoteId]);

  const getDefaultDemoData = (id: string): QuotationData => ({
    quote: {
      id: id || 'quote-demo-1',
      quoteNumber: 'QT-2026-0042',
      version: 1,
      subTotal: '150000.00',
      taxTotal: '27000.00',
      discountTotal: '5000.00',
      grandTotal: '172000.00',
      validUntil: new Date(Date.now() + 14 * 86400000).toISOString(),
      termsAndConditions:
        '1. 50% advance along with formal purchase order. Balance before dispatch.\n2. Delivery lead-time: 7 to 10 working days upon final artwork proof approval.\n3. Taxes: GST 18% as applicable by law.\n4. Subject to Coimbatore/Sivakasi jurisdiction.',
      customData: {
        job_type: 'PACKAGING_BOX',
        paper_board_gsm: '350 GSM Cyber Premium Board',
        print_colors: 'CMYK_PLUS_PANTONE',
        finishing_ops: ['MATT_LAM', 'SPOT_UV', 'DIE_PUNCH'],
      },
      status: 'SENT',
      createdAt: new Date().toISOString(),
    },
    customer: {
      name: 'Sri Murugan Textiles & Sweets',
      companyName: 'Murugan Retailers Pvt Ltd',
      phone: '+91 98401 23456',
      gstin: '33AAAAA0000A1Z5',
      billingAddress: '42, Mill Road, Crosscut, Coimbatore, Tamil Nadu - 641002',
    },
    items: [
      {
        id: '1',
        itemName: 'Diwali Rigid Sweet Boxes (1 Kg Pack)',
        description: '350 GSM Cyber Board, Matt Lamination, Metallic Gold Foil Stamping',
        quantity: 5000,
        unit: 'Nos',
        unitPrice: 24.0,
        taxPercent: 18,
        lineTotal: 141600.0,
      },
      {
        id: '2',
        itemName: 'Inner Sweet Separator Trays & Inserts',
        description: 'Food grade PVC vacuum formed tray with gold paper barrier',
        quantity: 5000,
        unit: 'Nos',
        unitPrice: 6.0,
        taxPercent: 18,
        lineTotal: 35400.0,
      },
    ],
    tenant: {
      name: 'Sivakasi Fine Prints & Packaging',
      phone: '+91 98400 11223',
      gstNumber: '33AABCU9603R1ZM',
      address: '12, Printing Press Colony, Sivakasi, Tamil Nadu - 626123',
      industryKey: 'printing',
    },
  });

  if (loading || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-sm font-medium text-slate-500">
        Loading printable quotation... (கொட்டேஷன் தயாராகிறது...)
      </div>
    );
  }

  const { quote, customer, items, tenant } = data;
  const industryKey = tenant?.industryKey || 'printing';
  const industryTemplate = INDUSTRY_TEMPLATES[industryKey] || INDUSTRY_TEMPLATES['printing'];

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  const cleanPhone = customer.phone.replace(/\D/g, '');
  const shareText = `வணக்கம் ${customer.name},\nகொட்டேஷன் எண்: ${quote.quoteNumber} (v${quote.version})\nமொத்த தொகை: ₹${Number(quote.grandTotal).toLocaleString('en-IN')}\n\nPDF பார்வைக்கு: ${typeof window !== 'undefined' ? window.location.href : ''}`;

  return (
    <div className="min-h-screen bg-slate-100 py-6 px-2 sm:px-4 text-slate-900 print:bg-white print:p-0">
      {/* Top Action Bar (Hidden on print) */}
      <div className="max-w-4xl mx-auto mb-4 flex items-center justify-between bg-white px-4 py-3 rounded-2xl shadow-sm border border-slate-200 print:hidden">
        <button
          onClick={() => router.push('/')}
          className="flex items-center space-x-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Dashboard (முகப்புக்கு திரும்பு)</span>
        </button>

        <div className="flex items-center space-x-2">
          <a
            href={`https://wa.me/${cleanPhone}?text=${encodeURIComponent(shareText)}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center space-x-1.5 px-3.5 py-2 text-xs font-bold text-white bg-[#25D366] hover:bg-[#20ba5a] rounded-xl shadow-xs transition-colors"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>Share via WhatsApp (வாட்ஸ்அப்)</span>
          </a>

          <button
            onClick={() => window.print()}
            className="flex items-center space-x-1.5 px-4 py-2 text-xs font-bold text-white bg-[#167D79] hover:bg-[#126461] rounded-xl shadow-sm transition-colors"
          >
            <Printer className="w-4 h-4" />
            <span>Print / Save PDF (அச்சு / PDF)</span>
          </button>
        </div>
      </div>

      {/* A4 Printable Document Container */}
      <div className="max-w-4xl mx-auto bg-white p-8 sm:p-12 shadow-xl rounded-2xl border border-slate-200 print:shadow-none print:border-none print:p-0 print:max-w-none">
        {/* Document Header */}
        <header className="border-b-2 border-[#167D79] pb-6 flex flex-col sm:flex-row justify-between items-start gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <span className="w-3 h-3 rounded-full bg-[#167D79]" />
              <h1 className="text-xl sm:text-2xl font-black text-[#167D79] tracking-tight">
                {tenant.name}
              </h1>
            </div>
            <p className="text-xs text-slate-500 mt-1 max-w-sm">
              {tenant.address || 'Sivakasi Industrial Estate, Tamil Nadu'}
            </p>
            <div className="text-xs font-semibold text-slate-700 mt-1 space-x-3">
              <span>போன் / Phone: {tenant.phone || '+91 98400 11223'}</span>
              <span>•</span>
              <span>GSTIN: {tenant.gstNumber || '33AABCU9603R1ZM'}</span>
            </div>
          </div>

          <div className="text-left sm:text-right bg-[#F6F8F7] p-3.5 rounded-xl border border-slate-200 w-full sm:w-auto">
            <span className="text-[11px] font-extrabold uppercase tracking-widest text-[#167D79] block">
              ESTIMATE & QUOTATION / கொட்டேஷன்
            </span>
            <div className="text-base sm:text-lg font-black text-[#243B40] mt-0.5">
              {quote.quoteNumber}{' '}
              <span className="text-xs font-semibold px-2 py-0.5 bg-[#F4B860]/30 text-[#243B40] rounded-md ml-1">
                Rev {quote.version}
              </span>
            </div>
            <div className="text-xs text-slate-600 mt-1 space-y-0.5">
              <div>தேதி / Date: <strong className="text-slate-800">{formatDate(quote.createdAt)}</strong></div>
              <div>செல்லும் காலம் / Valid Until: <strong className="text-slate-800">{formatDate(quote.validUntil)}</strong></div>
            </div>
          </div>
        </header>

        {/* Customer & Industry Locus Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 my-6">
          {/* Bill To */}
          <div className="bg-[#F6F8F7] p-4 rounded-xl border border-slate-200">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#167D79] block mb-1">
              வாடிக்கையாளர் விவரம் / BILL TO
            </span>
            <div className="font-bold text-sm text-[#243B40]">{customer.name}</div>
            {customer.companyName && (
              <div className="text-xs font-semibold text-slate-700">{customer.companyName}</div>
            )}
            <div className="text-xs text-slate-600 mt-1 space-y-0.5">
              {customer.billingAddress && <div>{customer.billingAddress}</div>}
              <div>தொலைபேசி / Phone: <strong>{customer.phone}</strong></div>
              {customer.gstin && <div>GSTIN: <strong>{customer.gstin}</strong></div>}
            </div>
          </div>

          {/* Industry Specification Block */}
          <div className="bg-[#F6F8F7] p-4 rounded-xl border border-slate-200">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#167D79]">
                தொழில்நுட்ப விவரக்குறிப்புகள் / SPECIFICATIONS
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 bg-[#167D79] text-white rounded-md">
                {industryTemplate.name.en} • {industryTemplate.name.ta}
              </span>
            </div>

            {quote.customData && Object.keys(quote.customData).length > 0 ? (
              <div className="text-xs space-y-1.5 mt-2">
                {Object.entries(quote.customData).map(([k, v]) => (
                  <div key={k} className="flex justify-between border-b border-slate-200/60 pb-1">
                    <span className="text-slate-500 capitalize">{k.replace(/_/g, ' ')}:</span>
                    <span className="font-semibold text-slate-800 text-right">
                      {Array.isArray(v) ? v.join(', ') : String(v)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 mt-2">Standard commercial specifications apply.</p>
            )}
          </div>
        </div>

        {/* Line Items Table */}
        <div className="overflow-x-auto my-6">
          <table className="w-full text-left text-xs border border-slate-200">
            <thead>
              <tr className="bg-[#167D79] text-white uppercase text-[11px] font-bold tracking-wider">
                <th className="py-2.5 px-3 border-r border-[#126461] w-12 text-center">#</th>
                <th className="py-2.5 px-3 border-r border-[#126461]">
                  பொருள் விவரம் / Item & Description
                </th>
                <th className="py-2.5 px-3 border-r border-[#126461] text-right w-24">
                  அளவு / Qty
                </th>
                <th className="py-2.5 px-3 border-r border-[#126461] text-right w-24">
                  விலை / Rate (₹)
                </th>
                <th className="py-2.5 px-3 border-r border-[#126461] text-right w-20">
                  GST %
                </th>
                <th className="py-2.5 px-3 text-right w-28">
                  மொத்தம் / Total (₹)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {items.map((item, idx) => (
                <tr key={item.id || idx} className="hover:bg-slate-50/60">
                  <td className="py-3 px-3 text-center text-slate-500 font-medium border-r border-slate-200">
                    {idx + 1}
                  </td>
                  <td className="py-3 px-3 border-r border-slate-200">
                    <div className="font-bold text-slate-900">{item.itemName}</div>
                    {item.description && (
                      <div className="text-[11px] text-slate-500 mt-0.5">{item.description}</div>
                    )}
                  </td>
                  <td className="py-3 px-3 text-right font-semibold text-slate-800 border-r border-slate-200">
                    {Number(item.quantity).toLocaleString('en-IN')} {item.unit || 'Nos'}
                  </td>
                  <td className="py-3 px-3 text-right font-medium text-slate-700 border-r border-slate-200">
                    ₹{Number(item.unitPrice).toFixed(2)}
                  </td>
                  <td className="py-3 px-3 text-right font-medium text-slate-600 border-r border-slate-200">
                    {item.taxPercent}%
                  </td>
                  <td className="py-3 px-3 text-right font-bold text-slate-900">
                    ₹{Number(item.lineTotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Calculation & Terms Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 my-6 items-start">
          {/* Terms & Conditions */}
          <div className="bg-[#F6F8F7] p-4 rounded-xl border border-slate-200 text-xs">
            <span className="font-bold uppercase tracking-wider text-[#167D79] block mb-1.5">
              விதிமுறைகள் மற்றும் நிபந்தனைகள் / TERMS & CONDITIONS
            </span>
            <div className="text-slate-600 whitespace-pre-line leading-relaxed space-y-1">
              {quote.termsAndConditions ||
                '1. 50% advance along with formal PO. Balance payable upon completion prior to dispatch.\n2. Delivery timelines start post artwork proof/spec confirmation.\n3. Taxes as statutory.'}
            </div>
          </div>

          {/* Totals */}
          <div className="bg-[#243B40] text-white p-5 rounded-xl space-y-2 shadow-sm">
            <div className="flex justify-between text-xs text-slate-300">
              <span>கூட்டுத்தொகை / Subtotal</span>
              <span>₹{Number(quote.subTotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>

            <div className="flex justify-between text-xs text-slate-300">
              <span>ஜி.எஸ்.டி வரி / GST Tax</span>
              <span>₹{Number(quote.taxTotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>

            {Number(quote.discountTotal) > 0 && (
              <div className="flex justify-between text-xs text-emerald-400">
                <span>தள்ளுபடி / Discount</span>
                <span>-₹{Number(quote.discountTotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
            )}

            <div className="flex justify-between border-t border-slate-600 pt-2.5 text-base font-extrabold text-[#F4B860]">
              <span>இறுதி மொத்தம் / GRAND TOTAL</span>
              <span>₹{Number(quote.grandTotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>
          </div>
        </div>

        {/* Signatures & Seal Box */}
        <footer className="mt-12 pt-6 border-t border-slate-200 grid grid-cols-2 gap-8 text-xs">
          <div className="text-center pt-8">
            <div className="border-t border-dashed border-slate-300 w-3/4 mx-auto pt-2 text-slate-500">
              வாடிக்கையாளர் கையொப்பம் & முத்திரை
              <br />
              (Customer Acceptance Seal & Sign)
            </div>
          </div>

          <div className="text-center pt-8">
            <div className="border-t border-dashed border-slate-300 w-3/4 mx-auto pt-2 text-slate-800 font-bold">
              அங்கீகரிக்கப்பட்ட கையொப்பம்
              <br />
              <span className="font-normal text-slate-500">
                (For {tenant.name} - Authorized Signatory)
              </span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
