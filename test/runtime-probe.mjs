// Synthetic loopback-only transport probes. Never contact Telegram or providers.
import { createServer as httpServer } from 'node:http';
import { createServer as tlsServer } from 'node:tls';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { constants } from 'node:crypto';
import { requestFallbackTranslation } from '../src/title-translation.js';
const [mode, directory] = process.argv.slice(2);
const cert = name => ({ key: readFileSync(join(directory, name + '.key')), cert: readFileSync(join(directory, name + '.pem')) });
let server, sockets = new Set();
function watch(socket) { sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket)); }
async function listen(s) { server = s; s.on('connection', watch); await new Promise(r => s.listen(0, '127.0.0.1', r)); return s.address().port; }
function finish(data) { for (const s of sockets) s.destroy(); server?.close(); console.log(JSON.stringify({ survived: true, mode, ...data })); setTimeout(() => process.exit(0), 100); }
const deadline = setTimeout(() => { console.error('Probe timed out'); process.exit(4); }, 6000);
try {
  if (mode === 'encodings') {
    const port = await listen(httpServer((req, res) => {
      // Header accepted first, then deliberately short body/early close.
      res.socket.end('HTTP/1.1 200 OK\r\nContent-Encoding: gzip,gzip,gzip,gzip,gzip,gzip\r\nContent-Length: 1\r\nConnection: close\r\n\r\n');
    }));
    let error;
    try { await fetch(`http://127.0.0.1:${port}/`); } catch (e) { error = e; }
    assert.ok(error, 'Excess encodings must be rejected');
    // Allow orphan-stream errors to surface in vulnerable runtimes.
    await new Promise(r => setTimeout(r, 200));
    clearTimeout(deadline); finish({ rejected: true });
  } else if (mode === 'renegotiation') {
    const second = cert('wrong'); let protocol, attempted = false;
    const port = await listen(tlsServer({ ...cert('server'), minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2',
      // Force a full renegotiation so the second certificate is actually checked.
      secureOptions: constants.SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION,
      ALPNProtocols: ['http/1.1'] }, socket => {
      watch(socket); protocol = socket.getProtocol();
      socket.once('data', () => {
        setTimeout(() => {
          socket.setKeyCert(second);
          attempted = socket.renegotiate({ requestCert: false }, () => {});
        }, 50);
      });
    }));
    let error;
    try { await fetch(`https://127.0.0.1:${port}/`); } catch (e) { error = e; }
    assert.equal(protocol, 'TLSv1.2'); assert.ok(attempted); assert.ok(error);
    assert.equal(error.cause?.code, 'ERR_TLS_CERT_ALTNAME_INVALID');
    await new Promise(r => setTimeout(r, 200));
    clearTimeout(deadline); finish({ rejected: true, protocol, attempted, error: error.cause.code });
  } else {
    const wrong = mode === 'wrong-host';
    const port = await listen((await import('node:https')).createServer(wrong ? cert('wrong') : cert('server'), async (req, res) => {
      if (mode === 'timeout') return;
      if (mode === 'http-error') { res.writeHead(503); res.end('Unavailable'); return; }
      if (req.url === '/translator') {
        res.end('<div data-iid="synthetic"></div><script>IG:"synthetic"; params_AbusePreventionHelper = [123,"synthetic-token"];</script>');
      } else {
        let body = ''; for await (const chunk of req) body += chunk;
        assert.equal(new URLSearchParams(body).get('text'), '合成テスト');
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify([{ translations: [{ to: 'zh-Hans', text: '合成中文片名' }] }]));
      }
    }));
    const calls = [];
    const fetchImpl = (url, options) => {
      const parsed = new URL(url); assert.equal(parsed.hostname, 'www.bing.com');
      assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal);
      calls.push(options.method || 'GET');
      return fetch(`https://127.0.0.1:${port}${parsed.pathname}${parsed.search}`, options);
    };
    if (mode === 'success') {
      assert.equal(await requestFallbackTranslation('合成テスト', { fetchImpl }), '合成中文片名');
      assert.deepEqual(calls, ['GET', 'POST']);
    } else {
      let error;
      try { await requestFallbackTranslation('合成テスト', { fetchImpl, timeoutMs: mode === 'timeout' ? 60 : 1000 }); } catch (e) { error = e; }
      assert.ok(error);
      if (mode === 'timeout') assert.equal(error.name, 'TimeoutError');
      if (mode === 'http-error') assert.match(error.message, /503/);
      if (mode === 'wrong-host') assert.equal(error.cause?.code, 'ERR_TLS_CERT_ALTNAME_INVALID');
      if (mode === 'untrusted') assert.ok(['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT'].includes(error.cause?.code));
    }
    clearTimeout(deadline); finish({ calls });
  }
} catch (error) { console.error(error); process.exit(2); }
