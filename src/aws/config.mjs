import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
const client = new SecretsManagerClient({});
let cached;
let loadedAt = 0;
export async function getConfig() {
  if (cached && Date.now() - loadedAt < 60000) return cached;
  const response = await client.send(new GetSecretValueCommand({ SecretId: process.env.CONFIG_SECRET_ARN }));
  const parsed = JSON.parse(response.SecretString || '{}');
  cached = { ...parsed, MAX_TRACKS: process.env.MAX_TRACKS || '20' };
  loadedAt = Date.now();
  return cached;
}
