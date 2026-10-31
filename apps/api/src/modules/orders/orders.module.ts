import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { CustomerAdvanceController } from './customer-advance.controller';
import { OrdersService } from './orders.service';
import { RefundsService } from './refunds.service';
import { AdvanceCreditService } from './advance-credit.service';
import { CreditTransferService } from './credit-transfer.service';

@Module({
  controllers: [OrdersController, CustomerAdvanceController],
  providers: [OrdersService, RefundsService, AdvanceCreditService, CreditTransferService],
  exports: [OrdersService, RefundsService, AdvanceCreditService, CreditTransferService],
})
export class OrdersModule {}
