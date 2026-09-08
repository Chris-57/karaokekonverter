import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const files = [];
async function walk(directory) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    if (entry.name === '__pycache__') continue;
    const name = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(name);
    else files.push(name);
  }
}
for (const directory of ['src', 'local', 'dist', 'tests', 'scripts', 'monitoring']) await walk(directory);
for (const file of files.filter(name => /\.(?:js|mjs)$/.test(name))) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Syntax check failed: ${file}\n${result.stderr}`);
}
for (const file of files) {
  const content = await readFile(path.join(root, file), 'utf8');
  if (/AIza[0-9A-Za-z_-]{35}|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(content)) throw new Error(`Potential embedded credential in ${file}; review before sharing.`);
}
console.log(`Syntax and common embedded-credential checks passed for ${files.length} source, interface, and test files. This is not an exhaustive secret audit.`);
