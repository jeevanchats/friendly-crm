import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  UseGuards,
  UseInterceptors,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { CrmService } from './crm.service';
import { DashboardService } from './dashboard.service';
import { CustomersService } from './customers.service';
import { CustomerContactsService } from './customer-contacts.service';
import { CustomerMergeService } from './customer-merge.service';
import { DuplicateAdvisorService } from '../ai/duplicate-advisor.service';
import { ReportsService } from './reports.service';
import {
  AuthGuard,
  TenantGuard,
  PermissionsGuard,
  RequirePermission,
  TenantRlsInterceptor,
  AuditInterceptor,
  CurrentTenant,
  CurrentUser,
} from '../../common';
import {
  IntakeLeadSchema,
  IntakeLeadDto,
  UpdateLeadStageSchema,
  UpdateLeadStageDto,
  CreateCrmTaskSchema,
  CreateCrmTaskDto,
  LeadFilterQuerySchema,
  LeadFilterQueryDto,
  TenantRole,
  hasPermission,
} from '@friendly-crm/shared';

@Controller('crm')
@UseGuards(AuthGuard, TenantGuard, PermissionsGuard)
@UseInterceptors(TenantRlsInterceptor, AuditInterceptor)
export class CrmController {
  constructor(
    private readonly crmService: CrmService,
    private readonly dashboardService: DashboardService,
    private readonly customersService: CustomersService,
    private readonly reportsService: ReportsService,
    private readonly contactsService: CustomerContactsService,
    private readonly advisor: DuplicateAdvisorService,
    private readonly merger: CustomerMergeService
  ) {}

  /**
   * 1. POST /api/crm/intake-lead
   * Rapid Lead Intake with dynamic Industry Template validation & auto customer matching
   */
  @Post('intake-lead')
  @RequirePermission('lead:create')
  async intakeLead(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string } | undefined,
    @Headers('x-industry-key') industryHeader: string | undefined,
    @Body() rawBody: unknown
  ) {
    // 1. Zod validation for top-level lead intake fields
    const parsed = IntakeLeadSchema.safeParse(rawBody);
    if (!parsed.success) {
      const errorMsg = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
      throw new BadRequestException({
        statusCode: 400,
        error: 'ValidationError',
        message: errorMsg,
      });
    }

    return this.crmService.intakeLead(
      tenant.id,
      parsed.data,
      industryHeader,
      user?.id
    );
  }

  /**
   * 2. GET /api/crm/leads
   * Query leads for tenant with joined customer profiles and filter criteria
   */
  @Get('leads')
  @RequirePermission('lead:view')
  async getLeads(
    @CurrentTenant() tenant: { id: string },
    @Query() rawQuery: unknown
  ) {
    const parsedQuery = LeadFilterQuerySchema.safeParse(rawQuery);
    const filter = parsedQuery.success ? parsedQuery.data : { limit: 50, offset: 0 };

    return this.crmService.getLeads(tenant.id, filter);
  }

  /**
   * 3. PATCH /api/crm/leads/:id/stage
   * Advance or transition lead stage
   */
  @Patch('leads/:id/stage')
  @RequirePermission('lead:update')
  async updateLeadStage(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string } | undefined,
    @Param('id') leadId: string,
    @Body() rawBody: unknown
  ) {
    const parsed = UpdateLeadStageSchema.safeParse(rawBody);
    if (!parsed.success) {
      const errorMsg = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
      throw new BadRequestException({
        statusCode: 400,
        error: 'ValidationError',
        message: errorMsg,
      });
    }

    return this.crmService.updateLeadStage(
      tenant.id,
      leadId,
      parsed.data,
      user?.id
    );
  }

  /**
   * 4. POST /api/crm/tasks
   * Create CRM follow-up task
   */
  @Post('tasks')
  @RequirePermission('task:create')
  async createTask(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string } | undefined,
    @Body() rawBody: unknown
  ) {
    const parsed = CreateCrmTaskSchema.safeParse(rawBody);
    if (!parsed.success) {
      const errorMsg = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
      throw new BadRequestException({
        statusCode: 400,
        error: 'ValidationError',
        message: errorMsg,
      });
    }

    return this.crmService.createTask(
      tenant.id,
      parsed.data,
      user?.id
    );
  }

  /**
   * 5. GET /api/crm/dashboard
   * Home Screen KPIs + Priority Follow-up Queue
   */
  @Get('dashboard')
  @RequirePermission('tenant:read')
  async getDashboard(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string; role?: string } | undefined
  ) {
    const tenantId = tenant.id;
    const userId = user?.id || '';
    const userRole = (user?.role || 'READ_ONLY') as TenantRole;
    return this.dashboardService.getHomeDashboard(tenantId, userId, userRole);
  }

  /**
   * 5b. GET /api/crm/tasks?from=&to=&status=
   * Follow-up calendar: tasks due in the window (defaults to the next 31 days)
   */
  @Get('tasks')
  @RequirePermission('task:view')
  async listTasks(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string; role?: string } | undefined,
    @Query('from') fromRaw?: string,
    @Query('to') toRaw?: string,
    @Query('status') status?: string
  ) {
    const from = fromRaw ? new Date(fromRaw) : new Date();
    const to = toRaw ? new Date(toRaw) : new Date(from.getTime() + 31 * 24 * 60 * 60 * 1000);
    if (Number.isNaN(+from) || Number.isNaN(+to) || to <= from) {
      throw new BadRequestException('from and to must be valid dates, with to after from.');
    }
    if (to.getTime() - from.getTime() > 95 * 24 * 60 * 60 * 1000) {
      throw new BadRequestException('Ask for at most 95 days at a time.');
    }
    const wanted = status?.toUpperCase();
    if (wanted && !['PENDING', 'COMPLETED', 'CANCELLED'].includes(wanted)) {
      throw new BadRequestException('status must be PENDING, COMPLETED or CANCELLED.');
    }
    return this.dashboardService.listTasks(
      tenant.id,
      user?.id || '',
      (user?.role || 'READ_ONLY') as TenantRole,
      { from, to, status: wanted as 'PENDING' | 'COMPLETED' | 'CANCELLED' | undefined }
    );
  }

  /**
   * 6. PATCH /api/crm/tasks/:id/complete
   * 1-Tap Complete Task with outcome note & real-time KPI update
   */
  @Patch('tasks/:id/complete')
  @RequirePermission('task:complete')
  async completeTask(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string } | undefined,
    @Param('id') taskId: string,
    @Body() body: { outcomeNote?: string; nextFollowUpAt?: string }
  ) {
    const tenantId = tenant.id;
    const userId = user?.id || '';
    return this.dashboardService.completeFollowUpTask(
      tenantId,
      userId,
      taskId,
      body?.outcomeNote || 'Spoke with customer',
      body?.nextFollowUpAt
    );
  }

  /**
   * 7. GET /api/crm/activities
   * Query recent audit activities for tenant
   */
  @Get('activities')
  @RequirePermission('audit:read')
  async getActivities(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string; role?: string } | undefined
  ) {
    const userRole = (user?.role || 'READ_ONLY') as TenantRole;
    return this.dashboardService.getActivities(tenant.id, userRole);
  }

  /**
   * 7b. GET /api/crm/audit-logs
   * Query durable append-only audit records with redacted changes
   */
  @Get('audit-logs')
  @RequirePermission('audit:read')
  async getAuditLogs(
    @CurrentTenant() tenant: { id: string },
    @Query('entityType') entityType?: string
  ) {
    return this.dashboardService.getAuditLogs(tenant.id, entityType);
  }

  /**
   * 8. GET /api/crm/customers
   * List all customers with computed active orders and outstanding ledger receivables
   */
  @Get('customers')
  @RequirePermission('customer:view')
  async listCustomers(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string; role?: string } | undefined,
    @Query('search') search?: string
  ) {
    const userRole = (user?.role || 'READ_ONLY') as TenantRole;
    return this.customersService.listCustomers(tenant.id, search, userRole);
  }

  /**
   * GET /api/crm/customers/lookup?phone=
   * Is this mobile number already a customer? Used by Quick Add to fill the name from the master record.
   */
  @Get('customers/lookup')
  @RequirePermission('lead:create')
  async lookupCustomer(@CurrentTenant() tenant: { id: string }, @Query('phone') phone?: string) {
    return this.crmService.lookupCustomerByPhone(tenant.id, String(phone ?? ''));
  }

  /**
   * GET /api/crm/customers/similar?name=&companyName=&gstin=&phone=
   * Customers that look like the one being typed (same GSTIN, same or near-identical name). A warning aid for the
   * Add customer form: it never blocks, the person decides.
   */
  @Get('customers/similar')
  @RequirePermission('customer:view')
  async similarCustomers(
    @CurrentTenant() tenant: { id: string },
    @Query('name') name?: string,
    @Query('companyName') companyName?: string,
    @Query('gstin') gstin?: string,
    @Query('phone') phone?: string
  ) {
    return { ...(await this.customersService.findSimilar(tenant.id, { name, companyName, gstin, phone })), ai: this.advisor.available() };
  }

  /**
   * POST /api/crm/customers/similar/review { name, companyName?, gstin?, phone? }
   * An AI second opinion on the customers the plain checks found (same / different / unsure, with a reason). It only
   * advises. The server finds the candidates itself; it sends names and the GST state, never phone numbers or addresses.
   */
  @Post('customers/similar/review')
  @RequirePermission('customer:view')
  async reviewSimilarCustomers(
    @CurrentTenant() tenant: { id: string },
    @Body() body: { name?: string; companyName?: string; gstin?: string; phone?: string }
  ) {
    const { matches } = await this.customersService.findSimilar(tenant.id, body ?? {});
    const state = (g?: string | null) => (g && /^\d{2}/.test(g.trim()) ? g.trim().slice(0, 2) : null);
    const verdicts = await this.advisor.review(
      tenant.id,
      'customer',
      { name: body?.name ?? null, companyName: body?.companyName ?? null, gstState: state(body?.gstin) },
      matches.map((m) => ({ id: m.id, fields: { name: m.name, companyName: m.companyName, gstState: state(m.gstin) } }))
    );
    return { matches: matches.map((m) => ({ ...m, ...(verdicts.find((v) => v.id === m.id) ?? {}) })) };
  }

  /**
   * 9. GET /api/crm/customers/:id
   * Complete Customer 360 profile view: details, orders, quotations, ledger & timeline
   */
  @Get('customers/:id')
  @RequirePermission('customer:view')
  async getCustomer360(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string; role?: string } | undefined,
    @Param('id') customerId: string
  ) {
    const userRole = (user?.role || 'READ_ONLY') as TenantRole;
    return this.customersService.getCustomer360(tenant.id, userRole, customerId);
  }

  /** GET /api/crm/customers/:id/contacts : the people who deal with us for this customer (besides its primary phone). */
  @Get('customers/:id/contacts')
  @RequirePermission('customer:view')
  listContacts(@CurrentTenant() tenant: { id: string }, @Param('id') customerId: string) {
    return this.contactsService.list(tenant.id, customerId).then((data) => ({ data }));
  }

  /** POST /api/crm/customers/:id/contacts { name, phone, designation?, email? } : 409 if the number is already someone's. */
  @Post('customers/:id/contacts')
  @RequirePermission('customer:create')
  addContact(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string } | undefined,
    @Param('id') customerId: string,
    @Body() body: Record<string, unknown>
  ) {
    return this.contactsService.create(tenant.id, user?.id ?? null, customerId, body ?? {});
  }

  /** PATCH /api/crm/customers/:id/contacts/:contactId : change any of name, phone, designation, email. */
  @Patch('customers/:id/contacts/:contactId')
  @RequirePermission('customer:update')
  updateContact(
    @CurrentTenant() tenant: { id: string },
    @Param('id') customerId: string,
    @Param('contactId') contactId: string,
    @Body() body: Record<string, unknown>
  ) {
    return this.contactsService.update(tenant.id, customerId, contactId, body ?? {});
  }

  /** DELETE /api/crm/customers/:id/contacts/:contactId */
  @Delete('customers/:id/contacts/:contactId')
  @RequirePermission('customer:update')
  removeContact(@CurrentTenant() tenant: { id: string }, @Param('id') customerId: string, @Param('contactId') contactId: string) {
    return this.contactsService.remove(tenant.id, customerId, contactId);
  }

  /**
   * POST /api/crm/customers/:id/merge { fromId }
   * Folds the duplicate customer `fromId` into the customer in the path: its enquiries, quotes, orders, invoices, payments
   * and contacts move across, its phone numbers become contacts, and it is removed. 409 if the GSTINs differ.
   */
  @Post('customers/:id/merge')
  @RequirePermission('customer:delete')
  mergeCustomers(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string } | undefined,
    @Param('id') keepId: string,
    @Body() body: { fromId?: string }
  ) {
    return this.merger.merge(tenant.id, user?.id ?? null, keepId, String(body?.fromId ?? ''));
  }

  /**
   * POST /api/crm/customers
   * Add one customer (no enquiry or task is created). 409 when the phone number is already a customer.
   * Bringing in an opening balance needs the payment permission.
   */
  @Post('customers')
  @RequirePermission('customer:create')
  async createCustomer(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string; role?: string } | undefined,
    @Body() body: Record<string, unknown>
  ) {
    const role = (user?.role || 'READ_ONLY') as TenantRole;
    const row: Record<string, unknown> = { ...body, state: body?.state ?? body?.stateCode };
    if (String(row.openingBalance ?? '').trim() !== '' && !hasPermission(role, 'payment:create')) {
      throw new ForbiddenException('Your role cannot set an opening balance.');
    }
    return this.customersService.createCustomer(tenant.id, user?.id ?? null, row);
  }

  /**
   * POST /api/crm/customers/import { rows, dryRun?, onDuplicate? }
   * Bulk-add customers from a parsed sheet. dryRun defaults to TRUE: nothing is written until the caller sends
   * dryRun: false after reviewing the preview.
   */
  @Post('customers/import')
  @RequirePermission('customer:create')
  async importCustomers(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string; role?: string } | undefined,
    @Body() body: { rows?: unknown; dryRun?: boolean; onDuplicate?: string }
  ) {
    const role = (user?.role || 'READ_ONLY') as TenantRole;
    const rows = body?.rows;
    if (
      Array.isArray(rows) &&
      !hasPermission(role, 'payment:create') &&
      rows.some((r) => r && typeof r === 'object' && String((r as any).openingBalance ?? '').trim() !== '')
    ) {
      throw new ForbiddenException('Your role cannot import opening balances. Remove that column or ask the owner.');
    }
    return this.customersService.importCustomers(tenant.id, user?.id ?? null, rows, {
      dryRun: body?.dryRun !== false,
      onDuplicate: body?.onDuplicate === 'update' ? 'update' : 'skip',
    });
  }
  /**
   * PATCH /api/crm/customers/:id/billing
   * GSTIN, billing address, GST state and company name: what a GST invoice needs about the buyer.
   */
  @Patch('customers/:id/billing')
  @RequirePermission('customer:update')
  async updateCustomerBilling(
    @CurrentTenant() tenant: { id: string },
    @Param('id') customerId: string,
    @Body()
    body: {
      gstin?: string | null;
      billingAddress?: string | null;
      stateCode?: string | null;
      companyName?: string | null;
      remindersOptOut?: boolean;
    }
  ) {
    return this.customersService.updateBillingDetails(tenant.id, customerId, {
      gstin: body?.gstin,
      billingAddress: body?.billingAddress,
      stateCode: body?.stateCode,
      companyName: body?.companyName,
      remindersOptOut: body?.remindersOptOut,
    });
  }

  /**
   * 10. GET /api/crm/reports
   * Executive Business Insights: Conversion Funnel, Pending Collections, Repeat Opportunities
   * Guarded by 'report:view' permission
   */
  @Get('reports')
  @RequirePermission('report:view')
  async getReports(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string; role?: string } | undefined
  ) {
    const userRole = (user?.role || 'READ_ONLY') as TenantRole;
    return this.reportsService.getBusinessInsights(tenant.id, userRole);
  }
}
