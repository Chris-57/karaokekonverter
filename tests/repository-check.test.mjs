import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { inspectRepository } from '../scripts/check-public-repo.mjs';

const gitAvailable = spawnSync('git', ['--version']).status === 0;
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'karaoke-repo-check-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
function git(root, ...args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, 'fixture Git operation succeeds');
}

test('public repository check accepts empty configuration examples and ignores installed dependencies', async t => {
  const root = await fixture(t);
  await mkdir(join(root, 'docs'));
  await mkdir(join(root, 'node_modules'));
  await writeFile(join(root, 'README.md'), '[Guide](docs/guide.md)\n');
  await writeFile(join(root, 'docs/guide.md'), '# Guide\n');
  await writeFile(join(root, '.env.example'), 'YOUTUBE_API_KEY=\nAPP_ACCESS_CODE=\n');
  await writeFile(join(root, 'node_modules/ignored.log'), 'generated installation file');
  assert.deepEqual((await inspectRepository(root)).issues, []);
});

test('public repository check catches credentials in docs without printing their value and catches broken links', async t => {
  const root = await fixture(t);
  const key = ['AI', 'za', 'A'.repeat(35)].join('');
  await writeFile(join(root, 'README.md'), `Example: ${key}\n[Missing](missing.md)\n`);
  const result = await inspectRepository(root);
  assert.ok(result.issues.some(issue => issue.includes('Google API key')));
  assert.ok(result.issues.some(issue => issue.includes('broken relative link')));
  assert.ok(!JSON.stringify(result).includes(key));
});

test('public repository check catches a staged credential even after the working file is corrected', { skip: !gitAvailable }, async t => {
  const root = await fixture(t);
  const key = ['AI', 'za', 'B'.repeat(35)].join('');
  git(root, 'init', '--quiet');
  await writeFile(join(root, 'README.md'), key);
  git(root, 'add', 'README.md');
  await writeFile(join(root, 'README.md'), '# Corrected working copy\n');
  const result = await inspectRepository(root);
  assert.ok(result.issues.some(issue => issue.includes('Google API key in staged file')));
  assert.ok(!JSON.stringify(result).includes(key));
});

test('public repository check catches a forcibly staged settings file despite gitignore', { skip: !gitAvailable }, async t => {
  const root = await fixture(t);
  git(root, 'init', '--quiet');
  await writeFile(join(root, '.gitignore'), '.env\n');
  await writeFile(join(root, '.env'), 'APP_ACCESS_CODE=fixture-only\n');
  git(root, 'add', '-f', '.env');
  assert.ok((await inspectRepository(root)).issues.some(issue => issue.startsWith('.env: private/generated')));
});
