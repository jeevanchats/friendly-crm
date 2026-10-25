import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';

// --- REUSABLE HELPERS ---
export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
};

// ==========================================
// 1. ORGANIZATION & TENANT DOMAIN
// ==========================================

export const tenants = pgTable('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 160 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  industryKey: varchar('industry_key', { length: 50 }).notNull(), // 'printing' | 'textiles' | 'furniture' | 'trading'
  defaultLanguage: varchar('default_language', { length: 10 }).default('en').notNull(), // 'en' | 'ta'
  gstNumber: varchar('gst_number', { length: 20 }),
  phone: varchar('phone', { length: 20 }).notNull(), // E.164 Normalized (+91...)
  isActive: boolean('is_active').default(true).notNull(),
  // Owner opt-out: when false, customers texting the WhatsApp number cannot view their own orders.
  customerSelfServiceEnabled: boolean('customer_self_service_enabled').default(true).notNull(),
  // The business's UPI ID (VPA) that customers pay dues to. Set by the owner; null = no payment links.
  upiId: varchar('upi_id', { length: 100 }),
  // Supplier block of GST invoices. gstNumber is above; stateCode is the two-digit GST state code.
  legalName: varchar('legal_name', { length: 200 }),
  address: text('address'),
  stateCode: varchar('state_code', { length: 2 }),
  // Automatic payment reminders: opt-in, first after N days overdue, then every N days, at most N in total.
  autoRemindersEnabled: boolean('auto_reminders_enabled').default(false).notNull(),
  reminderAfterDays: integer('reminder_after_days').default(7).notNull(),
  reminderRepeatDays: integer('reminder_repeat_days').default(7).notNull(),
  reminderMaxCount: integer('reminder_max_count').default(3).notNull(),
  ...timestamps,
});

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  fullName: varchar('full_name', { length: 120 }).notNull(),
  phone: varchar('phone', { length: 20 }).notNull().unique(), // Used for OTP login
  email: varchar('email', { length: 160 }),
  preferredLanguage: varchar('preferred_language', { length: 10 }).default('en').notNull(),
  ...timestamps,
});

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    role: varchar('role', { length: 30 }).notNull(), // OWNER, MANAGER, SALESPERSON, ACCOUNTS, PRODUCTION, READ_ONLY
    isActive: boolean('is_active').default(true).notNull(),
    ...timestamps,
  },
  (table) => ({
    tenantUserIdx: uniqueIndex('memberships_tenant_user_idx').on(table.tenantId, table.userId),
  })
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).defaultNow().notNull(),
    ...timestamps,
  },
  (table) => ({
    tokenHashIdx: uniqueIndex('sessions_token_hash_idx').on(table.tokenHash),
    userSessionIdx: index('sessions_user_idx').on(table.userId),
  })
);

export const otpVerifications = pgTable(
  'otp_verifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    phone: varchar('phone', { length: 20 }).notNull(),
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
    attempts: integer('attempts').default(0).notNull(),
    maxAttempts: integer('max_attempts').default(3).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => ({
    phoneIdx: index('otp_verifications_phone_idx').on(table.phone, table.consumedAt, table.expiresAt),
  })
);

// ==========================================
// 2. CRM DOMAIN (Customers, Leads, Tasks, Audit)
// ==========================================

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    companyName: varchar('company_name', { length: 160 }),
    phone: varchar('phone', { length: 20 }).notNull(), // E.164 (+91XXXXXXXXXX)
    whatsappNumber: varchar('whatsapp_number', { length: 20 }),
    email: varchar('email', { length: 160 }),
    gstin: varchar('gstin', { length: 20 }),
    billingAddress: text('billing_address'),
    shippingAddress: text('shipping_address'),
    // GST state code, used as the place of supply when the customer has no GSTIN
    stateCode: varchar('state_code', { length: 2 }),
    // The customer asked not to get automatic reminders (staff can still send one by hand)
    remindersOptOut: boolean('reminders_opt_out').default(false).notNull(),
    creditLimit: numeric('credit_limit', { precision: 12, scale: 2 }).default('0.00'),
    openingBalance: numeric('opening_balance', { precision: 12, scale: 2 }).default('0.00'),
    customData: jsonb('custom_data').$type<Record<string, any>>().default({}).notNull(),
    createdById: uuid('created_by_id').references(() => users.id),
    ...timestamps,
  },
  (table) => ({
    tenantPhoneIdx: uniqueIndex('customers_tenant_phone_idx').on(table.tenantId, table.phone),
    tenantNameIdx: index('customers_tenant_name_idx').on(table.tenantId, table.name),
  })
);

export const leads = pgTable(
  'leads',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'cascade' }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    source: varchar('source', { length: 40 }).notNull(), // 'WHATSAPP' | 'PHONE' | 'WALK_IN' | 'WEBSITE' | 'REFERRAL'
    stage: varchar('stage', { length: 50 }).default('NEW').notNull(), // 'NEW' | 'QUALIFIED' | 'QUOTED' | 'NEGOTIATION' | 'WON' | 'LOST'
    priority: varchar('priority', { length: 20 }).default('MEDIUM').notNull(), // 'LOW' | 'MEDIUM' | 'HIGH'
    estimatedValue: numeric('estimated_value', { precision: 12, scale: 2 }),
    notes: text('notes'),
    assignedToId: uuid('assigned_to_id').references(() => users.id),
    customData: jsonb('custom_data').$type<Record<string, any>>().default({}).notNull(),
    ...timestamps,
  },
  (table) => ({
    tenantStageIdx: index('leads_tenant_stage_idx').on(table.tenantId, table.stage),
    tenantAssigneeIdx: index('leads_tenant_assignee_idx').on(table.tenantId, table.assignedToId),
  })
);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    type: varchar('type', { length: 40 }).default('FOLLOW_UP_CALL').notNull(), // 'SEND_QUOTE' | 'FOLLOW_UP_CALL' | 'WHATSAPP' | 'PAYMENT_REMINDER' | 'SITE_VISIT'
    title: varchar('title', { length: 200 }).notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    status: varchar('status', { length: 30 }).default('PENDING').notNull(), // 'PENDING' | 'COMPLETED' | 'CANCELLED'
    outcomeNote: text('outcome_note'),
    assignedToId: uuid('assigned_to_id').references(() => users.id).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => ({
    tenantDueStatusIdx: index('tasks_tenant_due_status_idx').on(table.tenantId, table.status, table.dueAt),
  })
);

export const activities = pgTable(
  'activities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
    actorId: uuid('actor_id').references(() => users.id),
    entityType: varchar('entity_type', { length: 40 }).notNull(), // 'CUSTOMER' | 'LEAD' | 'QUOTATION' | 'ORDER' | 'PAYMENT'
    entityId: uuid('entity_id').notNull(),
    action: varchar('action', { length: 60 }).notNull(),
    metadata: jsonb('metadata').$type<Record<string, any>>().default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    tenantEntityIdx: index('activities_tenant_entity_idx').on(table.tenantId, table.entityType, table.entityId),
  })
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
    actorId: uuid('actor_id').references(() => users.id),
    action: varchar('action', { length: 80 }).notNull(), // 'CREATE' | 'UPDATE' | 'DELETE' | 'STAGE_CHANGE'
    entityType: varchar('entity_type', { length: 50 }).notNull(), // 'CUSTOMER' | 'LEAD' | 'ORDER' | 'QUOTATION' | 'PAYMENT' | 'MEMBERSHIP' | 'TASK'
    entityId: varchar('entity_id', { length: 64 }),
    changes: jsonb('changes').$type<{
      before?: Record<string, any>;
      after?: Record<string, any>;
      metadata?: Record<string, any>;
    }>().default({}).notNull(),
    ipAddress: varchar('ip_address', { length: 50 }),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    tenantAuditIdx: index('audit_logs_tenant_idx').on(table.tenantId, table.createdAt),
    entityAuditIdx: index('audit_logs_entity_idx').on(table.tenantId, table.entityType, table.entityId),
  })
);

// ==========================================
// 3. SALES DOMAIN (Quotations & Orders)
// ==========================================

export const quotations = pgTable(
  'quotations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
    quoteNumber: varchar('quote_number', { length: 50 }).notNull(), // e.g., 'QT-2026-0042'
    version: integer('version').default(1).notNull(),
    parentQuoteId: uuid('parent_quote_id'), // Self-reference for revision tracking
    customerId: uuid('customer_id').references(() => customers.id).notNull(),
    leadId: uuid('lead_id').references(() => leads.id),
    status: varchar('status', { length: 30 }).default('DRAFT').notNull(), // 'DRAFT' | 'SENT' | 'APPROVED' | 'REJECTED' | 'CONVERTED'
    subTotal: numeric('sub_total', { precision: 12, scale: 2 }).notNull(),
    taxTotal: numeric('tax_total', { precision: 12, scale: 2 }).default('0.00').notNull(),
    discountTotal: numeric('discount_total', { precision: 12, scale: 2 }).default('0.00').notNull(),
    grandTotal: numeric('grand_total', { precision: 12, scale: 2 }).notNull(),
    validUntil: timestamp('valid_until', { withTimezone: true }),
    termsAndConditions: text('terms_and_conditions'),
    customData: jsonb('custom_data').$type<Record<string, any>>().default({}).notNull(),
    ...timestamps,
  },
  (table) => ({
    tenantQuoteNumIdx: uniqueIndex('quotations_tenant_number_version_idx').on(
      table.tenantId,
      table.quoteNumber,
      table.version
    ),
  })
);

export const quotationItems = pgTable('quotation_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  quotationId: uuid('quotation_id').references(() => quotations.id, { onDelete: 'cascade' }).notNull(),
  itemName: varchar('item_name', { length: 200 }).notNull(),
  description: text('description'), // Holds specs like "300 GSM Art Board, Matt Lamination"
  quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull(),
  unit: varchar('unit', { length: 30 }).default('Nos').notNull(), // 'Nos' | 'Sq.Ft' | 'Meters' | 'Bales' | 'Sets'
  unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
  hsnCode: varchar('hsn_code', { length: 8 }),
  taxPercent: numeric('tax_percent', { precision: 5, scale: 2 }).default('18.00').notNull(),
  lineTotal: numeric('line_total', { precision: 12, scale: 2 }).notNull(),
});

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
    orderNumber: varchar('order_number', { length: 50 }).notNull(), // e.g., 'ORD-2026-0105'
    customerId: uuid('customer_id').references(() => customers.id).notNull(),
    quotationId: uuid('quotation_id').references(() => quotations.id),
    // Stage is driven dynamically by the Tenant's active Industry Pipeline
    productionStage: varchar('production_stage', { length: 60 }).notNull(),
    totalAmount: numeric('total_amount', { precision: 12, scale: 2 }).notNull(),
    advanceReceived: numeric('advance_received', { precision: 12, scale: 2 }).default('0.00').notNull(),
    balanceDue: numeric('balance_due', { precision: 12, scale: 2 }).notNull(),
    expectedDeliveryAt: timestamp('expected_delivery_at', { withTimezone: true }),
    customData: jsonb('custom_data').$type<Record<string, any>>().default({}).notNull(),
    ...timestamps,
  },
  (table) => ({
    tenantOrderStageIdx: index('orders_tenant_stage_idx').on(table.tenantId, table.productionStage),
  })
);

export const orderItems = pgTable('order_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  orderId: uuid('order_id').references(() => orders.id, { onDelete: 'cascade' }).notNull(),
  itemName: varchar('item_name', { length: 200 }).notNull(),
  description: text('description'),
  quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull(),
  unit: varchar('unit', { length: 30 }).default('Nos').notNull(),
  unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
  hsnCode: varchar('hsn_code', { length: 8 }),
  taxPercent: numeric('tax_percent', { precision: 5, scale: 2 }).default('18.00').notNull(),
  lineTotal: numeric('line_total', { precision: 12, scale: 2 }).notNull(),
});

/**
 * Product / service master. A quotation line copies these defaults when a product is picked, so editing a
 * product never changes quotes or invoices already made. Archived (is_active = false) instead of deleted.
 * Name and code are unique per business (case-insensitive) via indexes created in migration 0010.
 */
export const products = pgTable(
  'products',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    code: varchar('code', { length: 50 }),
    description: text('description'),
    hsnCode: varchar('hsn_code', { length: 8 }),
    unit: varchar('unit', { length: 30 }).default('Nos').notNull(),
    unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).default('0.00').notNull(),
    taxPercent: numeric('tax_percent', { precision: 5, scale: 2 }).default('18.00').notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdById: uuid('created_by_id').references(() => users.id),
    ...timestamps,
  },
  (table) => ({
    tenantActiveIdx: index('products_tenant_active_idx').on(table.tenantId, table.isActive),
  })
);

// ==========================================
// 4. BILLING & PAYMENTS DOMAIN
// ==========================================

export interface InvoiceParty {
  name: string;
  gstin: string | null;
  address: string | null;
  stateCode: string | null;
  phone?: string | null;
}

/**
 * A GST tax invoice, issued once per order. The row and its items are a snapshot: later edits to the
 * business, customer or order never change an issued invoice, and the app role cannot UPDATE or DELETE it.
 * `amount` is the invoice total and always equals the order total. Whether it has been paid is derived from the
 * order's balance, not stored here.
 */
export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
    invoiceNumber: varchar('invoice_number', { length: 50 }).notNull(), // 'INV/2026-27/0001' (16 chars max under GST)
    financialYear: varchar('financial_year', { length: 7 }), // '2026-27'
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'cascade' }).notNull(),
    customerId: uuid('customer_id').references(() => customers.id).notNull(),
    supplyType: varchar('supply_type', { length: 5 }), // 'INTRA' (CGST+SGST) | 'INTER' (IGST)
    placeOfSupply: varchar('place_of_supply', { length: 2 }), // GST state code
    taxableValue: numeric('taxable_value', { precision: 12, scale: 2 }),
    cgstAmount: numeric('cgst_amount', { precision: 12, scale: 2 }),
    sgstAmount: numeric('sgst_amount', { precision: 12, scale: 2 }),
    igstAmount: numeric('igst_amount', { precision: 12, scale: 2 }),
    roundOff: numeric('round_off', { precision: 12, scale: 2 }),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    // Legacy columns from before GST invoices existed; payment state is derived from the order instead.
    paidAmount: numeric('paid_amount', { precision: 12, scale: 2 }).default('0.00').notNull(),
    status: varchar('status', { length: 30 }).default('UNPAID').notNull(),
    supplier: jsonb('supplier').$type<InvoiceParty>(),
    buyer: jsonb('buyer').$type<InvoiceParty>(),
    dueDate: timestamp('due_date', { withTimezone: true }),
    issuedById: uuid('issued_by_id').references(() => users.id),
    issuedAt: timestamp('issued_at', { withTimezone: true }).defaultNow().notNull(),
    ...timestamps,
  },
  (table) => ({
    tenantInvoiceIdx: index('invoices_tenant_idx').on(table.tenantId),
    tenantNumberIdx: uniqueIndex('invoices_tenant_number_idx').on(table.tenantId, table.invoiceNumber),
    tenantOrderIdx: uniqueIndex('invoices_tenant_order_idx').on(table.tenantId, table.orderId),
  })
);

export const invoiceItems = pgTable(
  'invoice_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
    invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'cascade' }).notNull(),
    lineNo: integer('line_no').notNull(),
    itemName: varchar('item_name', { length: 200 }).notNull(),
    description: text('description'),
    hsnCode: varchar('hsn_code', { length: 8 }).notNull(),
    quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull(),
    unit: varchar('unit', { length: 30 }).notNull(),
    unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
    taxPercent: numeric('tax_percent', { precision: 5, scale: 2 }).notNull(),
    taxableValue: numeric('taxable_value', { precision: 12, scale: 2 }).notNull(),
    cgstAmount: numeric('cgst_amount', { precision: 12, scale: 2 }).notNull(),
    sgstAmount: numeric('sgst_amount', { precision: 12, scale: 2 }).notNull(),
    igstAmount: numeric('igst_amount', { precision: 12, scale: 2 }).notNull(),
    lineTotal: numeric('line_total', { precision: 12, scale: 2 }).notNull(),
  },
  (table) => ({
    invoiceIdx: index('invoice_items_invoice_idx').on(table.tenantId, table.invoiceId),
  })
);

/** Last used invoice serial per business per financial year; incremented inside the issuing transaction. */
export const invoiceCounters = pgTable(
  'invoice_counters',
  {
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
    financialYear: varchar('financial_year', { length: 7 }).notNull(),
    lastNumber: integer('last_number').default(0).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.tenantId, table.financialYear] }),
  })
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
    receiptNumber: varchar('receipt_number', { length: 50 }).notNull(), // e.g., 'RCP-2026-0312'
    customerId: uuid('customer_id').references(() => customers.id).notNull(),
    orderId: uuid('order_id').references(() => orders.id),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    mode: varchar('mode', { length: 30 }).notNull(), // 'UPI' | 'CASH' | 'BANK_TRANSFER' | 'CHEQUE'
    referenceNo: varchar('reference_no', { length: 100 }), // UTR / UPI Ref / Cheque No
    receivedById: uuid('received_by_id').references(() => users.id).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }).defaultNow().notNull(),
    notes: text('notes'),
    ...timestamps,
  },
  (table) => ({
    tenantPaymentIdx: index('payments_tenant_idx').on(table.tenantId),
  })
);

export const paymentAllocations = pgTable(
  'payment_allocations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
    paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'cascade' }).notNull(),
    invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'cascade' }).notNull(),
    allocatedAmount: numeric('allocated_amount', { precision: 12, scale: 2 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    tenantAllocIdx: index('payment_allocations_tenant_idx').on(table.tenantId),
  })
);

// ==========================================
// 5. INDUSTRY CUSTOMIZATION ENGINE
// ==========================================

export const industryTemplates = pgTable('industry_templates', {
  key: varchar('key', { length: 50 }).primaryKey(), // 'printing', 'textiles', 'furniture', 'trading'
  nameEn: varchar('name_en', { length: 100 }).notNull(),
  nameTa: varchar('name_ta', { length: 100 }).notNull(),
  configSchema: jsonb('config_schema').notNull(), // Holds custom fields + order pipeline stages
  ...timestamps,
});

// ==========================================
// 6. NOTIFICATION OUTBOX DOMAIN
// ==========================================

export const notificationOutbox = pgTable(
  'notification_outbox',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
    channel: varchar('channel', { length: 20 }).notNull(), // 'WHATSAPP' | 'SMS'
    recipient: varchar('recipient', { length: 50 }).notNull(),
    templateKey: varchar('template_key', { length: 50 }),
    payload: jsonb('payload').default({}).notNull(),
    renderedMessage: text('rendered_message').notNull(),
    mediaUrl: text('media_url'),
    status: varchar('status', { length: 20 }).default('PENDING').notNull(), // 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'DEAD_LETTER'
    attempts: integer('attempts').default(0).notNull(),
    maxAttempts: integer('max_attempts').default(3).notNull(),
    lastError: text('last_error'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).defaultNow().notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => ({
    tenantOutboxIdx: index('notification_outbox_tenant_idx').on(table.tenantId),
    statusOutboxIdx: index('notification_outbox_status_idx').on(table.status),
  })
);
