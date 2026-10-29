import { Module } from '@nestjs/common';
import { DuplicateAdvisorService } from './duplicate-advisor.service';

@Module({
  providers: [DuplicateAdvisorService],
  exports: [DuplicateAdvisorService],
})
export class AiModule {}
