import { IndustryKey } from '@friendly-crm/shared';

export interface MemoryCustomer {
  id: string;
  tenantId: string;
  name: string;
  companyName?: string;
  phone: string;
  whatsappNumber?: string;
  email?: string;
  gstin?: string;
  openingBalance: string;
  creditLimit: string;
  activeOrdersCount: number;
  totalReceivable: string;
  createdAt: Date;
  updatedAt?: Date;
}

export const globalMemoryTenants = new Map<string, { id: string; name: string; industryKey: IndustryKey }>([
  ['t-demo-printing', { id: 't-demo-printing', name: 'Senthaamarai Art Crafts & Calendars', industryKey: 'printing' }],
  ['t-demo-textiles', { id: 't-demo-textiles', name: 'Kongu Tex & Garments', industryKey: 'textiles' }],
  ['t-demo-furniture', { id: 't-demo-furniture', name: 'Sri Vinayaga Furniture', industryKey: 'furniture' }],
  ['t-demo-trading', { id: 't-demo-trading', name: 'Sun Steel & Industrial Traders', industryKey: 'trading' }],
]);

export const globalMemoryCustomers: MemoryCustomer[] = [
  // 1. Printing Pilot: Senthaamarai Art Crafts & Calendars (t-demo-printing)
  {
    id: 'c-pilot-printing-1',
    tenantId: 't-demo-printing',
    name: 'Sri Krishna Sweets',
    companyName: 'Sri Krishna Sweets & Bakery',
    phone: '+919443022222',
    whatsappNumber: '+919443022222',
    gstin: '33AABCS1234A1Z5',
    openingBalance: '0.00',
    creditLimit: '100000.00',
    activeOrdersCount: 1,
    totalReceivable: '75000.00',
    createdAt: new Date(Date.now() - 86400000 * 10),
  },
  {
    id: 'c-demo-1',
    tenantId: 't-demo-printing',
    name: 'Sri Murugan Textiles & Sweets',
    companyName: 'Murugan Retailers Pvt Ltd',
    phone: '+919840123456',
    whatsappNumber: '+919840123456',
    gstin: '33AAAAA0000A1Z5',
    openingBalance: '0.00',
    creditLimit: '150000.00',
    activeOrdersCount: 1,
    totalReceivable: '86000.00',
    createdAt: new Date(Date.now() - 86400000 * 5),
  },

  // 2. Furniture Pilot: Sri Vinayaga Furniture (t-demo-furniture)
  {
    id: 'c-pilot-furniture-1',
    tenantId: 't-demo-furniture',
    name: 'Karthik Residence',
    companyName: 'Karthik Villa Interior Project',
    phone: '+919443044444',
    whatsappNumber: '+919443044444',
    openingBalance: '5000.00',
    creditLimit: '50000.00',
    activeOrdersCount: 1,
    totalReceivable: '55000.00',
    createdAt: new Date(Date.now() - 86400000 * 7),
  },
  {
    id: 'c-demo-3',
    tenantId: 't-demo-furniture',
    name: 'Grand Royal Residency',
    companyName: 'Royal Hospitality Group',
    phone: '+919444123890',
    whatsappNumber: '+919444123890',
    gstin: '33AABCR1234F1Z8',
    openingBalance: '0.00',
    creditLimit: '200000.00',
    activeOrdersCount: 1,
    totalReceivable: '67800.00',
    createdAt: new Date(Date.now() - 86400000 * 3),
  },

  // 3. Textiles Pilot: Kongu Tex & Garments (t-demo-textiles)
  {
    id: 'c-pilot-textiles-1',
    tenantId: 't-demo-textiles',
    name: 'Chennai Silks Mart',
    companyName: 'The Chennai Silks Garments Division',
    phone: '+919443066666',
    whatsappNumber: '+919443066666',
    gstin: '33AABCT9988E1Z1',
    openingBalance: '25000.00',
    creditLimit: '300000.00',
    activeOrdersCount: 1,
    totalReceivable: '135000.00',
    createdAt: new Date(Date.now() - 86400000 * 12),
  },
  {
    id: 'c-textiles-2',
    tenantId: 't-demo-textiles',
    name: 'Coimbatore Weaver Cooperative',
    companyName: 'Weavers Handloom Society',
    phone: '+919443099991',
    whatsappNumber: '+919443099991',
    gstin: '33AAABC1234D1Z2',
    openingBalance: '0.00',
    creditLimit: '100000.00',
    activeOrdersCount: 0,
    totalReceivable: '0.00',
    createdAt: new Date(Date.now() - 86400000 * 2),
  },

  // 4. Trading Pilot: Sun Steel & Industrial Traders (t-demo-trading)
  {
    id: 'c-pilot-trading-1',
    tenantId: 't-demo-trading',
    name: 'Apex Fabrication Works',
    companyName: 'Apex Heavy Structures Pvt Ltd',
    phone: '+919443088888',
    whatsappNumber: '+919443088888',
    gstin: '33AABCX5544J1Z9',
    openingBalance: '12000.00',
    creditLimit: '250000.00',
    activeOrdersCount: 1,
    totalReceivable: '12000.00',
    createdAt: new Date(Date.now() - 86400000 * 15),
  },
  {
    id: 'c-trading-2',
    tenantId: 't-demo-trading',
    name: 'Southern Hardware Distributors',
    companyName: 'Southern Retail Chains',
    phone: '+919443099992',
    whatsappNumber: '+919443099992',
    gstin: '33AABCS7766K1Z4',
    openingBalance: '0.00',
    creditLimit: '80000.00',
    activeOrdersCount: 0,
    totalReceivable: '0.00',
    createdAt: new Date(Date.now() - 86400000 * 1),
  },
];

export const globalMemoryOrders: Array<any> = [
  {
    id: 'ord-pilot-print-1',
    tenantId: 't-demo-printing',
    customerId: 'c-pilot-printing-1',
    orderNumber: 'ORD-2026-4011',
    productionStage: 'PRINTING_CMYK',
    totalAmount: '125000.00',
    advanceReceived: '50000.00',
    balanceDue: '75000.00',
    createdAt: new Date(Date.now() - 86400000 * 50), // 50 days ago (for repeat radar)
  },
  {
    id: 'ord-demo-1',
    tenantId: 't-demo-printing',
    customerId: 'c-demo-1',
    orderNumber: 'ORD-2026-0089',
    productionStage: 'ARTWORK_PENDING',
    totalAmount: '172000.00',
    advanceReceived: '86000.00',
    balanceDue: '86000.00',
    createdAt: new Date(Date.now() - 86400000 * 2),
  },
  {
    id: 'ord-pilot-furn-1',
    tenantId: 't-demo-furniture',
    customerId: 'c-pilot-furniture-1',
    orderNumber: 'ORD-2026-4022',
    productionStage: 'POLISHING_UPHOLSTERY',
    totalAmount: '85000.00',
    advanceReceived: '35000.00',
    balanceDue: '50000.00',
    createdAt: new Date(Date.now() - 86400000 * 55), // 55 days ago
  },
  {
    id: 'ord-demo-3',
    tenantId: 't-demo-furniture',
    customerId: 'c-demo-3',
    orderNumber: 'ORD-2026-0045',
    productionStage: 'WOOD_CUTTING',
    totalAmount: '97800.00',
    advanceReceived: '30000.00',
    balanceDue: '67800.00',
    createdAt: new Date(Date.now() - 86400000 * 3),
  },
  {
    id: 'ord-pilot-tex-1',
    tenantId: 't-demo-textiles',
    customerId: 'c-pilot-textiles-1',
    orderNumber: 'ORD-2026-4033',
    productionStage: 'PACKING_BALE',
    totalAmount: '210000.00',
    advanceReceived: '100000.00',
    balanceDue: '110000.00',
    createdAt: new Date(Date.now() - 86400000 * 60),
  },
  {
    id: 'ord-pilot-trade-1',
    tenantId: 't-demo-trading',
    customerId: 'c-pilot-trading-1',
    orderNumber: 'ORD-2026-4044',
    productionStage: 'MATERIAL_PICKING',
    totalAmount: '64000.00',
    advanceReceived: '64000.00',
    balanceDue: '0.00',
    createdAt: new Date(Date.now() - 86400000 * 70),
  },
];

export const globalMemoryLeads: Array<any> = [
  {
    id: 'lead-demo-1',
    tenantId: 't-demo-printing',
    customerId: 'c-demo-1',
    title: 'Diwali Packaging Boxes & Product Sleeves',
    source: 'WHATSAPP',
    stage: 'WON',
    priority: 'HIGH',
    estimatedValue: '185000',
    createdAt: new Date(Date.now() - 3600000 * 2),
  },
  {
    id: 'lead-demo-2',
    tenantId: 't-demo-printing',
    customerId: 'c-pilot-printing-1',
    title: 'New Year Wall Calendars (10,000 Qty)',
    source: 'PHONE',
    stage: 'QUOTED',
    priority: 'MEDIUM',
    estimatedValue: '72000',
    createdAt: new Date(Date.now() - 86400000),
  },
  {
    id: 'lead-demo-3',
    tenantId: 't-demo-printing',
    customerId: 'c-demo-1',
    title: 'Sweet Box Reprints',
    source: 'WALK_IN',
    stage: 'NEW',
    priority: 'LOW',
    estimatedValue: '25000',
    createdAt: new Date(Date.now() - 86400000 * 3),
  },
];

export const globalMemoryQuotations: Array<any> = [
  {
    id: 'quote-demo-1',
    tenantId: 't-demo-printing',
    quoteNumber: 'QT-2026-0042',
    version: 1,
    customerId: 'c-demo-1',
    leadId: 'lead-demo-1',
    status: 'SENT',
    subTotal: '150000.00',
    taxTotal: '27000.00',
    discountTotal: '5000.00',
    grandTotal: '172000.00',
    validUntil: new Date(Date.now() + 15 * 86400000),
    termsAndConditions: 'Payment: 50% advance with PO, 50% on dispatch.\nDelivery: 7 working days after artwork approval.',
    customData: {
      job_type: 'PACKAGING_BOX',
      paper_board_gsm: '350 GSM Cyber Premium Board',
      print_colors: 'CMYK_PLUS_PANTONE',
      finishing_ops: ['MATT_LAM', 'SPOT_UV', 'DIE_PUNCH'],
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

export const globalMemoryQuotationItems: Array<any> = [
  {
    id: 'qi-demo-1',
    tenantId: 't-demo-printing',
    quotationId: 'quote-demo-1',
    itemName: 'Diwali Premium Rigid Boxes (Lidded)',
    description: '350 GSM Cyber Premium Board, Matt Lamination, Gold Foil Stamping',
    quantity: '5000.00',
    unit: 'Nos',
    unitPrice: '30.00',
    taxPercent: '18.00',
    lineTotal: '177000.00',
  },
];

export const globalMemoryOrderItems: Array<any> = [
  {
    id: 'item-ord-demo-1-1',
    tenantId: 't-demo-printing',
    orderId: 'ord-demo-1',
    itemName: 'Diwali Premium Rigid Boxes (Lidded)',
    description: '350 GSM Cyber Premium Board, Matt Lamination, Gold Foil Stamping',
    quantity: '5000.00',
    unit: 'Nos',
    unitPrice: '30.00',
    taxPercent: '18.00',
    lineTotal: '177000.00',
  },
];

export const globalMemoryTasks: Array<any> = [];
export const globalMemoryActivities: Array<any> = [];
export const globalMemoryAuditLogs: Array<any> = [];
export const globalMemoryOutbox: Array<any> = [];
export const globalMemoryPayments: Array<any> = [
  {
    id: 'pay-demo-1',
    tenantId: 't-demo-printing',
    receiptNumber: 'RCP-2026-0101',
    orderId: 'ord-demo-1',
    customerId: 'c-demo-1',
    amount: '86000.00',
    mode: 'UPI',
    referenceNo: 'UPI/62891028391',
    receivedById: 'u-demo-1',
    paidAt: new Date(Date.now() - 3600000 * 5),
    notes: 'Initial 50% advance for raw material',
  },
  {
    id: 'pay-demo-2',
    tenantId: 't-demo-printing',
    receiptNumber: 'RCP-2026-0098',
    orderId: 'ord-demo-2',
    customerId: 'c-demo-2',
    amount: '50000.00',
    mode: 'BANK_TRANSFER',
    referenceNo: 'NEFT-AXIS-91823019',
    receivedById: 'u-demo-1',
    paidAt: new Date(Date.now() - 3600000 * 24),
    notes: 'Advance transfer',
  },
];
