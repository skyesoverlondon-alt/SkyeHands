import path from 'node:path';
import fs from 'node:fs';

import { getStackConfig, withLocalBinPath } from './config.mjs';
import { runStep } from '../lib/process.mjs';
import { ensureRuntimeState, loadShellEnv } from '../lib/runtime.mjs';

function parseArgs(argv) {
  const command = argv.find(arg => !arg.startsWith('--')) || 'build';
  const targetArg = argv.find(arg => arg.startsWith('--target='));

  return {
    command,
    target: targetArg ? targetArg.split('=')[1] : 'all',
    mode: argv.includes('--production') ? 'production' : 'development',
    skipInstall: argv.includes('--skip-install'),
    skipCompile: argv.includes('--skip-compile'),
    skipNativeRebuild: argv.includes('--skip-native-rebuild'),
    skipGenerate: argv.includes('--skip-generate'),
    skipPrepare: argv.includes('--skip-prepare')
  };
}

const bundleTargets = {
  frontend: ['frontend-main', 'frontend-worker', 'frontend-secondary'],
  backend: ['backend'],
  all: ['frontend-main', 'frontend-worker', 'frontend-secondary', 'backend']
};

function createEnv() {
  const baseConfig = getStackConfig();
  ensureRuntimeState(baseConfig, process.env);
  return withLocalBinPath(loadShellEnv(baseConfig));
}

async function repairRipgrep(config, env) {
  await runStep(
    'IDE ripgrep payload repair',
    'node',
    [config.paths.ideRipgrepPostinstall],
    config.paths.ideCoreDir,
    env
  );
}

async function prepareIde(config, env, options) {
  if (!options.skipInstall) {
    await runStep(
      'IDE dependency install',
      'npm',
      ['install'],
      config.paths.ideCoreDir,
      env
    );
  }

  await repairRipgrep(config, env);

  if (!options.skipCompile) {
    await runStep(
      'IDE compile',
      'npm',
      ['run', 'compile'],
      config.paths.ideCoreDir,
      env
    );
  }

  if (!options.skipNativeRebuild) {
    await runStep(
      'IDE native rebuild',
      'npm',
      ['rebuild', 'node-pty', 'drivelist', 'nsfw', 'native-keymap', 'keytar'],
      config.paths.ideCoreDir,
      env
    );
  }

  if (!options.skipGenerate) {
    await runStep(
      'IDE browser app generation',
      'npx',
      ['theiaext', 'build'],
      config.paths.ideExampleDir,
      env
    );
  }
}

async function bundleIdeTarget(config, env, mode, target) {
  const webpackCli = path.join(config.paths.ideCoreDir, 'node_modules', 'webpack', 'bin', 'webpack.js');
  const configNames = bundleTargets[target] || [target];
  const bundleEnv = {
    ...env,
    SKYEQUANTA_LIGHT_BUNDLE: '1'
  };

  if (configNames.length === 1 && configNames[0] === target && !bundleTargets[target]) {
    const knownConfigNames = bundleTargets.all;
    if (!knownConfigNames.includes(target)) {
      throw new Error(`Unknown IDE bundle target: ${target}`);
    }
  }

  for (const configName of configNames) {
    await runStep(
      `IDE ${configName} webpack bundle`,
      'node',
      [webpackCli, '--config', 'webpack.config.js', '--mode', mode, '--config-name', configName],
      config.paths.ideExampleDir,
      bundleEnv
    );
  }
}

function verifyArtifact(label, filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing IDE artifact: ${label} at ${filePath}`);
  }
}

function verifyIdeArtifacts(config, target) {
  const verifiers = {
    frontend: () => {
      verifyArtifact('frontend index', config.paths.ideFrontendIndexHtml);
      verifyArtifact('secondary window bundle', config.paths.ideFrontendBundle);
      verifyArtifact('editor worker bundle', config.paths.ideEditorWorkerBundle);
    },
    backend: () => {
      verifyArtifact('backend main bundle', config.paths.ideBackendBundle);
    },
    all: () => {
      verifiers.frontend();
      verifiers.backend();
    }
  };

  if (!verifiers[target]) {
    throw new Error(`Unknown IDE verify target: ${target}`);
  }

  verifiers[target]();
  console.log(`IDE artifact verification passed for target: ${target}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const env = createEnv();
  const config = getStackConfig(env);

  if (options.command === 'repair') {
    await repairRipgrep(config, env);
    return;
  }

  if (options.command === 'prepare') {
    await prepareIde(config, env, options);
    return;
  }

  if (options.command === 'bundle') {
    await bundleIdeTarget(config, env, options.mode, options.target);
    return;
  }

  if (options.command === 'verify') {
    verifyIdeArtifacts(config, options.target);
    return;
  }

  if (!options.skipPrepare) {
    await prepareIde(config, env, options);
  }

  await bundleIdeTarget(config, env, options.mode, options.target);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});