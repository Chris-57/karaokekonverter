import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Import only: these handlers do not run, create jobs or contact AWS/providers.
const root = resolve(import.meta.dirname, '..', '.aws-sam', 'build');
for (const [resource, entry] of [
  ['ApiFunction', 'src/aws/api-handler.mjs'],
  ['WorkerFunction', 'src/aws/worker-handler.mjs'],
  ['AvailabilityFunction', 'handler.mjs'],
]) {
  const filename = resolve(root, resource, entry);
  await access(filename);
  const module = await import(pathToFileURL(filename).href);
  if (typeof module.handler !== 'function') throw new Error(`Missing handler in ${resource}`);
}
for (const entry of [
  'src/providers/spotify-browser.mjs',
  'src/providers/soundcloud-browser.mjs',
  'src/providers/browser-runtime.mjs',
]) await access(resolve(root, 'WorkerFunction', entry));
console.log('All three packaged handlers import; both source readers are present. No live invocation was performed.');
