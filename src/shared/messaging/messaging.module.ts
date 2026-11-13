import { SNSClient } from '@aws-sdk/client-sns';
import { SQSClient } from '@aws-sdk/client-sqs';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DynamodbModule } from '../dynamodb/dynamodb.module';
import { IdempotentProcessor } from './idempotency/idempotent-processor';
import { OutboxPublisher } from './outbox.publisher';
import { OutboxWriter } from './outbox.writer';

const awsClientConfig = (config: ConfigService) => {
  const endpoint = config.get<string>('AWS_ENDPOINT_URL');
  return {
    region: config.get<string>('AWS_REGION'),
    ...(endpoint ? { endpoint } : {}),
  };
};

@Module({
  imports: [DynamodbModule],
  providers: [
    {
      provide: SNSClient,
      useFactory: (config: ConfigService) =>
        new SNSClient(awsClientConfig(config)),
      inject: [ConfigService],
    },
    {
      provide: SQSClient,
      useFactory: (config: ConfigService) =>
        new SQSClient(awsClientConfig(config)),
      inject: [ConfigService],
    },
    OutboxWriter,
    IdempotentProcessor,
    OutboxPublisher,
    // Added by the consumer task (exactly these two, nothing else):
    // { provide: MessageHandlerRegistry, useFactory: () => new MessageHandlerRegistry() },
    // SqsConsumerService,
  ],
  exports: [OutboxWriter, IdempotentProcessor /* , MessageHandlerRegistry */],
})
export class MessagingModule {}
