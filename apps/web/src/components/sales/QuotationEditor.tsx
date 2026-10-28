'use client';

import React, { useState } from 'react';
import { Plus, Trash2, FileDown, Calculator } from 'lucide-react';
import { QuotationItemDto } from '@friendly-crm/shared';

export function QuotationEditor() {
  const [items, setItems] = useState<QuotationItemDto[]>([
    {
      description: 'Industrial Stainless Steel Valves (DN50)',
      quantity: 5,
      unitPrice: 3200,
      discountPercent: 5,
      taxPercent: 18,
      total: 15200,
    },
  ]);

  const [customerName, setCustomerName] = useState('Sri Lakshmi Silks');

  const updateItem = (index: number, field: keyof QuotationItemDto, value: any) => {
    const next = [...items];
    next[index] = { ...next[index], [field]: value };

    // Recalculate item total
    const qty = Number(next[index].quantity) || 0;
    const price = Number(next[index].unitPrice) || 0;
    const disc = Number(next[index].discountPercent) || 0;
    const discountedBase = qty * price * (1 - disc / 100);
    const taxRate = Number(next[index].taxPercent) || 0;
    next[index].total = Math.round(discountedBase * (1 + taxRate / 100));

    setItems(next);
  };

  const addItem = () => {
    setItems([
      ...items,
      {
        description: '',
        quantity: 1,
        unitPrice: 0,
        discountPercent: 0,
        taxPercent: 18,
        total: 0,
      },
    ]);
  };

  const removeItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index));
    }
  };

  const subtotal = items.reduce((acc, it) => acc + it.quantity * it.unitPrice, 0);
  const grandTotal = items.reduce((acc, it) => acc + (it.total || 0), 0);
  const taxTotal = Math.round(grandTotal - items.reduce((acc, it) => acc + it.quantity * it.unitPrice * (1 - (it.discountPercent || 0) / 100), 0));

  return (
    <div className="bg-surface rounded-xl border border-slate-200 p-4 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-800 flex items-center space-x-2">
            <Calculator className="w-5 h-5 text-emerald-600" />
            <span>Quotation Editor</span>
          </h2>
          <p className="text-xs text-slate-500">Drafting quotation for {customerName}</p>
        </div>

        <button
          onClick={() => alert('PDF generation initiated via NestJS PDF Engine Service!')}
          className="flex items-center justify-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors"
        >
          <FileDown className="w-4 h-4" />
          <span>Export PDF</span>
        </button>
      </div>

      <div className="space-y-3">
        {items.map((item, index) => (
          <div key={index} className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">Item #{index + 1}</span>
              {items.length > 1 && (
                <button
                  onClick={() => removeItem(index)}
                  className="text-rose-500 hover:text-rose-700 p-1"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>

            <input
              type="text"
              placeholder="Item name / description"
              value={item.description || ''}
              onChange={(e) => updateItem(index, 'description', e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded bg-surface"
            />

            <div className="grid grid-cols-4 gap-2">
              <div>
                <label className="text-[10px] text-slate-500">Qty</label>
                <input
                  type="number"
                  value={item.quantity}
                  onChange={(e) => updateItem(index, 'quantity', Number(e.target.value))}
                  className="w-full px-2 py-1 text-xs border border-slate-200 rounded bg-surface"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-500">Price (₹)</label>
                <input
                  type="number"
                  value={item.unitPrice}
                  onChange={(e) => updateItem(index, 'unitPrice', Number(e.target.value))}
                  className="w-full px-2 py-1 text-xs border border-slate-200 rounded bg-surface"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-500">Disc %</label>
                <input
                  type="number"
                  value={item.discountPercent}
                  onChange={(e) => updateItem(index, 'discountPercent', Number(e.target.value))}
                  className="w-full px-2 py-1 text-xs border border-slate-200 rounded bg-surface"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-500">GST %</label>
                <input
                  type="number"
                  value={item.taxPercent}
                  onChange={(e) => updateItem(index, 'taxPercent', Number(e.target.value))}
                  className="w-full px-2 py-1 text-xs border border-slate-200 rounded bg-surface"
                />
              </div>
            </div>

            <div className="text-right text-xs font-semibold text-slate-800">
              Item Total: ₹{(item.total || 0).toLocaleString()}
            </div>
          </div>
        ))}

        <button
          onClick={addItem}
          className="w-full py-2 border-2 border-dashed border-slate-300 hover:border-emerald-500 text-slate-600 hover:text-emerald-600 rounded-lg text-xs font-medium flex items-center justify-center space-x-1 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Line Item</span>
        </button>
      </div>

      <div className="pt-3 border-t border-slate-100 flex flex-col items-end space-y-1 text-xs">
        <div className="text-slate-500">Subtotal: ₹{subtotal.toLocaleString()}</div>
        <div className="text-slate-500">GST Approx: ₹{taxTotal.toLocaleString()}</div>
        <div className="text-base font-bold text-slate-900 mt-1">
          Grand Total: ₹{grandTotal.toLocaleString()}
        </div>
      </div>
    </div>
  );
}
