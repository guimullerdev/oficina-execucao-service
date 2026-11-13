import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { DYNAMODB_DOC_CLIENT, DYNAMODB_TABLE } from './dynamodb.client';
import { DynamodbModule } from './dynamodb.module';

describe('DynamodbModule', () => {
  const previous = { ...process.env };

  beforeEach(() => {
    process.env.AWS_REGION = 'us-east-1';
    process.env.AWS_ENDPOINT_URL = 'http://localhost:8000';
    process.env.DYNAMODB_TABLE = 'tabela-teste';
  });

  afterEach(() => {
    process.env = { ...previous };
  });

  it('provides and exports the doc client and table name', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        DynamodbModule,
      ],
    }).compile();

    expect(moduleRef.get(DYNAMODB_DOC_CLIENT)).toBeDefined();
    expect(moduleRef.get(DYNAMODB_TABLE)).toBe('tabela-teste');
  });
});
