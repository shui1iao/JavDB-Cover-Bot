import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = mkdtempSync(join(tmpdir(), 'bot-tls-fixtures-'));
after(() => rmSync(directory, { recursive: true, force: true }));
const openssl = (...args) => execFileSync('openssl', args, { cwd: directory, stdio: 'ignore' });
openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '1', '-subj', '/CN=Synthetic Test CA');
for (const name of ['server', 'wrong']) {
  openssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', name + '.key', '-out', name + '.csr', '-subj', '/CN=' + (name === 'server' ? 'localhost' : 'wrong.example.test'));
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(directory, name + '.ext'), 'subjectAltName=' + (name === 'server' ? 'IP:127.0.0.1,DNS:localhost' : 'DNS:wrong.example.test') + '\n');
  openssl('x509', '-req', '-in', name + '.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-set_serial', name === 'server' ? '2' : '3', '-out', name + '.pem', '-days', '1', '-extfile', name + '.ext');
}
const helper = fileURLToPath(new URL('./runtime-probe.mjs', import.meta.url));
function probe(mode) {
  const env = { ...process.env, NODE_EXTRA_CA_CERTS: mode === 'untrusted' ? '' : join(directory, 'ca.pem') };
  delete env.NODE_TLS_REJECT_UNAUTHORIZED;
  const r = spawnSync(process.execPath, [helper, mode, directory], { env, encoding: 'utf8', timeout: 10000 });
  assert.equal(r.status, 0, `Probe ${mode} failed: ${r.stderr}\n${r.stdout}`);
  assert.equal(JSON.parse(r.stdout.trim().split('\n').at(-1)).survived, true);
}
test('provided runtime and npm undici have the reviewed security baseline', () => {
  const sufficient = version => { const [a, b, c] = version.split('.').map(Number); return a > 7 || (a === 7 && (b > 30 || (b === 30 && c >= 1))); };
  assert.ok(sufficient(process.versions.undici || '0.0.0'));
  const npmVersion = JSON.parse(execFileSync(process.execPath, ['-p', 'JSON.stringify(require("undici/package.json").version)'], { encoding: 'utf8' }));
  assert.ok(sufficient(npmVersion));
});
for (const mode of ['encodings', 'renegotiation', 'success', 'http-error', 'timeout', 'untrusted', 'wrong-host']) {
  test(`loopback transport: ${mode}`, () => probe(mode));
}
