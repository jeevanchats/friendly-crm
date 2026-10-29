import { Module, Global } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DevSmsGateway } from './sms-gateway';
import { Fast2SmsGateway } from './fast2sms-gateway';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, DevSmsGateway, Fast2SmsGateway],
  exports: [AuthService, DevSmsGateway],
})
export class AuthModule {}
