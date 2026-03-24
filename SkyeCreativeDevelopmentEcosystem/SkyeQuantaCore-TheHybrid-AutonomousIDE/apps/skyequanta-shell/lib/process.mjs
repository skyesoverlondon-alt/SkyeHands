import net from 'node:net';
import { spawn } from 'node:child_process';

function createOutputForwarder(stream, target, suppressedOutputPatterns = []) {
  let pending = '';

  const flushLine = line => {
    if (suppressedOutputPatterns.some(pattern => pattern.test(line))) {
      return;
    }

    target.write(`${line}\n`);
  };

  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    lines.forEach(flushLine);
  });

  stream.on('end', () => {
    if (pending.length > 0) {
      flushLine(pending);
      pending = '';
    }
  });
}

function delay(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

export function runStep(label, command, args, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: 'inherit'
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      if (signal) {
        reject(new Error(`${label} failed with signal ${signal}`));
        return;
      }

      reject(new Error(`${label} failed with exit code ${code ?? 'unknown'}`));
    });
  });
}

export function waitForPort(host, port, label, timeoutMs = 90000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.createConnection({ host, port });

      socket.once('connect', () => {
        socket.end();
        resolve();
      });

      socket.once('error', () => {
        socket.destroy();

        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`Timed out waiting for ${label} on ${host}:${port}`));
          return;
        }

        setTimeout(tryConnect, 1000);
      });
    };

    tryConnect();
  });
}

export async function waitForHttp(url, label, timeoutMs = 90000, expectedStatus = 200) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, {
        redirect: 'manual'
      });

      if (response.status === expectedStatus) {
        return;
      }
    } catch {
      // Service is still starting.
    }

    await delay(1000);
  }

  throw new Error(`Timed out waiting for ${label} at ${url}`);
}

export async function waitForService(waitFor) {
  if (waitFor.url) {
    await waitForHttp(waitFor.url, waitFor.label, waitFor.timeoutMs, waitFor.expectedStatus);
    return;
  }

  await waitForPort(waitFor.host, waitFor.port, waitFor.label, waitFor.timeoutMs);
}

export function spawnManagedProcess(spec) {
  const shouldFilterOutput = Array.isArray(spec.suppressedOutputPatterns) && spec.suppressedOutputPatterns.length > 0;
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: shouldFilterOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });

  if (shouldFilterOutput) {
    createOutputForwarder(child.stdout, process.stdout, spec.suppressedOutputPatterns);
    createOutputForwarder(child.stderr, process.stderr, spec.suppressedOutputPatterns);
  }

  return { ...spec, child };
}