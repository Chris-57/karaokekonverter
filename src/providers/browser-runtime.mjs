import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError } from '../domain.mjs';

export async function findLocalBrowser(explicitPath, { platform = process.platform, env = process.env, exists = path => access(path).then(() => true, () => false) } = {}) {
  const candidates = [explicitPath, ...(platform === 'win32' ? [
    env.ProgramFiles && join(env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env['ProgramFiles(x86)'] && join(env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env['ProgramFiles(x86)'] && join(env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    env.ProgramFiles && join(env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ] : platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
  ] : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'])];
  for (const candidate of candidates.filter(Boolean)) if (await exists(candidate)) return candidate;
  return null;
}

export async function launchPlaylistBrowser({ executablePath, headless = true } = {}) {
  const { default: puppeteer } = await import('puppeteer-core');
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const { default: chromium } = await import('@sparticuz/chromium');
    return puppeteer.launch({ args: await puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' }), executablePath: await chromium.executablePath(), headless: 'shell', defaultViewport: { width: 1280, height: 900 }, timeout: 30000, protocolTimeout: 15000 });
  }
  const browserPath = await findLocalBrowser(executablePath);
  if (!browserPath) throw new AppError('BROWSER_NOT_CONFIGURED', 'Chrome or Edge was not found. Install Chrome, run npm.cmd run setup, and restart the app.', 503);
  return puppeteer.launch({ executablePath: browserPath, headless, defaultViewport: { width: 1280, height: 900 }, args: ['--lang=en-US'], timeout: 20000, protocolTimeout: 15000 });
}
