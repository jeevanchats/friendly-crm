'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { HomeDashboard } from '../components/dashboard/HomeDashboard';

export default function HomePage() {
  const [lang, setLang] = useState<'en' | 'ta'>('en');
  const [dashboardData, setDashboardData] = useState<any>({
    summaryCards: {
      dueFollowUps: 2,
      openQuotations: 2,
      openQuotationsValue: '185000.00',
      activeOrders: 3,
      totalReceivables: '108000.00',
    },
    priorityTasks: [
      {
        id: 'task-demo-1',
        type: 'FOLLOW_UP_CALL',
        title: 'Call Sri Murugan Textiles for packaging artwork approval',
        dueAt: new Date(Date.now() - 3600000).toISOString(),
        customerId: 'c-demo-1',
        customerName: 'Sri Murugan Textiles & Sweets',
        customerPhone: '+919840123456',
      },
      {
        id: 'task-demo-2',
        type: 'WHATSAPP_MESSAGE',
        title: 'WhatsApp revised quotation with tin mounting options',
        dueAt: new Date(Date.now() + 1800000).toISOString(),
        customerId: 'c-demo-2',
        customerName: 'Karthik Precision Engineering',
        customerPhone: '+919876543210',
      },
    ],
  });
  const [loading, setLoading] = useState(false);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/crm/dashboard', {
        headers: {
          'x-tenant-id': 't-demo-printing',
          'x-user-role': 'OWNER',
        },
      });
      if (res.ok) {
        const json = await res.json();
        setDashboardData(json);
      }
    } catch (err) {
      console.warn('Using initial dashboard state', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  return (
    <div className="space-y-6">
      <HomeDashboard
        userName="Anand"
        lang={lang}
        data={dashboardData}
        onRefresh={fetchDashboard}
      />
    </div>
  );
}
