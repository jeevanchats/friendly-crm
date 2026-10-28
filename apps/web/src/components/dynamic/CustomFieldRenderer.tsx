'use client';

import React, { useId } from 'react';
import { INDUSTRY_TEMPLATES, IndustryKey, CustomFieldConfig } from '@friendly-crm/shared';

type EntityScope = 'LEAD' | 'QUOTATION' | 'ORDER';
type Lang = 'en' | 'ta';

interface CustomFieldRendererProps {
  industry: IndustryKey;
  entity: EntityScope;
  lang: Lang;
  values: Record<string, any>;
  onChange: (key: string, value: any) => void;
}

export function CustomFieldRenderer({
  industry,
  entity,
  lang,
  values,
  onChange,
}: CustomFieldRendererProps) {
  const formId = useId();
  const template = INDUSTRY_TEMPLATES[industry];
  if (!template) return null;

  const fields: CustomFieldConfig[] = template.customFields.filter((f: CustomFieldConfig) =>
    f.entity.includes(entity)
  );
  if (fields.length === 0) return null;

  return (
    <div className="space-y-4 rounded-xl bg-surface p-4 border border-slate-200">
      <div className="text-xs font-semibold uppercase tracking-wider text-brand-ink">
        {template.name[lang]} — {lang === 'ta' ? 'சிறப்பு விவரங்கள்' : 'Industry Details'}
      </div>

      {fields.map((field: CustomFieldConfig) => {
        const currentValue = values[field.key] ?? '';

        return (
          <div key={field.key} className="flex flex-col gap-1.5">
            <label id={`${formId}-${field.key}-label`} htmlFor={`${formId}-${field.key}`} className="text-sm font-medium text-foreground">
              {field.label[lang] || field.label.en}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </label>

            {/* TEXT & NUMBER INPUTS */}
            {(field.type === 'TEXT' || field.type === 'NUMBER') && (
              <input
                id={`${formId}-${field.key}`}
                type={field.type === 'NUMBER' ? 'number' : 'text'}
                required={field.required}
                placeholder={field.placeholder || ''}
                value={currentValue}
                onChange={(e) => onChange(field.key, e.target.value)}
                className="min-h-[48px] w-full rounded-lg border border-slate-300 bg-surface px-3.5 py-2.5 text-sm text-foreground focus:border-brand-ink focus:outline-none focus:ring-2 focus:ring-[#02937B]/20"
              />
            )}

            {/* SINGLE SELECT DROPDOWN */}
            {field.type === 'SELECT' && field.options && (
              <select
                id={`${formId}-${field.key}`}
                required={field.required}
                value={currentValue}
                onChange={(e) => onChange(field.key, e.target.value)}
                className="min-h-[48px] w-full rounded-lg border border-slate-300 bg-surface px-3.5 py-2.5 text-sm text-foreground focus:border-brand-ink focus:outline-none focus:ring-2 focus:ring-[#02937B]/20"
              >
                <option value="">
                  {lang === 'ta' ? '-- தேர்ந்தெடுக்கவும் --' : '-- Select Option --'}
                </option>
                {field.options.map((opt: { value: string; label: { en: string; ta: string } }) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label[lang] || opt.label.en}
                  </option>
                ))}
              </select>
            )}

            {/* MULTI-SELECT PILLS (Touch-friendly for Finishing/Binding ops) */}
            {field.type === 'MULTI_SELECT' && field.options && (
              <div role="group" aria-labelledby={`${formId}-${field.key}-label`} className="flex flex-wrap gap-2 pt-1">
                {field.options.map((opt: { value: string; label: { en: string; ta: string } }) => {
                  const selectedArray: string[] = Array.isArray(currentValue) ? currentValue : [];
                  const isSelected = selectedArray.includes(opt.value);
                  return (
                    <button
                      type="button"
                      key={opt.value}
                      aria-pressed={isSelected}
                      onClick={() => {
                        const next = isSelected
                          ? selectedArray.filter((v: string) => v !== opt.value)
                          : [...selectedArray, opt.value];
                        onChange(field.key, next);
                      }}
                      className={`min-h-[44px] rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                        isSelected
                          ? 'bg-action text-on-action shadow-sm'
                          : 'bg-surface text-foreground border border-slate-300 hover:border-brand-ink'
                      }`}
                    >
                      {opt.label[lang] || opt.label.en}
                    </button>
                  );
                })}
              </div>
            )}

            {/* BOOLEAN TOGGLE */}
            {field.type === 'BOOLEAN' && (
              <label className="inline-flex min-h-[48px] cursor-pointer items-center gap-3">
                <input
                id={`${formId}-${field.key}`}
                  type="checkbox"
                  checked={Boolean(currentValue)}
                  onChange={(e) => onChange(field.key, e.target.checked)}
                  className="h-5 w-5 rounded border-slate-300 text-brand-ink focus:ring-[#02937B]"
                />
                <span className="text-sm text-foreground">
                  {lang === 'ta' ? 'ஆம் (உறுதி செய்யப்பட்டது)' : 'Yes, Confirmed'}
                </span>
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}
