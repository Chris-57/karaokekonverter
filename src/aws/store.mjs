import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

export function dynamoStore(tableName, client = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } })) {
  return {
    async create(job) { await client.send(new PutCommand({ TableName: tableName, Item: job, ConditionExpression: 'attribute_not_exists(id)' })); },
    async get(id) { return (await client.send(new GetCommand({ TableName: tableName, Key: { id }, ConsistentRead: true }))).Item; },
    async claim(id) {
      const now = Date.now();
      try {
        await client.send(new UpdateCommand({ TableName: tableName, Key: { id }, UpdateExpression: 'SET #status = :running, leaseUntil = :lease, updatedAt = :now', ConditionExpression: 'attribute_exists(id) AND expiresAt > :epoch AND (#status = :queued OR (#status = :running AND leaseUntil < :now))', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':running': 'RUNNING', ':queued': 'QUEUED', ':lease': now + 900000, ':now': now, ':epoch': Math.floor(now / 1000) } }));
        return true;
      } catch (error) { if (error.name === 'ConditionalCheckFailedException') return false; throw error; }
    },
    async update(id, patch) {
      const entries = Object.entries({ ...patch, updatedAt: Date.now() }).filter(([, value]) => value !== undefined);
      await client.send(new UpdateCommand({ TableName: tableName, Key: { id }, UpdateExpression: 'SET ' + entries.map((_, i) => `#k${i} = :v${i}`).join(', '), ConditionExpression: 'attribute_exists(id)', ExpressionAttributeNames: Object.fromEntries(entries.map(([key], i) => [`#k${i}`, key])), ExpressionAttributeValues: Object.fromEntries(entries.map(([, value], i) => [`:v${i}`, value])) }));
    }
  };
}
