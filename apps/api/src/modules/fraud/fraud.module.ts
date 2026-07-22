import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FraudService } from './fraud.service';
import { FraudController } from './fraud.controller';

@Module({
  imports: [PrismaModule],
  controllers: [FraudController],
  providers: [FraudService],
  exports: [FraudService],
})
export class FraudModule {}

