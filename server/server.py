"""Static HTTP/HTTPS hosting with optional CAD-derived GPT chat endpoints."""
from __future__ import annotations

import argparse
import functools
import ipaddress
import json
from pathlib import Path
import re
import signal
import socket
import ssl
import subprocess
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

from codex_bridge import ChatBridge

ROOT = Path(__file__).resolve().parents[1]


def certificate_names(extra=()):
    names = {'localhost', '127.0.0.1', '::1', socket.gethostname(), *extra}
    try:
        names.update(item[4][0].split('%')[0] for item in socket.getaddrinfo(socket.gethostname(), None))
    except OSError:
        pass
    # Include LAN interfaces, even when the hostname resolves only to loopback.
    for command in (['ifconfig'], ['ip', '-o', 'addr']):
        try:
            output = subprocess.check_output(command, text=True, stderr=subprocess.DEVNULL)
            names.update(re.findall(r'\binet6?\s+([\da-fA-F:.]+)', output))
            break
        except (OSError, subprocess.CalledProcessError):
            pass
    result = []
    for name in sorted(names):
        try:
            result.append('IP:' + str(ipaddress.ip_address(name)))
        except ValueError:
            if not re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?', name):
                raise ValueError(f'Invalid certificate hostname: {name}')
            result.append('DNS:' + name)
    return result


def ensure_certificate(directory, names):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    directory.chmod(0o700)
    cert, key, metadata = (directory / name for name in ('server.crt', 'server.key', 'names.json'))
    try:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(cert, key)
        valid = subprocess.run(['openssl', 'x509', '-checkend', '86400', '-noout', '-in', str(cert)],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
        if json.loads(metadata.read_text()) == names and valid:
            key.chmod(0o600)
            return cert, key
    except (OSError, ValueError, ssl.SSLError):
        pass
    with tempfile.TemporaryDirectory(dir=directory) as temporary:
        work = Path(temporary)
        config = work / 'openssl.cnf'
        config.write_text('[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=extensions\n'
                          '[dn]\nCN=SDF Splat Studio local development\n[extensions]\n'
                          'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\n'
                          'extendedKeyUsage=serverAuth\nsubjectAltName=' + ','.join(names) + '\n')
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '365',
                        '-config', str(config), '-keyout', str(work / 'key'), '-out', str(work / 'cert')],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        (work / 'key').chmod(0o600)
        (work / 'key').replace(key)
        (work / 'cert').replace(cert)
        metadata.write_text(json.dumps(names))
    return cert, key


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript',
                      '.mjs': 'text/javascript', '.wasm': 'application/wasm'}

    def _json(self, code, value):
        data = json.dumps(value).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def _check_origin(self):
        host = self.headers.get('Host', '')
        name, sep, port = host.rpartition(':')
        if not sep or port != str(self.server.server_port):
            raise ValueError('Invalid Host header')
        bind = self.server.server_address[0]
        if name == 'localhost':
            valid = bind in ('127.0.0.1', '0.0.0.0')
        else:
            try:
                address = ipaddress.IPv4Address(name)
                valid = (name == bind or (bind == '0.0.0.0' and
                         (address.is_private or address.is_loopback or address.is_link_local) and
                         not (address.is_unspecified or address.is_multicast or address.is_reserved)))
            except ValueError:
                valid = False
        if not valid:
            raise ValueError('Invalid Host header')
        origin = self.headers.get('Origin')
        if origin and origin != f'{self.server.scheme}://{host}':
            raise ValueError('Cross-origin requests are not allowed')

    def do_GET(self):
        if self.path == '/chat/status':
            try:
                self._check_origin()
                self._json(200, self.server.chat.status())
            except Exception as exc:
                self._json(400, {'error': str(exc)})
            return
        super().do_GET()

    def send_head(self):
        try:
            raw = urlsplit(self.path).path
            if re.search(r'%(?![0-9a-fA-F]{2})', raw):
                self.send_error(400, 'Invalid path')
                return
            # Reject hidden/traversal segments before normalization, and symlinks outside html.
            raw = unquote(raw, errors='strict').replace('\\', '/')
            if '\x00' in raw or any(part.startswith('.') for part in raw.split('/') if part):
                self.send_error(403)
                return
            root = Path(self.directory).resolve()
            path = Path(self.translate_path(self.path)).resolve()
            if not path.is_relative_to(root) or any(part.startswith('.') for part in path.relative_to(root).parts):
                self.send_error(403)
                return
            if path.is_dir():
                index = path / 'index.html'
                if (not index.resolve().is_relative_to(root) or not index.is_file() or
                    any(part.startswith('.') for part in index.resolve().relative_to(root).parts)):
                    self.send_error(403, 'Directory listing disabled')
                    return
        except (ValueError, UnicodeError):
            self.send_error(400)
            return
        return super().send_head()

    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def do_POST(self):
        paths = {'/chat/login', '/chat/send', '/chat/poll', '/chat/cancel', '/chat/reset'}
        if self.path not in paths:
            self.send_error(404)
            return
        try:
            self._check_origin()
            if self.headers.get('Content-Type', '').split(';')[0].strip() != 'application/json':
                raise ValueError('Content-Type must be application/json')
            length = int(self.headers.get('Content-Length', '0'))
            limit = 24_000_000 if self.path == '/chat/send' else 250_000
            if not 1 <= length <= limit:
                raise ValueError('Invalid request length')
            request = json.loads(self.rfile.read(length))
            if not isinstance(request, dict):
                raise ValueError('JSON object required')
            chat = self.server.chat
            if self.path == '/chat/login':
                result = chat.login_start()
            elif self.path == '/chat/send':
                result = chat.send(request)
            else:
                session = request.get('sessionId')
                if not isinstance(session, str):
                    raise ValueError('sessionId is required')
                result = {'/chat/poll': chat.poll, '/chat/cancel': chat.cancel, '/chat/reset': chat.reset}[self.path](session)
            self._json(200, result)
        except Exception as exc:
            self._json(400, {'error': str(exc)})


class StudioServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, *, root=ROOT / 'html', chat=None, tls=None):
        self.chat = chat if chat is not None else ChatBridge()
        self.scheme = 'https' if tls else 'http'
        super().__init__(address, functools.partial(Handler, directory=str(root)))
        if tls:
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.minimum_version = ssl.TLSVersion.TLSv1_2
            context.load_cert_chain(*tls)
            self.socket = context.wrap_socket(self.socket, server_side=True, do_handshake_on_connect=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8443)
    parser.add_argument('--http-port', type=int, default=8080)
    parser.add_argument('--bind', '--host', default='0.0.0.0')
    parser.add_argument('--http', action='store_true')
    parser.add_argument('--san', action='append', default=[])
    parser.add_argument('--chat-log', action='store_true')
    args = parser.parse_args()
    if not all(1 <= port <= 65535 for port in ([args.port] if args.http else [args.port, args.http_port])):
        parser.error('Ports must be between 1 and 65535')
    if not args.http and args.port == args.http_port:
        parser.error('HTTPS and HTTP must use different ports')
    names = certificate_names(args.san)
    tls = None if args.http else ensure_certificate(ROOT / '.certs', names)
    chat = ChatBridge(log=True if args.chat_log else None)
    servers = []
    serving = []
    try:
        for port, certificate in ([(args.port, None)] if args.http else [(args.port, tls), (args.http_port, None)]):
            server = StudioServer((args.bind, port), tls=certificate, chat=chat)
            servers.append(server)
        for server in servers:
            threading.Thread(target=server.serve_forever, daemon=True).start()
            serving.append(server)
            print(f'SDF Splat Studio: {server.scheme}://localhost:{server.server_port}', flush=True)
            for name in names:
                if name.startswith('IP:') and ':' not in name[3:] and not name.startswith('IP:127.'):
                    print(f'LAN: {server.scheme}://{name[3:]}:{server.server_port}', flush=True)
        stop = threading.Event()
        for sig in (signal.SIGINT, signal.SIGTERM):
            signal.signal(sig, lambda *_: stop.set())
        stop.wait()
    finally:
        for server in serving:
            server.shutdown()
        for server in servers:
            server.server_close()
        chat.close()


if __name__ == '__main__':
    main()
