import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { createApi } from '../api.mjs';
import { dynamoStore } from './store.mjs';
import { getConfig } from './config.mjs';
import { sourceConfiguration } from '../source-config.mjs';
import { errorType, scopedLog, structuredLog } from '../observability.mjs';
const queue = new SQSClient({});
export function createAwsApiHandler({ store = dynamoStore(process.env.JOBS_TABLE), loadConfig = getConfig, enqueue = id => queue.send(new SendMessageCommand({ QueueUrl: process.env.JOBS_QUEUE_URL, MessageBody: JSON.stringify({ id }) })), log = structuredLog } = {}) {
  return async function handler(event, context = {}) {
    const started = Date.now();
    const requestLog = scopedLog(log, { component: 'api', requestId: context.awsRequestId, apiRequestId: event.requestContext?.requestId });
    let statusCode = 503;
    let code = 'NOT_CONFIGURED';
    const headers = { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
    try {
      const config = await loadConfig();
      const route = createApi({ store, accessCode: config.APP_ACCESS_CODE, ...sourceConfiguration(config), enqueue, log: requestLog });
      const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
      if (Buffer.byteLength(raw) > 4096) { statusCode = 413; code = 'REQUEST_TOO_LARGE'; return { statusCode, headers, body: JSON.stringify({ error: { code, message: 'Request too large.' } }) }; }
      let body;
      try { body = raw ? JSON.parse(raw) : undefined; } catch { statusCode = 400; code = 'INVALID_JSON'; return { statusCode, headers, body: JSON.stringify({ error: { code, message: 'Invalid request JSON.' } }) }; }
      const result = await route({ method: event.requestContext?.http?.method || event.httpMethod, path: event.rawPath || event.path, authorization: event.headers?.authorization || event.headers?.Authorization, body });
      statusCode = result.status; code = result.data?.error?.code || 'NONE';
      return { statusCode, headers, body: JSON.stringify(result.data) };
    } catch (error) {
      requestLog({ event: 'api_configuration_failed', errorType: errorType(error) });
      return { statusCode: 503, headers, body: JSON.stringify({ error: { code: 'NOT_CONFIGURED', message: 'The conversion service is unavailable. Contact the application owner.' } }) };
    } finally {
      requestLog({ event: 'api_request_finished', statusCode, code, elapsedMs: Date.now() - started, operationalFailure: Number(statusCode >= 500) });
    }
  };
}
export const handler = createAwsApiHandler();
