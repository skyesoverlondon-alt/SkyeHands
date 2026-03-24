import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { readEnvFiles } from './dotenv.mjs';

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeFileIfChanged(filePath, contents) {
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === contents) {
    return;
  }

  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, contents, 'utf8');
}

function ensureFile(filePath, contents) {
  if (fs.existsSync(filePath)) {
    return;
  }

  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, contents, 'utf8');
}

function createSecret() {
  return crypto.randomBytes(32).toString('hex');
}

export function getRuntimePaths(config) {
  return {
    runtimeDir: path.join(config.rootDir, '.skyequanta'),
    runtimeEnvFile: path.join(config.rootDir, '.skyequanta', 'runtime.env'),
    workspaceDir: path.join(config.rootDir, 'workspace'),
    cacheDir: path.join(config.rootDir, '.skyequanta', 'cache'),
    fileStoreDir: path.join(config.rootDir, '.skyequanta', 'file-store'),
    ideConfigDir: path.join(config.rootDir, '.skyequanta', 'ide-config'),
    ideConfigPluginsDir: path.join(config.rootDir, '.skyequanta', 'ide-config', 'plugins'),
    idePluginsDir: path.join(config.paths.ideCoreDir, 'plugins'),
    ideDeployedPluginsDir: path.join(config.rootDir, '.skyequanta', 'ide-config', 'deployedPlugins'),
    ideBackendSettingsFile: path.join(config.rootDir, '.skyequanta', 'ide-config', 'backend-settings.json'),
    sessionStoreFile: path.join(config.rootDir, '.skyequanta', 'sessions.json'),
    governancePolicyFile: path.join(config.rootDir, '.skyequanta', 'governance-policy.json'),
    auditLogFile: path.join(config.rootDir, '.skyequanta', 'audit-log.json'),
    snapshotRootDir: path.join(config.rootDir, '.skyequanta', 'snapshots'),
    snapshotIndexFile: path.join(config.rootDir, '.skyequanta', 'workspace-snapshots.json'),
    snapshotRetentionPolicyFile: path.join(config.rootDir, '.skyequanta', 'snapshot-retention.json'),
    workspaceSchedulerPolicyFile: path.join(config.rootDir, '.skyequanta', 'workspace-scheduler-policy.json'),
    workspaceSchedulerStateFile: path.join(config.rootDir, '.skyequanta', 'workspace-scheduler-state.json'),
    agentConfigSource: path.join(config.rootDir, 'config', 'agent', 'config.toml'),
    agentConfigTarget: path.join(config.paths.agentCoreDir, 'config.toml'),
    rootEnvFile: path.join(config.rootDir, '.env'),
    localEnvFile: path.join(config.rootDir, '.env.local')
  };
}

export function ensureRuntimeState(config, baseEnv = process.env) {
  const runtimePaths = getRuntimePaths(config);

  ensureDirectory(runtimePaths.runtimeDir);
  ensureDirectory(runtimePaths.workspaceDir);
  ensureDirectory(runtimePaths.cacheDir);
  ensureDirectory(runtimePaths.fileStoreDir);
  ensureDirectory(runtimePaths.ideConfigDir);
  ensureDirectory(runtimePaths.ideConfigPluginsDir);
  ensureDirectory(runtimePaths.idePluginsDir);
  ensureDirectory(runtimePaths.ideDeployedPluginsDir);
  ensureDirectory(runtimePaths.snapshotRootDir);
  writeFileIfChanged(runtimePaths.ideBackendSettingsFile, '{}\n');
  ensureFile(runtimePaths.sessionStoreFile, '{\n  "version": 1,\n  "sessions": []\n}\n');
  writeFileIfChanged(runtimePaths.governancePolicyFile, JSON.stringify({
    version: 1,
    limits: {
      maxWorkspaces: config.governance?.limits?.maxWorkspaces || 16,
      maxSessions: config.governance?.limits?.maxSessions || 256,
      maxForwardedPortsPerWorkspace: config.governance?.limits?.maxForwardedPortsPerWorkspace || 16,
      maxSnapshotsPerWorkspace: config.governance?.limits?.maxSnapshotsPerWorkspace || 20,
      maxSnapshotBytes: config.governance?.limits?.maxSnapshotBytes || 5 * 1024 * 1024 * 1024,
      maxAuditEvents: config.governance?.limits?.maxAuditEvents || 2000
    }
  }, null, 2) + '\n');
  ensureFile(runtimePaths.auditLogFile, '{\n  "version": 1,\n  "events": []\n}\n');
  ensureFile(runtimePaths.snapshotIndexFile, '{\n  "version": 1,\n  "snapshots": []\n}\n');
  ensureFile(runtimePaths.snapshotRetentionPolicyFile, JSON.stringify({
    version: 1,
    defaults: {
      maxSnapshots: config.governance?.limits?.maxSnapshotsPerWorkspace || 20,
      maxAgeDays: Number.parseInt(String(process.env.SKYEQUANTA_SNAPSHOT_RETENTION_MAX_AGE_DAYS || ''), 10) || 30
    },
    tenants: {},
    workspaces: {}
  }, null, 2) + '\n');
  ensureFile(runtimePaths.workspaceSchedulerPolicyFile, JSON.stringify({
    version: 1,
    enabled: String(process.env.SKYEQUANTA_SCHEDULER_ENABLED || 'true').trim().toLowerCase() !== 'false',
    intervalMs: Number.parseInt(String(process.env.SKYEQUANTA_SCHEDULER_INTERVAL_MS || ''), 10) || 60000,
    healthTimeoutMs: Number.parseInt(String(process.env.SKYEQUANTA_SCHEDULER_HEALTH_TIMEOUT_MS || ''), 10) || 3000,
    maxRestartsPerRun: Number.parseInt(String(process.env.SKYEQUANTA_SCHEDULER_MAX_RESTARTS_PER_RUN || ''), 10) || 3,
    restartCooldownMs: Number.parseInt(String(process.env.SKYEQUANTA_SCHEDULER_RESTART_COOLDOWN_MS || ''), 10) || 300000,
    cleanupExpiredSessions: String(process.env.SKYEQUANTA_SCHEDULER_CLEANUP_EXPIRED_SESSIONS || 'true').trim().toLowerCase() !== 'false',
    retentionCleanupEnabled: String(process.env.SKYEQUANTA_SCHEDULER_RETENTION_CLEANUP_ENABLED || 'true').trim().toLowerCase() !== 'false',
    retentionCleanupEveryRuns: Number.parseInt(String(process.env.SKYEQUANTA_SCHEDULER_RETENTION_CLEANUP_EVERY_RUNS || ''), 10) || 5,
    historyMaxEntries: Number.parseInt(String(process.env.SKYEQUANTA_SCHEDULER_HISTORY_MAX_ENTRIES || ''), 10) || 500
  }, null, 2) + '\n');
  ensureFile(runtimePaths.workspaceSchedulerStateFile, JSON.stringify({
    version: 1,
    running: false,
    lastStartedAt: null,
    lastStoppedAt: null,
    lastRunAt: null,
    lastCompletedAt: null,
    lastRunSummary: null,
    totalRuns: 0,
    totalRemediations: 0,
    totalSessionCleanups: 0,
    totalRetentionCleanups: 0,
    lastError: null,
    history: [],
    workspaces: {}
  }, null, 2) + '\n');

  const sourceConfig = fs.readFileSync(runtimePaths.agentConfigSource, 'utf8');
  writeFileIfChanged(runtimePaths.agentConfigTarget, sourceConfig);

  const fileEnv = readEnvFiles([
    runtimePaths.rootEnvFile,
    runtimePaths.localEnvFile,
    runtimePaths.runtimeEnvFile
  ]);

  if (!baseEnv.OH_SECRET_KEY && !fileEnv.OH_SECRET_KEY) {
    writeFileIfChanged(
      runtimePaths.runtimeEnvFile,
      `OH_SECRET_KEY=${createSecret()}\n`
    );
  }

  return runtimePaths;
}

export function loadShellEnv(config, baseEnv = process.env) {
  const runtimePaths = getRuntimePaths(config);
  const fileEnv = readEnvFiles([
    runtimePaths.rootEnvFile,
    runtimePaths.localEnvFile,
    runtimePaths.runtimeEnvFile
  ]);

  return {
    ...fileEnv,
    THEIA_CONFIG_DIR: runtimePaths.ideConfigDir,
    ...baseEnv
  };
}