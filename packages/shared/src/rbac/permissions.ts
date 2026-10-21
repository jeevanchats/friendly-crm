export enum Permission {
  // Tenant & Organization
  TENANT_READ = 'tenant:read',
  TENANT_UPDATE = 'tenant:update',
  TENANT_MANAGE_USERS = 'tenant:manage_users',

  // CRM
  LEAD_READ = 'lead:read',
  LEAD_CREATE = 'lead:create',
  LEAD_UPDATE = 'lead:update',
  LEAD_DELETE = 'lead:delete',

  CUSTOMER_READ = 'customer:read',
  CUSTOMER_CREATE = 'customer:create',
  CUSTOMER_UPDATE = 'customer:update',
  CUSTOMER_DELETE = 'customer:delete',

  TASK_READ = 'task:read',
  TASK_CREATE = 'task:create',
  TASK_UPDATE = 'task:update',

  // Sales
  QUOTATION_READ = 'quotation:read',
  QUOTATION_CREATE = 'quotation:create',
  QUOTATION_UPDATE = 'quotation:update',
  QUOTATION_APPROVE = 'quotation:approve',
  QUOTATION_PDF = 'quotation:pdf',

  ORDER_READ = 'order:read',
  ORDER_CREATE = 'order:create',
  ORDER_UPDATE = 'order:update',
  ORDER_CANCEL = 'order:cancel',

  // Workflow & Settings
  WORKFLOW_READ = 'workflow:read',
  WORKFLOW_MANAGE = 'workflow:manage',

  // Audit
  AUDIT_READ = 'audit:read',
}
