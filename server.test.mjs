import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { X509Certificate } from 'node:crypto';
import { certificateNames, createStaticServer, ensureCertificate, startServers } from './scripts/serve.mjs';

function request(server, path, { tls, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const req = (tls ? httpsRequest : httpRequest)({
      hostname: '127.0.0.1', port: server.address().port, path, method,
      ca: tls?.cert, agent: false,
      // No client certificate or key: the server must not require them.
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
      response.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

test('Node HTTP and HTTPS serve viewer assets and protect private files', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'gs-server-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const root = join(folder, 'site');
  await mkdir(join(root, 'assets'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<title>SDF Splat Studio</title>');
  await writeFile(join(root, 'app.js'), 'export const ok = true;');
  const ply = Buffer.from('ply\nformat binary_little_endian 1.0\nend_header\n');
  await writeFile(join(root, 'sample.ply'), ply);
  await writeFile(join(folder, 'outside.txt'), 'private');
  await symlink(join(folder, 'outside.txt'), join(root, 'outside-link'));
  const certDir = join(root, '.certs');
  const names = ['DNS:localhost', 'IP:127.0.0.1'];
  const tls = await ensureCertificate(certDir, names);
  const parsed = new X509Certificate(tls.cert);
  assert.ok(parsed.checkHost('localhost'));
  assert.ok(parsed.checkIP('127.0.0.1'));
  assert.equal((await stat(join(certDir, 'server.key'))).mode & 0o777, 0o600);
  const reused = await ensureCertificate(certDir, names);
  assert.deepEqual(reused.cert, tls.cert);
  assert.deepEqual(reused.key, tls.key);

  await t.test('HTTP and HTTPS serve the same files simultaneously', async () => {
    const servers = await startServers({ root, bind: '127.0.0.1',
      listeners: [{ port: 0, tls }, { port: 0 }] });
    try {
      const [secure, plain] = await Promise.all([
        request(servers[0], '/sample.ply', { tls }), request(servers[1], '/sample.ply'),
      ]);
      assert.equal(secure.status, 200);
      assert.equal(plain.status, 200);
      assert.deepEqual(secure.body, plain.body);
      // If the second port is occupied, the first listener must be closed again.
      const conflicting = await createStaticServer({ root });
      await new Promise(resolve => conflicting.listen(0, '127.0.0.1', resolve));
      const releasedPort = conflicting.address().port;
      await new Promise(resolve => conflicting.close(resolve));
      await assert.rejects(startServers({ root, bind: '127.0.0.1', listeners: [
        { port: releasedPort, tls }, { port: servers[1].address().port },
      ] }), { code: 'EADDRINUSE' });
      await new Promise((resolve, reject) => {
        conflicting.once('error', reject);
        conflicting.listen(releasedPort, '127.0.0.1', resolve);
      });
      await new Promise(resolve => conflicting.close(resolve));
    } finally {
      await Promise.all(servers.map(server => new Promise(resolve => {
        server.close(resolve); server.closeAllConnections();
      })));
    }
  });

  for (const secure of [false, true]) await t.test(secure ? 'HTTPS without client certificate' : 'HTTP', async () => {
    const options = secure ? { tls } : {};
    const server = await createStaticServer({ root, ...options });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      const page = await request(server, '/?url=./sample.ply', options);
      assert.equal(page.status, 200);
      assert.equal(page.body.toString(), '<title>SDF Splat Studio</title>');
      const script = await request(server, '/app.js', options);
      assert.match(script.headers['content-type'], /javascript/);
      const model = await request(server, '/sample.ply', options);
      assert.equal(model.headers['content-type'], 'application/octet-stream');
      assert.deepEqual(model.body, ply);
      const head = await request(server, '/sample.ply', { ...options, method: 'HEAD' });
      assert.equal(head.status, 200);
      assert.equal(head.body.length, 0);
      assert.equal(head.headers['content-length'], String(ply.length));
      for (const path of ['/.certs/server.key', '/%2ecerts/server.key', '/assets/', '/outside-link', '/%2e%2e/outside.txt']) {
        assert.equal((await request(server, path, options)).status, 403, path);
      }
      assert.equal((await request(server, '/missing.ply', options)).status, 404);
      assert.equal((await request(server, '/bad%zz', options)).status, 400);
      assert.equal((await request(server, '/', { ...options, method: 'POST' })).status, 405);
    } finally {
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    }
  });
  // Changing the requested hostnames must regenerate the server certificate.
  const updated = await ensureCertificate(certDir, [...names, 'DNS:viewer.local']);
  assert.ok(new X509Certificate(updated.cert).checkHost('viewer.local'));
  assert.notDeepEqual(updated.cert, tls.cert);
  assert.deepEqual(await readFile(join(certDir, 'server.crt')), updated.cert);
});

test('default document root serves the studio, modules and workers without exposing hidden files', async () => {
  const server = await createStaticServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    for (const path of ['/', '/viewer.html', '/generator.html', '/file-viewer.js', '/viewer.js', '/viewer-xr.mjs', '/xr-gestures.mjs', '/viewer.css', '/sdf.mjs', '/sdf-worker.mjs', '/sog-worker.mjs', '/splat-resources.mjs', '/render-watchdog.mjs']) {
      assert.equal((await request(server, path)).status, 200, path);
    }
    const worker = await request(server, '/sog-worker.mjs');
    assert.match(worker.headers['content-type'], /javascript/);
    for (const path of ['/.git/config', '/.certs/server.key', '/%2egit/config', '/scripts/']) {
      assert.equal((await request(server, path)).status, 403, path);
    }
  } finally {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
});

test('additional SAN names are validated before writing OpenSSL configuration', () => {
  const names = certificateNames(['viewer.local', '192.168.1.10']);
  assert.ok(names.includes('DNS:viewer.local'));
  assert.ok(names.includes('IP:192.168.1.10'));
  assert.throws(() => certificateNames(['bad\n[extensions]']), /Invalid certificate hostname/);
});
