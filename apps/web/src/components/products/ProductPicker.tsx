'use client';

import React, { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../lib/session';

export interface PickedProduct {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  hsnCode: string | null;
  unit: string;
  unitPrice: string;
  taxPercent: string;
}

interface Props {
  value: string;
  onText: (text: string) => void;
  onPick: (product: PickedProduct) => void;
  placeholder?: string;
  className?: string;
  /** Called when the list could not be loaded for a reason other than "no matches" (kept quiet in the UI). */
  id?: string;
}

/**
 * Item name box for a quotation line. Typing searches the product master; choosing a suggestion fills the line
 * (unit, rate, GST, HSN). Free text still works: an item that is not in the master can be typed as it is.
 */
export function ProductPicker({ value, onText, onPick, placeholder, className, id }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<PickedProduct[]>([]);
  const [highlight, setHighlight] = useState(-1);
  const seq = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const listId = `${id ?? 'product-picker'}-list`;

  useEffect(() => {
    if (!open) return;
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const q = new URLSearchParams({ limit: '8' });
        if (value.trim()) q.set('search', value.trim());
        const res = await apiFetch(`/api/products?${q}`);
        if (mine !== seq.current) return; // a newer search is already running
        setItems(res.ok ? (await res.json()).data : []);
        setHighlight(-1);
      } catch {
        if (mine === seq.current) setItems([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [value, open]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const choose = (p: PickedProduct) => {
    onPick(p);
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(items.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter' && open && highlight >= 0 && items[highlight]) {
      e.preventDefault();
      choose(items[highlight]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={box} className="relative">
      <input
        id={id}
        type="text"
        required
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        className={className}
      />
      {open && items.length > 0 && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          {items.map((p, i) => (
            <li
              key={p.id}
              role="option"
              aria-selected={i === highlight}
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus in the input so the list closes cleanly
                choose(p);
              }}
              onMouseEnter={() => setHighlight(i)}
              className={`cursor-pointer px-3 py-2 text-sm ${i === highlight ? 'bg-[#167D79]/10' : ''}`}
            >
              <div className="font-semibold text-[#243B40]">{p.name}</div>
              <div className="text-[11px] text-slate-500">
                {[p.code, p.hsnCode && `HSN ${p.hsnCode}`, `₹${Number(p.unitPrice).toLocaleString('en-IN')} / ${p.unit}`, `GST ${Number(p.taxPercent)}%`].filter(Boolean).join(' · ')}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
