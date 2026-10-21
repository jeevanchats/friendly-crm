import { Permission } from './permissions';

export enum Role {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  SALES_MANAGER = 'SALES_MANAGER',
  SALES_REP = 'SALES_REP',
  VIEWER = 'VIEWER',
}

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.OWNER]: Object.values(Permission),
  [Role.ADMIN]: Object.values(Permission),
  [Role.SALES_MANAGER]: [
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
    Permission.QUOTATION_UPDATE,
    Permission.QUOTATION_APPROVE,
    Permission.QUOTATION_PDF,
    Permission.ORDER_READ,
    Permission.ORDER_CREATE,
    Permission.ORDER_UPDATE,
    Permission.WORKFLOW_READ,
    Permission.AUDIT_READ,
  ],
  [Role.SALES_REP]: [
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
    Permission.ORDER_CREATE,
  ],
  [Role.VIEWER]: [
    Permission.TENANT_READ,
    Permission.LEAD_READ,
    Permission.CUSTOMER_READ,
    Permission.TASK_READ,
    Permission.QUOTATION_READ,
    Permission.ORDER_READ,
  ],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
