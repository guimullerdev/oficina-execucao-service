import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ConfigService } from '@nestjs/config';

import {
  DEFAULT_DYNAMODB_TABLE,
  createDynamoDocClient,
  resolveDynamoTable,
} from './dynamodb.client';

jest.mock('@aws-sdk/client-dynamodb');
jest.mock('@aws-sdk/lib-dynamodb');

const configOf = (values: Record<string, string | undefined>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

describe('createDynamoDocClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates DynamoDBClient with region and no endpoint when unset', () => {
    const docClient = {} as DynamoDBDocumentClient;
    (DynamoDBDocumentClient.from as jest.Mock).mockReturnValue(docClient);

    const result = createDynamoDocClient(configOf({ AWS_REGION: 'sa-east-1' }));

    expect(DynamoDBClient).toHaveBeenCalledWith({ region: 'sa-east-1' });
    expect(DynamoDBDocumentClient.from).toHaveBeenCalledWith(
      expect.any(DynamoDBClient),
      { marshallOptions: { removeUndefinedValues: true } },
    );
    expect(result).toBe(docClient);
  });

  it('passes endpoint when AWS_ENDPOINT_URL is set', () => {
    (DynamoDBDocumentClient.from as jest.Mock).mockReturnValue({});

    createDynamoDocClient(
      configOf({
        AWS_REGION: 'us-east-1',
        AWS_ENDPOINT_URL: 'http://localhost:8000',
      }),
    );

    expect(DynamoDBClient).toHaveBeenCalledWith({
      region: 'us-east-1',
      endpoint: 'http://localhost:8000',
    });
  });
});

describe('resolveDynamoTable', () => {
  it('returns DYNAMODB_TABLE when set', () => {
    expect(resolveDynamoTable(configOf({ DYNAMODB_TABLE: 'custom' }))).toBe(
      'custom',
    );
  });

  it('falls back to default table name when unset or empty', () => {
    expect(resolveDynamoTable(configOf({}))).toBe(DEFAULT_DYNAMODB_TABLE);
    expect(resolveDynamoTable(configOf({ DYNAMODB_TABLE: '' }))).toBe(
      'oficina-execucao',
    );
  });
});
