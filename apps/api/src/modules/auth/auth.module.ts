import { Module, Global } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DevSmsGateway } from './sms-gateway';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, DevSmsGateway],
  exports: [AuthService, DevSmsGateway],
})
export class AuthModule {}
