import { readdir, readFile, lstat, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skippedDirectories = new Set(['.git', 'node_modules', '.aws-sam', '__pycache__', '.venv', 'venv', '.pytest_cache', '.npm', 'npm-cache', 'build', 'coverage', '.data']);
const patterns = [
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/g],
  ['AWS access key', /(?:AKIA|ASIA)[0-9A-Z]{16}/g],
  ['GitHub token', /(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{60,255})/g],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g],
  ['account-specific ARN', /arn:aws(?:-us-gov|-cn)?:[a-z0-9-]+:[a-z0-9-]*:(?!000000000000)[0-9]{12}:/g],
];

function git(root, args) {
  return spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
}

function privatePath(filename) {
  const parts = filename.split('/');
  const base = parts.at(-1);
  return (base.startsWith('.env') && base !== '.env.example')
    || ['config.json', 'samconfig.toml', '.npmrc'].includes(base)
    || /\.(?:pem|key|zip|tgz|log|pyc)$/i.test(base)
    || /^monitoring-test.*\.json$/.test(base)
    || parts.some(part => skippedDirectories.has(part) || part === '.aws')
    || filename.startsWith('docs/evidence/private/');
}

async function walk(root, directory = '') {
  const files = [];
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const filename = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory() && (skippedDirectories.has(entry.name) || filename === 'docs/evidence/private')) continue;
    if (entry.isDirectory()) files.push(...await walk(root, filename));
    else files.push(filename);
  }
  return files;
}

export async function inspectRepository(root) {
  root = path.resolve(root);
  const top = git(root, ['rev-parse', '--show-toplevel']);
  const inRepository = top.status === 0 && path.resolve(top.stdout.trim()) === root;
  let files;
  if (inRepository) {
    const list = git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
    if (list.status !== 0) throw new Error('Could not list repository files.');
    files = [...new Set(list.stdout.split('\0').filter(Boolean))];
  } else files = await walk(root);

  const issues = [];
  for (const filename of files.sort()) {
    if (privatePath(filename)) { issues.push(`${filename}: private/generated file must not be published`); continue; }
    const absolute = path.resolve(root, filename);
    if (!absolute.startsWith(root + path.sep)) { issues.push(`${filename}: path leaves repository`); continue; }
    let info;
    try { info = await lstat(absolute); } catch { issues.push(`${filename}: missing working file`); continue; }
    if (!info.isFile() || info.isSymbolicLink()) { issues.push(`${filename}: only regular files are accepted`); continue; }
    if (info.size > 2 * 1024 * 1024) { issues.push(`${filename}: exceeds the 2 MiB source-file review limit`); continue; }
    // Images/PDFs need a separate visual review; text scanning cannot inspect them.
    if (/\.(?:png|jpe?g|gif|webp|pdf|ico)$/i.test(filename)) continue;
    const content = await readFile(absolute, 'utf8');
    const versions = [['working file', content]];
    if (inRepository) {
      const staged = git(root, ['show', `:${filename}`]);
      if (staged.status === 0 && staged.stdout !== content) versions.push(['staged file', staged.stdout]);
    }
    for (const [location, text] of versions) {
      for (const [label, pattern] of patterns) {
        pattern.lastIndex = 0;
        const match = pattern.exec(text);
        if (match) issues.push(`${filename}:${text.slice(0, match.index).split('\n').length}: ${label} in ${location}`);
      }
      if (/\/(?:workspace\/scratch|workspace\/sites)\//.test(text)) issues.push(`${filename}: private workspace path in ${location}`);
    }
    if (/\.md$/i.test(filename)) {
      const prose = content.replace(/```[^\n]*\n[\s\S]*?```/g, '');
      for (const match of prose.matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
        const target = match[1];
        if (/^(?:https?:|mailto:|#)/i.test(target)) continue;
        if (/^[a-z][a-z0-9+.-]*:/i.test(target)) { issues.push(`${filename}: non-public link scheme`); continue; }
        let relative;
        try { relative = decodeURIComponent(target.split('#')[0]); } catch { issues.push(`${filename}: malformed relative link`); continue; }
        if (!relative) continue;
        const destination = path.resolve(path.dirname(absolute), relative);
        if (!destination.startsWith(root + path.sep)) { issues.push(`${filename}: relative link leaves repository`); continue; }
        try { await access(destination); } catch { issues.push(`${filename}: broken relative link to ${relative}`); }
      }
    }
  }
  return { checkedFiles: files.length, issues: [...new Set(issues)] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] || path.resolve(import.meta.dirname, '..');
  try {
    const result = await inspectRepository(root);
    if (result.issues.length) {
      console.error(result.issues.join('\n'));
      process.exitCode = 1;
    } else console.log(`Public repository checks passed for ${result.checkedFiles} files. Checks cover common credentials, private paths, staged content and local Markdown links; they are not an exhaustive security or history audit.`);
  } catch {
    console.error('Public repository check could not complete. Verify Git and filesystem access.');
    process.exitCode = 1;
  }
}
