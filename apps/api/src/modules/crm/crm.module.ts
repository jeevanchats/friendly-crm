import { Module } from '@nestjs/common';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { DashboardService } from './dashboard.service';
import { CustomersService } from './customers.service';
import { CustomerContactsService } from './customer-contacts.service';
import { ReportsService } from './reports.service';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';

@Module({
  controllers: [CrmController, AttachmentsController],
  providers: [CrmService, DashboardService, CustomersService, CustomerContactsService, ReportsService, AttachmentsService],
  exports: [CrmService, DashboardService, CustomersService, CustomerContactsService, ReportsService, AttachmentsService],
})
export class CrmModule {}
