export interface StageDefinition {
  key: string;
  label: string;
  tamilLabel: string;
  color: string;
}

export const DEFAULT_ORDER_STAGES: StageDefinition[] = [
  { key: 'PENDING', label: 'Pending', tamilLabel: 'நிலுவையில்', color: 'amber' },
  { key: 'CONFIRMED', label: 'Confirmed', tamilLabel: 'உறுதிப்படுத்தப்பட்டது', color: 'blue' },
  { key: 'IN_PRODUCTION', label: 'In Production', tamilLabel: 'உற்பத்தியில்', color: 'indigo' },
  { key: 'READY_FOR_DELIVERY', label: 'Ready for Delivery', tamilLabel: 'டெலிவரிக்கு தயார்', color: 'purple' },
  { key: 'DISPATCHED', label: 'Dispatched', tamilLabel: 'அனுப்பப்பட்டது', color: 'cyan' },
  { key: 'DELIVERED', label: 'Delivered', tamilLabel: 'டெலிவரி செய்யப்பட்டது', color: 'emerald' },
  { key: 'COMPLETED', label: 'Completed', tamilLabel: 'முடிவடைந்தது', color: 'green' },
  { key: 'CANCELLED', label: 'Cancelled', tamilLabel: 'ரத்து செய்யப்பட்டது', color: 'rose' },
];
