import { TenantRole, hasPermission } from '@friendly-crm/shared';

export const SENSITIVE_FINANCIAL_KEYS = [
  'amount',
  'balanceRemaining',
  'totalAmount',
  'grandTotal',
  'balance',
  'subTotal',
  'taxTotal',
  'discountTotal',
  'price',
  'unitPrice',
  'lineTotal',
  'advanceReceived',
  'balanceDue',
  'openingBalance',
  'creditLimit',
  'totalReceivable',
  'lifetimeOrderValue',
  'totalPendingBalance',
];

/**
 * Returns true if the user's role grants permission to view financial / payment figures.
 */
export function canViewFinancials(role?: TenantRole | string): boolean {
  if (!role) return false;
  return hasPermission(role as TenantRole, 'payment:view');
}

/**
 * Strips all sensitive financial keys from an activity metadata payload.
 */
export function sanitizeActivityMetadata(metadata: any): any {
  if (!metadata || typeof metadata !== 'object') return metadata;
  const sanitized = { ...metadata };
  for (const key of SENSITIVE_FINANCIAL_KEYS) {
    if (key in sanitized) {
      delete sanitized[key];
    }
  }
  return sanitized;
}

/**
 * Checks whether an activity represents a financial payment or collection transaction.
 */
export function isPaymentActivity(action?: string, entityType?: string): boolean {
  if (entityType === 'PAYMENT') return true;
  if (!action) return false;
  const upper = action.toUpperCase();
  return upper.includes('PAYMENT') || upper.includes('ADVANCE');
}

/**
 * Filters out payment events and sanitizes metadata of remaining activities when user lacks financial view permission.
 */
export function filterAndSanitizeActivities(activities: any[], canSeePayments: boolean): any[] {
  if (!Array.isArray(activities)) return [];
  if (canSeePayments) return activities;

  return activities
    .filter((a) => !isPaymentActivity(a?.action, a?.entityType))
    .map((a) => ({
      ...a,
      metadata: sanitizeActivityMetadata(a?.metadata),
    }));
}
