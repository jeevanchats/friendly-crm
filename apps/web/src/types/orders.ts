export interface Order {
  id: string;
  quotationId?: string;
  status: 'Pending' | 'Processing' | 'Shipped' | 'Fulfilled' | 'Cancelled';
  totalAmount: number;
  trackingRef?: string;
  createdAt: string;
  updatedAt: string;
  // If your list endpoint joins the customer table:
  customer?: {
    id: string;
    name: string;
    companyName?: string;
  };
}

export interface OrderFiltersProps {
  currentStatus: string;
  onStatusChange: (status: string) => void;
  onRefresh: () => void;
}

export interface OrderDataTableProps {
  orders: Order[];
  isLoading: boolean;
  page: number;
  onPageChange: (newPage: number) => void;
  hasMore: boolean;
}