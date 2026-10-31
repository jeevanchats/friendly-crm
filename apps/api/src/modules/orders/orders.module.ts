import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { RefundsService } from './refunds.service';
import { AdvanceCreditService } from './advance-credit.service';

@Module({
  controllers: [OrdersController],
  providers: [OrdersService, RefundsService, AdvanceCreditService],
  exports: [OrdersService, RefundsService, AdvanceCreditService],
})
export class OrdersModule {}
