import { SNSClient } from '@aws-sdk/client-sns';
import { SQSClient } from '@aws-sdk/client-sqs';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { MessageHandlerRegistry } from './handlers/message-handler.registry';
import { IdempotentProcessor } from './idempotency/idempotent-processor';
import { MessagingModule } from './messaging.module';
import { OutboxPublisher } from './outbox.publisher';
import { OutboxWriter } from './outbox.writer';

const TOPIC = 'arn:aws:sns:us-east-1:000000000000:oficina-execucao-events';

describe('MessagingModule', () => {
  const previous = { ...process.env };

  beforeEach(() => {
    process.env.AWS_REGION = 'us-east-1';
    process.env.NODE_ENV = 'test';
    process.env.SNS_TOPIC_ARN = TOPIC;
    delete process.env.AWS_ENDPOINT_URL;
  });

  afterEach(() => {
    process.env = { ...previous };
  });

  const build = () =>
    Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        MessagingModule,
      ],
    }).compile();

  it('wires the messaging providers', async () => {
    const moduleRef = await build();
    await moduleRef.init();

    expect(moduleRef.get(IdempotentProcessor)).toBeInstanceOf(
      IdempotentProcessor,
    );
    expect(moduleRef.get(OutboxWriter)).toBeInstanceOf(OutboxWriter);
    expect(moduleRef.get(OutboxPublisher)).toBeInstanceOf(OutboxPublisher);
    expect(moduleRef.get(MessageHandlerRegistry)).toBeInstanceOf(
      MessageHandlerRegistry,
    );
    expect(moduleRef.get(SNSClient)).toBeInstanceOf(SNSClient);
    expect(moduleRef.get(SQSClient)).toBeInstanceOf(SQSClient);

    await moduleRef.close();
  });

  it('compiles with a custom AWS endpoint', async () => {
    process.env.AWS_ENDPOINT_URL = 'http://localhost:4566';

    const moduleRef = await build();
    await moduleRef.init();

    expect(moduleRef.get(SNSClient)).toBeInstanceOf(SNSClient);

    await moduleRef.close();
  });
});
