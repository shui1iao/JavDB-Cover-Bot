// Local Python adapter only. Public metadata, cast and selected cover all come
// from the same immutable wheel that the website imports; no Node scraping.
import { spawn, execFileSync } from 'node:child_process';
import { join } from 'node:path';
const python = () => process.env.CATALOG_PYTHON || '/opt/catalog-venv/bin/python';
export function coreSync(operation, values = []) {
  return JSON.parse(execFileSync(python(), ['-m', 'se_catalog.cli', operation, ...values.map(String)], {
    encoding: 'utf8', timeout: 12000, maxBuffer: 2 * 1024 * 1024,
  }));
}
export async function lookupPublic(code, { hints = [], responses, stateDir = join(process.env.TMP_DIR || './data/tmp', '..', 'catalog-source-state') } = {}) {
  const args = ['-m', 'se_catalog.cli', 'lookup', '--state-dir', stateDir];
  if (responses) args.push('--responses', responses); // explicit offline test adapter, never set by Telegram input
  return await new Promise((resolve, reject) => {
    const child = spawn(python(), args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '', bytes = 0;
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(Error('Catalogue lookup timed out')); }, 135000);
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 16 * 1024 * 1024) { child.kill('SIGKILL'); return; }
      out += chunk;
    });
    child.stderr.on('data', chunk => { if (err.length < 2048) err += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', status => {
      clearTimeout(timer);
      if (status !== 0) return reject(Error('Catalogue lookup failed'));
      try { resolve(JSON.parse(out)); } catch { reject(Error('Invalid catalogue reply')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ code, hints }));
  });
}
