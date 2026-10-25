import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Headers,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { CrmService } from './crm.service';
import { DashboardService } from './dashboard.service';
import { CustomersService } from './customers.service';
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
} from '@friendly-crm/shared';

@Controller('crm')
@UseGuards(AuthGuard, TenantGuard, PermissionsGuard)
@UseInterceptors(TenantRlsInterceptor, AuditInterceptor)
export class CrmController {
  constructor(
    private readonly crmService: CrmService,
    private readonly dashboardService: DashboardService,
    private readonly customersService: CustomersService,
    private readonly reportsService: ReportsService
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
