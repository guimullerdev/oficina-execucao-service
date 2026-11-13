import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  DYNAMODB_DOC_CLIENT,
  DYNAMODB_TABLE,
  createDynamoDocClient,
  resolveDynamoTable,
} from './dynamodb.client';

@Global()
@Module({
  providers: [
    {
      provide: DYNAMODB_DOC_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => createDynamoDocClient(config),
    },
    {
      provide: DYNAMODB_TABLE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => resolveDynamoTable(config),
    },
  ],
  exports: [DYNAMODB_DOC_CLIENT, DYNAMODB_TABLE],
})
export class DynamodbModule {}
