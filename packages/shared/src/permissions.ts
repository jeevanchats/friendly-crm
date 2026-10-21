export type TenantRole =
  | 'OWNER'
  | 'MANAGER'
  | 'SALESPERSON'
  | 'ACCOUNTS'
  | 'PRODUCTION'
  | 'READ_ONLY';

export type PermissionAction =
  | 'lead:create'
  | 'lead:view_all'
  | 'quote:create'
  | 'quote:convert'
  | 'order:view'
  | 'order:update_stage'
  | 'payment:create'
  | 'payment:view'
  | 'report:view'
  | 'settings:manage';

export const ROLE_PERMISSION_MATRIX: Record<TenantRole, PermissionAction[]> = {
  OWNER: [
    'lead:create', 'lead:view_all', 'quote:create', 'quote:convert',
    'order:view', 'order:update_stage', 'payment:create', 'payment:view',
    'report:view', 'settings:manage',
  ],
  MANAGER: [
    'lead:create', 'lead:view_all', 'quote:create', 'quote:convert',
    'order:view', 'order:update_stage', 'payment:view', 'report:view',
  ],
  SALESPERSON: [
    'lead:create', 'quote:create', 'quote:convert', 'order:view',
  ],
  ACCOUNTS: [
    'order:view', 'payment:create', 'payment:view', 'report:view',
  ],
  PRODUCTION: [
    'order:view', 'order:update_stage',
  ],
  READ_ONLY: [
    'order:view', 'payment:view', 'report:view',
  ],
};

export function hasPermission(role: TenantRole, action: PermissionAction): boolean {
  return ROLE_PERMISSION_MATRIX[role]?.includes(action) ?? false;
}

export const hasTenantPermission = hasPermission;