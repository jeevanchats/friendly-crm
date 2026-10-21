import { Module } from '@nestjs/common';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { DashboardService } from './dashboard.service';
import { CustomersService } from './customers.service';
import { ReportsService } from './reports.service';

@Module({
  controllers: [CrmController],
  providers: [CrmService, DashboardService, CustomersService, ReportsService],
  exports: [CrmService, DashboardService, CustomersService, ReportsService],
})
export class CrmModule {}
