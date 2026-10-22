export type TenantRole =
  | 'OWNER'
  | 'MANAGER'
  | 'SALESPERSON'
  | 'ACCOUNTS'
  | 'PRODUCTION'
  | 'READ_ONLY';

export type PermissionAction =
  | 'tenant:read'
  | 'tenant:update'
  | 'tenant:manage_users'
  | 'lead:create'
  | 'lead:view'
  | 'lead:view_all'
  | 'lead:update'
  | 'lead:delete'
  | 'customer:create'
  | 'customer:view'
  | 'customer:update'
  | 'customer:delete'
  | 'task:create'
  | 'task:view'
  | 'task:update'
  | 'task:complete'
  | 'quote:create'
  | 'quote:view'
  | 'quote:update'
  | 'quote:convert'
  | 'quote:pdf'
  | 'order:create'
  | 'order:view'
  | 'order:update_stage'
  | 'order:cancel'
  | 'payment:create'
  | 'payment:view'
  | 'report:view'
  | 'settings:manage'
  | 'workflow:read'
  | 'workflow:manage'
  | 'audit:read';

export const ROLE_PERMISSION_MATRIX: Record<TenantRole, PermissionAction[]> = {
  OWNER: [
    'tenant:read',
    'tenant:update',
    'tenant:manage_users',
    'lead:create',
    'lead:view',
    'lead:view_all',
    'lead:update',
    'lead:delete',
    'customer:create',
    'customer:view',
    'customer:update',
    'customer:delete',
    'task:create',
    'task:view',
    'task:update',
    'task:complete',
    'quote:create',
    'quote:view',
    'quote:update',
    'quote:convert',
    'quote:pdf',
    'order:create',
    'order:view',
    'order:update_stage',
    'order:cancel',
    'payment:create',
    'payment:view',
    'report:view',
    'settings:manage',
    'workflow:read',
    'workflow:manage',
    'audit:read',
  ],
  MANAGER: [
    'tenant:read',
    'tenant:update',
    'lead:create',
    'lead:view',
    'lead:view_all',
    'lead:update',
    'customer:create',
    'customer:view',
    'customer:update',
    'task:create',
    'task:view',
    'task:update',
    'task:complete',
    'quote:create',
    'quote:view',
    'quote:update',
    'quote:convert',
    'quote:pdf',
    'order:create',
    'order:view',
    'order:update_stage',
    'payment:view',
    'report:view',
    'workflow:read',
    'audit:read',
  ],
  SALESPERSON: [
    'tenant:read',
    'lead:create',
    'lead:view',
    'lead:update',
    'customer:create',
    'customer:view',
    'task:create',
    'task:view',
    'task:update',
    'task:complete',
    'quote:create',
    'quote:view',
    'quote:update',
    'quote:convert',
    'quote:pdf',
    'order:view',
  ],
  ACCOUNTS: [
    'tenant:read',
    'customer:view',
    'order:view',
    'payment:create',
    'payment:view',
    'report:view',
    'quote:view',
  ],
  PRODUCTION: [
    'tenant:read',
    'task:view',
    'task:complete',
    'order:view',
    'order:update_stage',
  ],
  READ_ONLY: [
    'tenant:read',
    'lead:view',
    'customer:view',
    'task:view',
    'quote:view',
    'order:view',
    'payment:view',
    'report:view',
  ],
};

export function hasPermission(role: TenantRole | string, action: PermissionAction): boolean {
  const allowed = ROLE_PERMISSION_MATRIX[role as TenantRole];
  return allowed ? allowed.includes(action) : false;
}

export const hasTenantPermission = hasPermission;