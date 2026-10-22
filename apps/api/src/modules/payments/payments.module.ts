import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { DevPaymentGateway } from './adapters/dev-payment.gateway';
import { RazorpayPaymentGateway } from './adapters/razorpay-payment.gateway';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [OrdersModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, DevPaymentGateway, RazorpayPaymentGateway],
  exports: [PaymentsService],
})
export class PaymentsModule {}
