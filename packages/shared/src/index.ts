export * from './templates';
export * from './dtos/auth.dto';
export * from './dtos/crm.dto';
export * from './dtos/sales.dto';
export * from './dtos/custom-fields.dto';

export * from './rbac/permissions';
export { Role, ROLE_PERMISSIONS, hasPermission as hasRolePermission } from './rbac/roles';
export type { TenantRole, PermissionAction } from './permissions';
export {
  ROLE_PERMISSION_MATRIX,
  hasPermission,
  hasTenantPermission,
} from './permissions';

export * from './constants/industries';
export * from './constants/order-stages';
export * from './gst';
export * from './customer-import';
export * from './product-import';
export * from './attachments';
export * from './quote-suggest';
export * from './quote-text';
export * from './credit-note';
