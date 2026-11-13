import { Test } from '@nestjs/testing';

import { AppModule } from './app.module';
import { MessageHandlerRegistry } from './shared/messaging/handlers/message-handler.registry';
import { IdempotentProcessor } from './shared/messaging/idempotency/idempotent-processor';
import { OutboxPublisher } from './shared/messaging/outbox.publisher';

describe('AppModule', () => {
  const previous = { ...process.env };

  beforeEach(() => {
    process.env.AWS_REGION = 'us-east-1';
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env = { ...previous };
  });

  it('imports the messaging module', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    await moduleRef.init();

    expect(moduleRef.get(IdempotentProcessor, { strict: false })).toBeDefined();
    expect(moduleRef.get(OutboxPublisher, { strict: false })).toBeDefined();

    expect(
      moduleRef
        .get(MessageHandlerRegistry, { strict: false })
        .has('os.execucao.solicitada'),
    ).toBe(true);

    await moduleRef.close();
  });
});
