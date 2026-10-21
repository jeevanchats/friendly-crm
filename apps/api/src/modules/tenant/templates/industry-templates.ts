import { IndustryType } from '@friendly-crm/shared';

export interface SeededStage {
  name: string;
  key: string;
  color: string;
  sortOrder: number;
  isWonStage?: boolean;
  isLostStage?: boolean;
}

export interface SeededCustomField {
  entityType: 'LEAD' | 'CUSTOMER' | 'ORDER' | 'QUOTATION';
  name: string;
  label: string;
  type: 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT' | 'MULTI_SELECT' | 'BOOLEAN';
  required: boolean;
  options?: string[];
}

export interface IndustrySeedData {
  leadStages: SeededStage[];
  orderStages: SeededStage[];
  customFields: SeededCustomField[];
}

export const INDUSTRY_TEMPLATES: Record<IndustryType, IndustrySeedData> = {
  [IndustryType.RETAIL]: {
    leadStages: [
      { name: 'Store Visit / Enquiry', key: 'ENQUIRY', color: 'blue', sortOrder: 0 },
      { name: 'Catalogue Shared', key: 'CATALOGUE_SHARED', color: 'indigo', sortOrder: 1 },
      { name: 'Price Negotiated', key: 'PRICE_NEGOTIATED', color: 'amber', sortOrder: 2 },
      { name: 'Billed / Converted', key: 'CONVERTED', color: 'green', sortOrder: 3, isWonStage: true },
      { name: 'Dropped', key: 'DROPPED', color: 'rose', sortOrder: 4, isLostStage: true },
    ],
    orderStages: [
      { name: 'Order Placed', key: 'ORDER_PLACED', color: 'blue', sortOrder: 0 },
      { name: 'Packed', key: 'PACKED', color: 'purple', sortOrder: 1 },
      { name: 'Dispatched', key: 'DISPATCHED', color: 'cyan', sortOrder: 2 },
      { name: 'Delivered', key: 'DELIVERED', color: 'green', sortOrder: 3, isWonStage: true },
    ],
    customFields: [
      { entityType: 'CUSTOMER', name: 'membershipTier', label: 'Loyalty Tier', type: 'SELECT', required: false, options: ['Silver', 'Gold', 'Platinum'] },
      { entityType: 'LEAD', name: 'preferredChannel', label: 'Preferred Channel', type: 'SELECT', required: false, options: ['WhatsApp', 'Phone Call', 'In-Store'] },
    ],
  },
  [IndustryType.MANUFACTURING]: {
    leadStages: [
      { name: 'RFQ Received', key: 'RFQ_RECEIVED', color: 'blue', sortOrder: 0 },
      { name: 'Feasibility Review', key: 'FEASIBILITY', color: 'indigo', sortOrder: 1 },
      { name: 'Quote / Estimation', key: 'QUOTE_SENT', color: 'amber', sortOrder: 2 },
      { name: 'Sample Approved', key: 'SAMPLE_APPROVED', color: 'purple', sortOrder: 3 },
      { name: 'PO Received', key: 'PO_RECEIVED', color: 'green', sortOrder: 4, isWonStage: true },
      { name: 'Rejected', key: 'REJECTED', color: 'rose', sortOrder: 5, isLostStage: true },
    ],
    orderStages: [
      { name: 'Work Order Created', key: 'WORK_ORDER', color: 'blue', sortOrder: 0 },
      { name: 'Raw Material Procurement', key: 'PROCUREMENT', color: 'amber', sortOrder: 1 },
      { name: 'In Production', key: 'PRODUCTION', color: 'indigo', sortOrder: 2 },
      { name: 'Quality Check (QC)', key: 'QC_PASSED', color: 'purple', sortOrder: 3 },
      { name: 'Dispatched', key: 'DISPATCHED', color: 'cyan', sortOrder: 4 },
      { name: 'Delivered & Accepted', key: 'ACCEPTED', color: 'green', sortOrder: 5, isWonStage: true },
    ],
    customFields: [
      { entityType: 'ORDER', name: 'cadFileUrl', label: 'CAD Drawing URL', type: 'TEXT', required: false },
      { entityType: 'ORDER', name: 'batchNumber', label: 'Batch / Lot No', type: 'TEXT', required: true },
      { entityType: 'CUSTOMER', name: 'gstNumber', label: 'GSTIN', type: 'TEXT', required: true },
    ],
  },
  [IndustryType.SERVICES]: {
    leadStages: [
      { name: 'Initial Discovery', key: 'DISCOVERY', color: 'blue', sortOrder: 0 },
      { name: 'Scope Definition', key: 'SCOPE', color: 'indigo', sortOrder: 1 },
      { name: 'Proposal Sent', key: 'PROPOSAL_SENT', color: 'amber', sortOrder: 2 },
      { name: 'Contract Signing', key: 'CONTRACT_SIGNING', color: 'purple', sortOrder: 3 },
      { name: 'Won / Retained', key: 'WON', color: 'green', sortOrder: 4, isWonStage: true },
      { name: 'Lost', key: 'LOST', color: 'rose', sortOrder: 5, isLostStage: true },
    ],
    orderStages: [
      { name: 'Onboarding', key: 'ONBOARDING', color: 'blue', sortOrder: 0 },
      { name: 'Milestone 1 Deliverables', key: 'MILESTONE_1', color: 'indigo', sortOrder: 1 },
      { name: 'Client Review', key: 'CLIENT_REVIEW', color: 'amber', sortOrder: 2 },
      { name: 'Sign-off & Invoiced', key: 'COMPLETED', color: 'green', sortOrder: 3, isWonStage: true },
    ],
    customFields: [
      { entityType: 'LEAD', name: 'monthlyBudget', label: 'Monthly Retainer Budget', type: 'NUMBER', required: false },
      { entityType: 'ORDER', name: 'serviceAgreementDate', label: 'Agreement Date', type: 'DATE', required: false },
    ],
  },
  [IndustryType.DISTRIBUTION]: {
    leadStages: [
      { name: 'Dealer Inbound', key: 'DEALER_INBOUND', color: 'blue', sortOrder: 0 },
      { name: 'Credit Check', key: 'CREDIT_CHECK', color: 'amber', sortOrder: 1 },
      { name: 'Price List Shared', key: 'PRICE_LIST', color: 'indigo', sortOrder: 2 },
      { name: 'Account Active', key: 'ACTIVE', color: 'green', sortOrder: 3, isWonStage: true },
    ],
    orderStages: [
      { name: 'Indent Created', key: 'INDENT_CREATED', color: 'blue', sortOrder: 0 },
      { name: 'Warehouse Picked', key: 'PICKED', color: 'indigo', sortOrder: 1 },
      { name: 'In Transit', key: 'IN_TRANSIT', color: 'cyan', sortOrder: 2 },
      { name: 'Delivered', key: 'DELIVERED', color: 'green', sortOrder: 3, isWonStage: true },
    ],
    customFields: [
      { entityType: 'CUSTOMER', name: 'creditLimit', label: 'Credit Limit (INR)', type: 'NUMBER', required: false },
    ],
  },
};
