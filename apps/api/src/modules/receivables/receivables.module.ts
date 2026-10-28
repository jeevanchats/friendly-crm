import { Module } from '@nestjs/common';
import { ReceivablesController } from './receivables.controller';
import { ReceivablesService } from './receivables.service';
import { ReminderScheduler } from './reminder-scheduler.service';

@Module({
  controllers: [ReceivablesController],
  providers: [ReceivablesService, ReminderScheduler],
  exports: [ReceivablesService],
})
export class ReceivablesModule {}
