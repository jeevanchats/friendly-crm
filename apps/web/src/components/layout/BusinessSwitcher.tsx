'use client';

import React, { useState } from 'react';
import { Building2, ChevronDown, Check, Layers } from 'lucide-react';
import { IndustryKey, INDUSTRY_TEMPLATES } from '@friendly-crm/shared';

export interface BusinessTenantOption {
  id: string;
  name: string;
  industryKey: IndustryKey;
}

interface BusinessSwitcherProps {
  activeIndustry: IndustryKey;
  onSelectIndustry: (industry: IndustryKey) => void;
  locale?: 'en' | 'ta';
}

export function BusinessSwitcher({
  activeIndustry,
  onSelectIndustry,
  locale = 'en',
}: BusinessSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);

  const businessProfiles: BusinessTenantOption[] = [
    {
      id: 'b-printing',
      name: locale === 'ta' ? 'சிவகாசி ஃபைன் பிரின்ட்ஸ்' : 'Sivakasi Fine Prints',
      industryKey: 'printing',
    },
    {
      id: 'b-textiles',
      name: locale === 'ta' ? 'கோவை பட்டு & ஜவுளி ஆலை' : 'Coimbatore Silk Weavers',
      industryKey: 'textiles',
    },
    {
      id: 'b-furniture',
      name: locale === 'ta' ? 'மதுரை தேக்கு பர்னிச்சர்' : 'Madurai Teak Interiors',
      industryKey: 'furniture',
    },
    {
      id: 'b-trading',
      name: locale === 'ta' ? 'சென்னை இண்டஸ்ட்ரியல் சப்ளைஸ்' : 'Chennai Industrial Supplies',
      industryKey: 'trading',
    },
  ];

  const currentBusiness = businessProfiles.find((b) => b.industryKey === activeIndustry) || businessProfiles[0];
  const template = INDUSTRY_TEMPLATES[activeIndustry] || INDUSTRY_TEMPLATES['printing'];

  return (
    <div className="relative inline-block text-left">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-2 px-3 py-1.5 rounded-xl border border-slate-200/90 bg-surface hover:bg-slate-50/80 shadow-xs text-xs font-medium transition-all"
      >
        <span className="w-2.5 h-2.5 rounded-full bg-brand-teal animate-pulse" />
        <div className="text-left">
          <div className="font-bold text-brand-slate max-w-[130px] sm:max-w-[160px] truncate leading-tight">
            {currentBusiness.name}
          </div>
          <div className="text-[10px] text-brand-ink font-semibold leading-none mt-0.5">
            {template.name[locale]}
          </div>
        </div>
        <ChevronDown className="w-3.5 h-3.5 text-brand-slate-light ml-0.5" />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute left-0 mt-2 w-72 origin-top-left bg-surface rounded-2xl shadow-xl border border-slate-200/90 z-50 py-1.5 animate-slide-up">
            <div className="px-3.5 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-600 border-b border-slate-100 flex items-center justify-between">
              <span>{locale === 'ta' ? 'தொழில் துறை & நிறுவனம்' : 'Switch Active Business Profile'}</span>
              <Layers className="w-3 h-3 text-brand-ink" />
            </div>

            {businessProfiles.map((item) => {
              const isSelected = item.industryKey === activeIndustry;
              const indTemplate = INDUSTRY_TEMPLATES[item.industryKey];

              return (
                <button
                  key={item.id}
                  onClick={() => {
                    onSelectIndustry(item.industryKey);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 text-left text-xs transition-colors ${
                    isSelected
                      ? 'bg-brand-teal-50 text-brand-ink font-semibold'
                      : 'text-brand-slate hover:bg-slate-50'
                  }`}
                >
                  <div>
                    <div className="font-bold leading-tight">{item.name}</div>
                    <div className="text-[10px] text-brand-slate-light mt-0.5">
                      {indTemplate.name[locale]}
                    </div>
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-brand-ink" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
