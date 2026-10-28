import React, { useState, useEffect, useCallback } from 'react';
import { OrderFilters } from '../../components/orders/OrderFilters';
import { OrderDataTable } from '../../components/orders/OrderDataTable';
import { Order } from '../../types/orders';
import { apiFetch } from '../../lib/session';

export function OrderList() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);

  const fetchOrders = useCallback(async () => {
    setIsLoading(true);
    try {
      const queryParams = new URLSearchParams({
        page: page.toString(),
        limit: '20',
        ...(statusFilter && { status: statusFilter }),
      });

      const response = await apiFetch(`/api/orders?${queryParams}`);
      if (!response.ok) throw new Error('Network response was not ok');
      
      const { data } = await response.json();
      setOrders(data);
      // If we received less than the limit, there are no more pages
      setHasMore(data.length === 20);
    } catch (error) {
      console.error('Failed to fetch orders:', error);
      // Integrate toast notification here
    } finally {
      setIsLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const handleStatusChange = (newStatus: string) => {
    setStatusFilter(newStatus);
    setPage(1); // Reset to first page on filter change
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Order Management</h1>
        <p className="mt-1 text-sm text-gray-500">
          Track and fulfill active orders generated from quotations.
        </p>
      </div>

      <OrderFilters 
        currentStatus={statusFilter} 
        onStatusChange={handleStatusChange} 
        onRefresh={fetchOrders} 
      />

      <OrderDataTable 
        orders={orders} 
        isLoading={isLoading} 
        page={page} 
        onPageChange={setPage}
        hasMore={hasMore}
      />
    </div>
  );
}

export default OrderList;