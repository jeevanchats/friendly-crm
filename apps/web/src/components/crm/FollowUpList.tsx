'use client';

import React from 'react';
import { Phone, MessageSquare, CheckCircle, Clock, AlertCircle } from 'lucide-react';

export interface FollowUpItem {
  id: string;
  leadName: string;
  businessName?: string;
  phone: string;
  title: string;
  dueTime: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
}

interface FollowUpListProps {
  tasks?: FollowUpItem[];
  onComplete?: (id: string) => void;
}

export function FollowUpList({
  tasks = [
    {
      id: 'f1',
      leadName: 'Murugan Textiles',
      businessName: 'Murugan Textiles Pvt Ltd',
      phone: '+919840123456',
      title: 'Call back regarding sample fabrics & quotation',
      dueTime: '10:30 AM',
      priority: 'HIGH',
    },
    {
      id: 'f2',
      leadName: 'Ravi Chandran',
      businessName: 'Ravi Pumps & Motors',
      phone: '+919876543210',
      title: 'Send updated quotation with 18% GST calculation',
      dueTime: '02:00 PM',
      priority: 'URGENT',
    },
  ],
  onComplete,
}: FollowUpListProps) {
  const getPriorityBadge = (priority: FollowUpItem['priority']) => {
    switch (priority) {
      case 'URGENT':
        return <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-rose-100 text-rose-700 rounded">Urgent</span>;
      case 'HIGH':
        return <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-700 rounded">High</span>;
      default:
        return <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-blue-100 text-blue-700 rounded">Normal</span>;
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-800 flex items-center space-x-2">
          <Clock className="w-4 h-4 text-emerald-600" />
          <span>Today's Follow-ups ({tasks.length})</span>
        </h3>
      </div>

      <div className="space-y-3">
        {tasks.map((task) => (
          <div
            key={task.id}
            className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg border border-slate-100 bg-slate-50 hover:bg-slate-100/80 transition-colors gap-3"
          >
            <div className="flex-1">
              <div className="flex items-center space-x-2">
                <span className="font-semibold text-sm text-slate-900">{task.leadName}</span>
                {getPriorityBadge(task.priority)}
                <span className="text-xs text-slate-400">Due {task.dueTime}</span>
              </div>
              <p className="text-xs text-slate-600 mt-1">{task.title}</p>
            </div>

            <div className="flex items-center space-x-2 pt-1 sm:pt-0">
              <a
                href={`tel:${task.phone}`}
                className="flex items-center space-x-1 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-100 hover:bg-emerald-200 rounded-lg transition-colors"
              >
                <Phone className="w-3.5 h-3.5" />
                <span>Call</span>
              </a>
              <a
                href={`https://wa.me/${task.phone.replace(/[^0-9]/g, '')}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center space-x-1 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-100 hover:bg-green-200 rounded-lg transition-colors"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>WhatsApp</span>
              </a>
              <button
                onClick={() => onComplete?.(task.id)}
                aria-label="Mark done"
                className="p-1.5 text-slate-400 hover:text-emerald-600 rounded-lg"
              >
                <CheckCircle className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
