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
@UseGuards(TenantGuard, PermissionsGuard)
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
  async getDashboard(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string; role?: string } | undefined
  ) {
    const tenantId = tenant?.id || 't-demo-printing';
    const userId = user?.id || 'u-demo-1';
    const userRole = (user?.role || 'OWNER') as TenantRole;
    return this.dashboardService.getHomeDashboard(tenantId, userId, userRole);
  }

  /**
   * 6. PATCH /api/crm/tasks/:id/complete
   * 1-Tap Complete Task with outcome note & real-time KPI update
   */
  @Patch('tasks/:id/complete')
  async completeTask(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string } | undefined,
    @Param('id') taskId: string,
    @Body() body: { outcomeNote?: string; nextFollowUpAt?: string }
  ) {
    const tenantId = tenant?.id || 't-demo-printing';
    const userId = user?.id || 'u-demo-1';
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
  async getActivities(@CurrentTenant() tenant: { id: string }) {
    const tenantId = tenant?.id || 't-demo-printing';
    return this.dashboardService.getActivities(tenantId);
  }

  /**
   * 8. GET /api/crm/customers
   * List all customers with computed active orders and outstanding ledger receivables
   */
  @Get('customers')
  async listCustomers(
    @CurrentTenant() tenant: { id: string },
    @Query('search') search?: string
  ) {
    const tenantId = tenant?.id || 't-demo-printing';
    return this.customersService.listCustomers(tenantId, search);
  }

  /**
   * 9. GET /api/crm/customers/:id
   * Complete Customer 360 profile view: details, orders, quotations, ledger & timeline
   */
  @Get('customers/:id')
  async getCustomer360(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string; role?: string } | undefined,
    @Param('id') customerId: string
  ) {
    const tenantId = tenant?.id || 't-demo-printing';
    const userRole = (user?.role || 'OWNER') as TenantRole;
    return this.customersService.getCustomer360(tenantId, userRole, customerId);
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
    @CurrentUser() user: { id: string; role?: string } | undefined,
    @Headers('x-user-role') roleHeader?: string
  ) {
    const tenantId = tenant?.id || 't-demo-printing';
    const userRole = (user?.role || roleHeader || 'OWNER') as TenantRole;
    return this.reportsService.getBusinessInsights(tenantId, userRole);
  }
}
