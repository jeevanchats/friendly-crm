import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { RefundsService } from './refunds.service';

@Module({
  controllers: [OrdersController],
  providers: [OrdersService, RefundsService],
  exports: [OrdersService, RefundsService],
})
export class OrdersModule {}
