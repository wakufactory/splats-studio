import http.client
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server'))
from server import StudioServer, certificate_names, ensure_certificate


class FakeChat:
    def status(self): return {'available': True, 'ready': False}
    def send(self, request): return {'sessionId': 'test'}
    def poll(self, session): return {'state': 'completed', 'result': {'source': None, 'message': 'ok'}}
    def cancel(self, session): return {'ok': True}
    def reset(self, session): return {'ok': True}
    def login_start(self): return {'url': 'https://auth.openai.com/'}


class ServerTests(unittest.TestCase):
    def start(self, **kwargs):
        server = StudioServer(('127.0.0.1', 0), chat=FakeChat(), **kwargs)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return server

    def request(self, server, path, method='GET', data=None, headers=None):
        headers = headers or {}
        if data is not None:
            data = json.dumps(data)
            headers = {'Content-Type': 'application/json', **headers}
        if server.scheme == 'https':
            # macOS system Python's LibreSSL 2.8 rejects explicitly trusted CA:false
            # leaf certificates. Node verifies the generated server leaf + hostname.
            script = """
const https=require('node:https'),fs=require('node:fs');
const [port,path,method,cert,headers,body]=process.argv.slice(1);
const req=https.request({hostname:'127.0.0.1',port,path,method,
 ca:fs.readFileSync(cert),headers:JSON.parse(headers),agent:false},res=>{
 let data='';res.on('data',chunk=>data+=chunk);res.on('end',()=>
 console.log(JSON.stringify([res.statusCode,data,res.headers])));});
req.on('error',error=>{console.error(error);process.exitCode=1;});req.end(body);
"""
            result = subprocess.check_output(['node', '-e', script, str(server.server_port), path,
                method, str(self.cert), json.dumps(headers), data or ''], text=True)
            code, body, response_headers = json.loads(result)
            return code, body.encode(), response_headers
        conn = http.client.HTTPConnection('127.0.0.1', server.server_port)
        conn.request(method, path, body=data, headers=headers)
        response = conn.getresponse()
        result = response.status, response.read(), dict(response.getheaders())
        conn.close()
        return result

    def test_assets_chat_and_origin_guards(self):
        server = self.start()
        for path in ('/', '/generator.html', '/viewer.html', '/chat.js', '/viewer.js', '/sdf-worker.mjs'):
            self.assertEqual(self.request(server, path)[0], 200, path)
        self.assertIn('javascript', self.request(server, '/chat.js')[2]['Content-type'])
        for path in ('/.certs/server.key', '/%2egit/config', '/%2e%2e/README.md'):
            self.assertEqual(self.request(server, path)[0], 403)
        self.assertEqual(self.request(server, '/server/server.py')[0], 404)
        self.assertEqual(self.request(server, '/bad%zz')[0], 400)
        self.assertEqual(json.loads(self.request(server, '/chat/status')[1])['available'], True)
        self.assertEqual(self.request(server, '/chat/status', headers={'Origin': 'https://evil.example'})[0], 400)
        self.assertEqual(self.request(server, '/chat/status', headers={'Host': f'evil.example:{server.server_port}'})[0], 400)
        for path in ('send', 'poll', 'cancel', 'reset', 'login'):
            self.assertEqual(self.request(server, '/chat/'+path, 'POST', {'sessionId':'test'})[0], 200)
        self.assertEqual(self.request(server, '/chat/send', 'POST', [], {'Origin': 'https://evil.example'})[0], 400)

    def test_https_and_symlink_protection(self):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            self.cert, key = ensure_certificate(work / 'certs', ['DNS:localhost', 'IP:127.0.0.1'])
            self.assertEqual(key.stat().st_mode & 0o777, 0o600)
            original = self.cert.read_bytes()
            ensure_certificate(work / 'certs', ['DNS:localhost', 'IP:127.0.0.1'])
            self.assertEqual(self.cert.read_bytes(), original)
            root = work / 'html';root.mkdir()
            (root/'index.html').write_text('hello')
            (root/'outside').symlink_to(key)
            (root/'empty').mkdir()
            server = self.start(root=root, tls=(self.cert,key))
            plain = self.start(root=root)
            self.assertEqual(self.request(server, '/')[1], self.request(plain, '/')[1])
            self.assertEqual(self.request(server, '/', 'HEAD')[1], b'')
            self.assertEqual(self.request(server, '/outside')[0], 403)
            self.assertEqual(self.request(server, '/empty/')[0], 403)
            server.shutdown();server.server_close()
            plain.shutdown();plain.server_close()
            ensure_certificate(work / 'certs', ['DNS:localhost', 'IP:127.0.0.1', 'DNS:viewer.local'])
            self.assertNotEqual(self.cert.read_bytes(), original)

    def test_invalid_san(self):
        with self.assertRaises(ValueError): certificate_names(['bad\n[extensions]'])
