import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ConfigService } from '@nestjs/config';

export const DYNAMODB_DOC_CLIENT = 'DYNAMODB_DOC_CLIENT';
export const DYNAMODB_TABLE = 'DYNAMODB_TABLE';

export const DEFAULT_DYNAMODB_TABLE = 'oficina-execucao';

export function createDynamoDocClient(
  config: Pick<ConfigService, 'get'>,
): DynamoDBDocumentClient {
  const endpoint = config.get<string>('AWS_ENDPOINT_URL');

  const client = new DynamoDBClient({
    region: config.get<string>('AWS_REGION'),
    ...(endpoint ? { endpoint } : {}),
  });

  return DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });
}

export function resolveDynamoTable(config: Pick<ConfigService, 'get'>): string {
  return config.get<string>('DYNAMODB_TABLE') || DEFAULT_DYNAMODB_TABLE;
}
