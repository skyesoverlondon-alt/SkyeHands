import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function readInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return parsed;
}

function runtimeBaseDir(config) {
  return path.join(config.rootDir, '.skyequanta', 'workspace-runtime');
}

function workspaceInstanceDir(config, workspaceId) {
  return path.join(config.rootDir, 'workspace', 'instances', workspaceId);
}

function workspaceRuntimeDir(config, workspaceId) {
  return path.join(runtimeBaseDir(config), workspaceId);
}

function workspaceStateFile(config, workspaceId) {
  return path.join(workspaceRuntimeDir(config, workspaceId), 'state.json');
}

function workspaceLogFile(config, workspaceId, role) {
  return path.join(workspaceRuntimeDir(config, workspaceId), `${role}.log`);
}

function isPortOpen(host, port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host, port });
    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function findFreePort(host, startPort, maxPort) {
  let port = startPort;
  while (port <= maxPort) {
    const open = await isPortOpen(host, port);
    if (!open) {
      return port;
    }

    port += 1;
  }

  throw new Error(`No free ports found in range ${startPort}-${maxPort}.`);
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function isPidRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForHealth(url, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Service is still starting.
    }

    await new Promise(resolve => {
      setTimeout(resolve, 250);
    });
  }

  throw new Error(`Timed out waiting for workspace runtime health at ${url}`);
}

function spawnDetachedWorkspaceService(config, options) {
  const outFd = fs.openSync(options.logFile, 'a');
  const args = [
    path.join(config.shellDir, 'bin', 'workspace-service.mjs'),
    '--workspace-id', options.workspaceId,
    '--workspace-name', options.workspaceName,
    '--role', options.role,
    '--port', String(options.port),
    '--root-dir', options.rootDir
  ];

  const child = spawn('node', args, {
    cwd: options.rootDir,
    detached: true,
    stdio: ['ignore', outFd, outFd],
    env: {
      ...process.env,
      SKYEQUANTA_WORKSPACE_ID: options.workspaceId,
      SKYEQUANTA_WORKSPACE_NAME: options.workspaceName,
      SKYEQUANTA_WORKSPACE_ROLE: options.role,
      SKYEQUANTA_WORKSPACE_ROOT: options.rootDir
    }
  });

  child.unref();
  fs.closeSync(outFd);
  return child.pid;
}

function buildServiceUrl(config, port) {
  return `http://${config.host}:${port}`;
}

export function getWorkspaceSandboxPaths(config, workspaceId) {
  const instanceDir = workspaceInstanceDir(config, workspaceId);
  return {
    instanceDir,
    fsDir: path.join(instanceDir, 'fs'),
    homeDir: path.join(instanceDir, 'home'),
    runtimeDir: workspaceRuntimeDir(config, workspaceId),
    stateFile: workspaceStateFile(config, workspaceId)
  };
}

function ensureWorkspaceFilesystem(config, workspace) {
  const paths = getWorkspaceSandboxPaths(config, workspace.id);
  ensureDirectory(paths.instanceDir);
  ensureDirectory(paths.fsDir);
  ensureDirectory(paths.homeDir);
  ensureDirectory(paths.runtimeDir);

  const markerFile = path.join(paths.fsDir, '.skyequanta-workspace.json');
  if (!fs.existsSync(markerFile)) {
    writeJson(markerFile, {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      createdAt: nowIso()
    });
  }

  return paths;
}

export function getWorkspaceRuntimeState(config, workspaceId) {
  const stateFile = workspaceStateFile(config, workspaceId);
  return readJson(stateFile, null);
}

export function getWorkspaceRuntimeStatus(config, workspace) {
  const state = getWorkspaceRuntimeState(config, workspace.id);
  if (!state) {
    return {
      exists: false,
      running: false,
      reason: 'not_provisioned'
    };
  }

  const ideAlive = isPidRunning(state?.processes?.idePid);
  const agentAlive = isPidRunning(state?.processes?.agentPid);
  return {
    exists: true,
    running: ideAlive && agentAlive,
    ideAlive,
    agentAlive,
    idePort: state?.ports?.ide || null,
    agentPort: state?.ports?.agent || null,
    startedAt: state.startedAt || null,
    updatedAt: state.updatedAt || null,
    rootDir: state?.paths?.rootDir || null,
    fsDir: state?.paths?.fsDir || null
  };
}

function getPortRanges() {
  const start = readInteger(process.env.SKYEQUANTA_SANDBOX_PORT_START, 4100);
  const end = readInteger(process.env.SKYEQUANTA_SANDBOX_PORT_END, 5200);
  return {
    start,
    end
  };
}

export async function provisionWorkspaceRuntime(config, workspace) {
  const paths = ensureWorkspaceFilesystem(config, workspace);
  const current = getWorkspaceRuntimeState(config, workspace.id);

  if (current && isPidRunning(current?.processes?.idePid) && isPidRunning(current?.processes?.agentPid)) {
    return {
      state: current,
      created: false
    };
  }

  const { start, end } = getPortRanges();
  const idePort = await findFreePort(config.host, current?.ports?.ide || start, end);
  const agentPort = await findFreePort(config.host, Math.max(idePort + 1, current?.ports?.agent || start), end);

  const ideLog = workspaceLogFile(config, workspace.id, 'ide');
  const agentLog = workspaceLogFile(config, workspace.id, 'agent');
  const idePid = spawnDetachedWorkspaceService(config, {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    role: 'ide',
    port: idePort,
    rootDir: paths.fsDir,
    logFile: ideLog
  });
  const agentPid = spawnDetachedWorkspaceService(config, {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    role: 'agent',
    port: agentPort,
    rootDir: paths.fsDir,
    logFile: agentLog
  });

  const state = {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    driver: 'process-sandbox',
    startedAt: nowIso(),
    updatedAt: nowIso(),
    ports: {
      ide: idePort,
      agent: agentPort
    },
    urls: {
      ide: buildServiceUrl(config, idePort),
      agent: buildServiceUrl(config, agentPort)
    },
    paths: {
      rootDir: paths.instanceDir,
      fsDir: paths.fsDir,
      homeDir: paths.homeDir
    },
    logs: {
      ide: ideLog,
      agent: agentLog
    },
    processes: {
      idePid,
      agentPid
    }
  };

  writeJson(paths.stateFile, state);

  await waitForHealth(`${state.urls.ide}/health`);
  await waitForHealth(`${state.urls.agent}/health`);

  return {
    state,
    created: true
  };
}

function terminatePid(pid, signal) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }

  try {
    process.kill(pid, signal);
  } catch {
    // Already exited.
  }
}

async function waitForPidExit(pid, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isPidRunning(pid)) {
      return;
    }

    await new Promise(resolve => {
      setTimeout(resolve, 100);
    });
  }
}

export async function stopWorkspaceRuntime(config, workspaceId) {
  const state = getWorkspaceRuntimeState(config, workspaceId);
  if (!state) {
    return {
      stopped: false,
      reason: 'not_provisioned'
    };
  }

  const idePid = state?.processes?.idePid;
  const agentPid = state?.processes?.agentPid;

  terminatePid(idePid, 'SIGTERM');
  terminatePid(agentPid, 'SIGTERM');
  await waitForPidExit(idePid);
  await waitForPidExit(agentPid);

  if (isPidRunning(idePid)) {
    terminatePid(idePid, 'SIGKILL');
  }

  if (isPidRunning(agentPid)) {
    terminatePid(agentPid, 'SIGKILL');
  }

  const next = {
    ...state,
    updatedAt: nowIso(),
    stoppedAt: nowIso(),
    processes: {
      idePid: null,
      agentPid: null
    }
  };

  writeJson(workspaceStateFile(config, workspaceId), next);
  return {
    stopped: true,
    state: next
  };
}
