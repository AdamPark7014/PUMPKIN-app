import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ResaleController } from './resale.controller';
import { ResaleService } from './resale.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ResaleController],
  providers: [ResaleService],
  exports: [ResaleService],
})
export class ResaleModule {}
