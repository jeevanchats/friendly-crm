import { Permission } from './permissions';

export enum Role {
  // Canonical roles
  OWNER = 'OWNER',
  MANAGER = 'MANAGER',
  SALESPERSON = 'SALESPERSON',
  ACCOUNTS = 'ACCOUNTS',
  PRODUCTION = 'PRODUCTION',
  READ_ONLY = 'READ_ONLY',

  // Legacy aliases
  ADMIN = 'OWNER',
  SALES_MANAGER = 'MANAGER',
  SALES_REP = 'SALESPERSON',
  VIEWER = 'READ_ONLY',
}

export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  [Role.OWNER]: Object.values(Permission),
  [Role.MANAGER]: [
    Permission.TENANT_READ,
    Permission.TENANT_UPDATE,
    Permission.LEAD_READ,
    Permission.LEAD_CREATE,
    Permission.LEAD_UPDATE,
    Permission.CUSTOMER_READ,
    Permission.CUSTOMER_CREATE,
    Permission.CUSTOMER_UPDATE,
    Permission.TASK_READ,
    Permission.TASK_CREATE,
    Permission.TASK_UPDATE,
    Permission.QUOTATION_READ,
    Permission.QUOTATION_CREATE,
    Permission.QUOTATION_UPDATE,
    Permission.QUOTATION_APPROVE,
    Permission.QUOTATION_PDF,
    Permission.ORDER_READ,
    Permission.ORDER_CREATE,
    Permission.ORDER_UPDATE,
    Permission.WORKFLOW_READ,
    Permission.AUDIT_READ,
  ],
  [Role.SALESPERSON]: [
    Permission.TENANT_READ,
    Permission.LEAD_READ,
    Permission.LEAD_CREATE,
    Permission.LEAD_UPDATE,
    Permission.CUSTOMER_READ,
    Permission.CUSTOMER_CREATE,
    Permission.CUSTOMER_UPDATE,
    Permission.TASK_READ,
    Permission.TASK_CREATE,
    Permission.TASK_UPDATE,
    Permission.QUOTATION_READ,
    Permission.QUOTATION_CREATE,
    Permission.QUOTATION_PDF,
    Permission.ORDER_READ,
  ],
  [Role.ACCOUNTS]: [
    Permission.TENANT_READ,
    Permission.CUSTOMER_READ,
    Permission.QUOTATION_READ,
    Permission.ORDER_READ,
  ],
  [Role.PRODUCTION]: [
    Permission.TENANT_READ,
    Permission.TASK_READ,
    Permission.ORDER_READ,
    Permission.ORDER_UPDATE,
  ],
  [Role.READ_ONLY]: [
    Permission.TENANT_READ,
    Permission.LEAD_READ,
    Permission.CUSTOMER_READ,
    Permission.TASK_READ,
    Permission.QUOTATION_READ,
    Permission.ORDER_READ,
  ],
};

export function hasPermission(role: Role | string, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
