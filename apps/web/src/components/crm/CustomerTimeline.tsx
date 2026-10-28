'use client';

import React from 'react';
import { PhoneCall, MessageCircle, FileCheck, Clock, Flag } from 'lucide-react';

export interface TimelineEvent {
  id: string;
  type: 'CALL' | 'WHATSAPP' | 'STAGE_CHANGE' | 'NOTE' | 'QUOTE';
  title: string;
  details?: string;
  timestamp: string;
  authorName?: string;
}

interface CustomerTimelineProps {
  events?: TimelineEvent[];
}

export function CustomerTimeline({
  events = [
    {
      id: '1',
      type: 'CALL',
      title: 'Discussed Bulk Quotation',
      details: 'Customer requested 5% additional discount on order of 200 items. Promised to send revised quote.',
      timestamp: 'Today, 2:30 PM',
      authorName: 'Suresh (Sales Rep)',
    },
    {
      id: '2',
      type: 'STAGE_CHANGE',
      title: 'Moved to Proposal Sent',
      details: 'Generated and shared official quote #QT-2026-004 via WhatsApp PDF link.',
      timestamp: 'Yesterday, 11:15 AM',
      authorName: 'Suresh',
    },
    {
      id: '3',
      type: 'WHATSAPP',
      title: 'WhatsApp Brochure Sent',
      details: 'Product catalog PDF sent to customer number.',
      timestamp: 'Oct 18, 2026',
      authorName: 'System',
    },
  ],
}: CustomerTimelineProps) {
  const getIcon = (type: TimelineEvent['type']) => {
    switch (type) {
      case 'CALL':
        return <PhoneCall className="w-4 h-4 text-emerald-600" />;
      case 'WHATSAPP':
        return <MessageCircle className="w-4 h-4 text-green-500" />;
      case 'STAGE_CHANGE':
        return <Flag className="w-4 h-4 text-amber-500" />;
      case 'QUOTE':
        return <FileCheck className="w-4 h-4 text-blue-500" />;
      default:
        return <Clock className="w-4 h-4 text-slate-600" />;
    }
  };

  return (
    <div className="bg-surface rounded-xl border border-slate-200 p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-800 mb-4 flex items-center space-x-2">
        <Clock className="w-4 h-4 text-emerald-600" />
        <span>Customer Activity Timeline</span>
      </h3>

      <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
        {events.map((event) => (
          <div key={event.id} className="relative group">
            <div className="absolute -left-6 top-0.5 flex items-center justify-center w-5 h-5 rounded-full bg-surface border border-slate-200 shadow-xs">
              {getIcon(event.type)}
            </div>

            <div className="text-xs text-slate-600 mb-0.5">
              {event.timestamp} {event.authorName && `• ${event.authorName}`}
            </div>

            <div className="text-sm font-medium text-slate-800">{event.title}</div>
            {event.details && (
              <p className="mt-1 text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                {event.details}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
