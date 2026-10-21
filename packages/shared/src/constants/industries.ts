export enum IndustryType {
  RETAIL = 'RETAIL',
  MANUFACTURING = 'MANUFACTURING',
  SERVICES = 'SERVICES',
  DISTRIBUTION = 'DISTRIBUTION',
}

export interface IndustryMetadata {
  id: IndustryType;
  label: string;
  tamilLabel: string;
  defaultStages: string[];
}

export const INDUSTRIES: Record<IndustryType, IndustryMetadata> = {
  [IndustryType.RETAIL]: {
    id: IndustryType.RETAIL,
    label: 'Retail & Wholesale',
    tamilLabel: 'சில்லறை மற்றும் மொத்த வர்த்தகம்',
    defaultStages: ['Enquiry', 'Quoted', 'Payment Pending', 'Delivered'],
  },
  [IndustryType.MANUFACTURING]: {
    id: IndustryType.MANUFACTURING,
    label: 'Manufacturing & Fabrication',
    tamilLabel: 'உற்பத்தி மற்றும் தயாரிப்பு',
    defaultStages: ['Specification', 'Quotation', 'Work Order', 'Production', 'QC Passed', 'Dispatched'],
  },
  [IndustryType.SERVICES]: {
    id: IndustryType.SERVICES,
    label: 'B2B & Professional Services',
    tamilLabel: 'தொழில்முறை மற்றும் வணிகச் சேவைகள்',
    defaultStages: ['Discovery', 'Proposal', 'Negotiation', 'Contract Signed', 'In Progress', 'Completed'],
  },
  [IndustryType.DISTRIBUTION]: {
    id: IndustryType.DISTRIBUTION,
    label: 'Distribution & Logistics',
    tamilLabel: 'விநியோகம் மற்றும் தளவாடங்கள்',
    defaultStages: ['PO Received', 'Packing', 'In Transit', 'Delivered', 'Invoiced'],
  },
};
