import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth/auth.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { CrmModule } from './modules/crm/crm.module';
import { SalesModule } from './modules/sales/sales.module';
import { OrdersModule } from './modules/orders/orders.module';
import { WorkflowModule } from './modules/workflow/workflow.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { HealthModule } from './modules/health/health.module';
import { ReceivablesModule } from './modules/receivables/receivables.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { ProductsModule } from './modules/products/products.module';
import { TeamModule } from './modules/team/team.module';

@Module({
  imports: [
    AuthModule,
    TenantModule,
    CrmModule,
    SalesModule,
    OrdersModule,
    WorkflowModule,
    NotificationsModule,
    HealthModule,
    ReceivablesModule,
    InvoicesModule,
    ProductsModule,
    TeamModule,
  ],
})
export class AppModule {}
