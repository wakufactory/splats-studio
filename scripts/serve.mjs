// Compatibility entry point; HTTP, HTTPS and chat all run in Python.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const child = spawn('python3', [fileURLToPath(new URL('../server/server.py', import.meta.url)), ...process.argv.slice(2)], { stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
