import { spawnSync } from 'node:child_process';
import path from 'node:path';

function readBoolean(value, fallback) {
  if (value === undefined) {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

export function commandAvailable(command, env) {
  const result = spawnSync('bash', ['-lc', `command -v ${command}`], {
    env,
    stdio: 'ignore'
  });

  return result.status === 0;
}

export function pkgConfigHas(packageName, env) {
  const result = spawnSync('pkg-config', ['--exists', packageName], {
    env,
    stdio: 'ignore'
  });

  return result.status === 0;
}

export function ensurePoetryInstalled(config, env) {
  if (commandAvailable('poetry', env)) {
    return;
  }

  const installer = path.join(config.rootDir, 'scripts', 'install-poetry.sh');
  const result = spawnSync('bash', [installer], {
    cwd: config.rootDir,
    env,
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    throw new Error('Failed to install Poetry.');
  }
}

export function ensureSystemDependencies(config, env) {
  const autoInstall = readBoolean(env.SKYEQUANTA_AUTO_INSTALL_SYSTEM_DEPS, true);
  if (!autoInstall || process.platform !== 'linux') {
    return;
  }

  if (commandAvailable('pkg-config', env) && pkgConfigHas('xkbfile', env)) {
    return;
  }

  if (!commandAvailable('sudo', env) || !commandAvailable('apt-get', env)) {
    return;
  }

  const installer = path.join(config.rootDir, 'scripts', 'setup-ubuntu-deps.sh');
  const result = spawnSync('bash', [installer], {
    cwd: config.rootDir,
    env,
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    throw new Error('Failed to install required system dependencies.');
  }
}