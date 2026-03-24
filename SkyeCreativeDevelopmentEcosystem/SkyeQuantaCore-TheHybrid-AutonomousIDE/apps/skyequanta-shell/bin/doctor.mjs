import fs from 'node:fs';
import { getStackConfig, getPublicSummary, withLocalBinPath } from './config.mjs';
import { ensureRuntimeState, getRuntimePaths, loadShellEnv } from '../lib/runtime.mjs';
import { commandAvailable, pkgConfigHas } from '../lib/system-deps.mjs';
import { ensureDefaultWorkspace } from '../lib/workspace-manager.mjs';
import { getWorkspaceRegistryPath } from '../lib/workspace-registry.mjs';
import { getAuditLogPath, getGovernancePolicyPath } from '../lib/governance-manager.mjs';
import { getSessionStorePath } from '../lib/session-manager.mjs';
import { getSnapshotIndexPath, getSnapshotRetentionPolicyPath, getSnapshotRootDir } from '../lib/snapshot-manager.mjs';
import { getWorkspaceSchedulerPolicyPath, getWorkspaceSchedulerStatePath } from '../lib/workspace-scheduler.mjs';

function checkPath(label, filePath) {
  return {
    label,
    ok: fs.existsSync(filePath),
    detail: filePath
  };
}

function checkCommand(command) {
  return {
    label: `command:${command}`,
    ok: commandAvailable(command, withLocalBinPath()),
    detail: command
  };
}

function checkSystemPackage(label, ok, detail) {
  return {
    label,
    ok,
    detail
  };
}

function checkConfigValue(label, value, detail = value) {
  return {
    label,
    ok: Boolean(String(value || '').trim()),
    detail: String(detail || ''),
    required: true
  };
}

function checkConfigValueWithRequirement(label, value, detail = value, required = true) {
  return {
    label,
    ok: Boolean(String(value || '').trim()),
    detail: String(detail || ''),
    required: Boolean(required)
  };
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function checkNodeVersion() {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10);
  return {
    label: 'node-version',
    ok: Number.isInteger(major) && major >= 22,
    detail: process.versions.node
  };
}

function printResult(result) {
  const prefix = result.ok ? '[ok]' : result.required === false ? '[warn]' : '[fail]';
  console.log(`${prefix} ${result.label}: ${result.detail}`);
}

function main() {
  const baseConfig = getStackConfig();
  ensureRuntimeState(baseConfig, process.env);
  const env = withLocalBinPath(loadShellEnv(baseConfig));
  const config = getStackConfig(env);
  const runtimePaths = getRuntimePaths(config);
  const defaultWorkspaceState = ensureDefaultWorkspace(config);
  const workspaceRegistryPath = getWorkspaceRegistryPath(config);
  const sessionStorePath = getSessionStorePath(config);
  const governancePolicyPath = getGovernancePolicyPath(config);
  const auditLogPath = getAuditLogPath(config);
  const snapshotRootDir = getSnapshotRootDir(config);
  const snapshotIndexPath = getSnapshotIndexPath(config);
  const snapshotRetentionPolicyPath = getSnapshotRetentionPolicyPath(config);
  const workspaceSchedulerPolicyPath = getWorkspaceSchedulerPolicyPath(config);
  const workspaceSchedulerStatePath = getWorkspaceSchedulerStatePath(config);
  const gateRequired = parseBoolean(env.SKYEQUANTA_DOCTOR_REQUIRE_GATE, true);
  const gateTokenRequired = true;
  const results = [
    checkNodeVersion(),
    checkCommand('npm'),
    checkCommand('make'),
    checkCommand('poetry'),
    checkCommand('pkg-config'),
    checkSystemPackage('pkg-config:xkbfile', pkgConfigHas('xkbfile', env), 'xkbfile'),
    checkPath('root', config.rootDir),
    checkPath('agent-core', config.paths.agentCoreDir),
    checkPath('agent-server-app', config.paths.agentServerAppDir),
    checkPath('ide-core', config.paths.ideCoreDir),
    checkPath('ide-browser-example', config.paths.ideExampleDir),
    checkPath('runtime-env', runtimePaths.runtimeEnvFile),
    checkPath('workspace-registry', workspaceRegistryPath),
    checkPath('session-store', sessionStorePath),
    checkPath('governance-policy', governancePolicyPath),
    checkPath('audit-log', auditLogPath),
    checkPath('snapshot-root', snapshotRootDir),
    checkPath('snapshot-index', snapshotIndexPath),
    checkPath('snapshot-retention-policy', snapshotRetentionPolicyPath),
    checkPath('workspace-scheduler-policy', workspaceSchedulerPolicyPath),
    checkPath('workspace-scheduler-state', workspaceSchedulerStatePath),
    checkConfigValue('bridge-admin-token', config.auth?.adminToken || '', config.auth?.adminToken ? '[configured]' : 'missing SKYEQUANTA_ADMIN_TOKEN / OH_SECRET_KEY'),
    checkConfigValue('workspace-default-id', defaultWorkspaceState.workspace?.id || '', defaultWorkspaceState.workspace?.id || 'missing default workspace id'),
    checkPath('agent-config', runtimePaths.agentConfigTarget),
    checkConfigValueWithRequirement(
      'gate-url',
      config.gate.url,
      config.gate.url || 'missing SKYEQUANTA_GATE_URL / OMEGA_GATE_URL',
      gateRequired
    ),
    checkConfigValueWithRequirement(
      'gate-token',
      config.gate.token,
      config.gate.token
        ? '[configured]'
        : 'missing SKYEQUANTA_GATE_TOKEN / SKYEQUANTA_OSKEY',
      gateTokenRequired
    ),
    checkConfigValue('gate-model', config.gate.model, config.gate.model),
    checkPath('ide-config-dir', runtimePaths.ideConfigDir),
    checkPath('ide-config-plugin-dir', runtimePaths.ideConfigPluginsDir),
    checkPath('ide-plugin-dir', runtimePaths.idePluginsDir),
    checkPath('ide-backend-settings', runtimePaths.ideBackendSettingsFile),
    checkPath('ide-cli-entrypoint', config.paths.ideCliEntrypoint),
    checkPath('ide-browser-backend-entrypoint', config.paths.ideBrowserBackendEntrypoint),
    checkPath('ide-webpack-config', config.paths.ideWebpackConfig),
    checkPath('ide-ripgrep-postinstall', config.paths.ideRipgrepPostinstall),
    checkPath('ide-ripgrep-binary', config.paths.ideRipgrepBinary),
    checkPath('ide-keytar-binding', config.paths.ideKeytarBinding),
    checkPath('ide-frontend-index', config.paths.ideFrontendIndexHtml),
    checkPath('ide-frontend-bundle', config.paths.ideFrontendBundle),
    checkPath('ide-editor-worker-bundle', config.paths.ideEditorWorkerBundle),
    checkPath('ide-backend-bundle', config.paths.ideBackendBundle),
    checkPath('ide-node-pty-binding', config.paths.ideNodePtyBinding),
    checkPath('ide-drivelist-binding', config.paths.ideDriveListBinding)
  ];

  console.log(JSON.stringify(getPublicSummary(config), null, 2));
  results.forEach(printResult);

  if (results.some(result => !result.ok && result.required !== false)) {
    process.exitCode = 1;
    return;
  }

  console.log('Doctor checks passed.');
}

main();