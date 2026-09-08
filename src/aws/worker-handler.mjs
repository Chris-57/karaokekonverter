import { dynamoStore } from './store.mjs';
import { getConfig } from './config.mjs';
import { convertJob } from '../conversion.mjs';
import { runtimeOptions } from '../runtime.mjs';
import { errorType, scopedLog, structuredLog } from '../observability.mjs';
export function createAwsWorkerHandler({ store = dynamoStore(process.env.JOBS_TABLE), loadConfig = getConfig, buildRuntime = runtimeOptions, log = structuredLog } = {}) {
  let options;
  let previousConfig;
  return async function handler(event, context = {}) {
    const failed = [];
    for (const record of event.Records || []) {
      const recordLog = scopedLog(log, { component: 'worker', requestId: context.awsRequestId, messageId: record.messageId, receiveCount: Number(record.attributes?.ApproximateReceiveCount || 1) });
      let id;
      try {
        ({ id } = JSON.parse(record.body));
        if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) { id = undefined; throw new Error('Invalid job message'); }
        const config = await loadConfig();
        const signature = JSON.stringify(config);
        if (signature !== previousConfig) { options = buildRuntime(config); previousConfig = signature; }
        await convertJob(id, { store, ...options, log: recordLog });
      } catch (error) {
        recordLog({ event: 'worker_infrastructure_failed', jobId: id, errorType: errorType(error), code: 'WORKER_INFRASTRUCTURE', operationalFailure: 1 });
        failed.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures: failed };
  };
}
export const handler = createAwsWorkerHandler();
