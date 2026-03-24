import path from 'node:path';
import { getInternalUrls, getPublicUrls, getRuntimeContract, withLocalBinPath, getStackConfig } from './config.mjs';
import { spawnManagedProcess, waitForService } from '../lib/process.mjs';
import { ensureRuntimeState, loadShellEnv } from '../lib/runtime.mjs';

function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run'),
    ideOnly: argv.includes('--ide-only'),
    agentOnly: argv.includes('--agent-only')
  };
}

const ideSuppressedOutputPatterns = [
  /\[DEP0040\]/,
  /DeprecationWarning: The `punycode` module is deprecated\./,
  /\[DEP0169\]/,
  /DeprecationWarning: `url\.parse\(\)` behavior is not standardized/,
  /Backend .*took longer than the expected maximum/,
  /Frontend .*took longer than the expected maximum/,
  /Linked preference ".*" not found\./,
  /OS level credential store could not be accessed\./,
  /Failed to retrieve Copilot credentials:/
];

function createProcessSpecs(config, options) {
  const specs = [];
  const internalUrls = getInternalUrls(config);
  const publicUrls = getPublicUrls(config);
  const runtimeContract = getRuntimeContract(config);
  const gateApiBase = `${publicUrls.gateApi}/v1`;
  const gateToken = config.gate.token || '';

  if (!options.ideOnly) {
    specs.push({
      name: 'stack-bridge',
      command: 'node',
      args: ['apps/skyequanta-shell/bin/bridge.mjs'],
      cwd: config.rootDir,
      env: {},
      waitFor: {
        url: `http://${config.bridge.host}:${config.bridge.port}/health`,
        label: 'stack bridge',
        expectedStatus: 200,
        timeoutMs: 30000
      }
    });
  }

  if (!options.ideOnly) {
    const backendArgs = [
      'run',
      'uvicorn',
      'skyequanta_app_server:app',
      '--app-dir',
      config.paths.agentServerAppDir,
      '--host',
      config.agentBackend.host,
      '--port',
      String(config.agentBackend.port)
    ];

    if (config.developmentMode) {
      backendArgs.push(
        '--reload',
        '--reload-dir',
        config.paths.agentServerAppDir,
        '--reload-dir',
        path.join(config.paths.agentCoreDir, 'openhands', 'app_server')
      );
    }

    specs.push({
      name: 'agent-backend',
      command: 'poetry',
      args: backendArgs,
      cwd: config.paths.agentCoreDir,
      env: {
        BACKEND_HOST: config.agentBackend.host,
        BACKEND_PORT: String(config.agentBackend.port),
        PYTHONWARNINGS: 'ignore',
        SKYEQUANTA_GATE_URL: publicUrls.gateApi,
        SKYEQUANTA_GATE_TOKEN: gateToken,
        SKYEQUANTA_OSKEY: gateToken,
        SKYEQUANTA_GATE_MODEL: config.gate.model,
        LLM_BASE_URL: gateApiBase,
        LLM_API_KEY: gateToken,
        LLM_MODEL: config.gate.model,
        LITE_LLM_API_URL: gateApiBase,
        OPENAI_BASE_URL: gateApiBase,
        OPENAI_API_KEY: gateToken,
        ANTHROPIC_API_KEY: '',
        GEMINI_API_KEY: ''
      },
      waitFor: {
        url: `http://${config.agentBackend.host}:${config.agentBackend.port}/health`,
        label: 'agent backend',
        expectedStatus: 200,
        timeoutMs: 120000
      }
    });
  }

  if (!options.agentOnly) {
    specs.push({
      name: 'ide',
      command: 'npm',
      args: ['run', 'start', '--', '--port', String(config.ide.port)],
      cwd: config.paths.ideExampleDir,
      env: {
        NODE_NO_WARNINGS: '1',
        SKYEQUANTA_PUBLIC_ORIGIN: publicUrls.bridge,
        SKYEQUANTA_RUNTIME_CONTRACT_URL: publicUrls.runtimeContract,
        SKYEQUANTA_RUNTIME_CONTRACT_JSON: JSON.stringify(runtimeContract),
        SKYEQUANTA_IDE_INTERNAL_URL: internalUrls.ide,
        SKYEQUANTA_GATE_URL: publicUrls.gateApi,
        SKYEQUANTA_GATE_MODEL: config.gate.model
      },
      suppressedOutputPatterns: ideSuppressedOutputPatterns,
      waitFor: {
        url: `http://${config.ide.host}:${config.ide.port}`,
        label: 'ide',
        expectedStatus: 200,
        timeoutMs: 120000
      }
    });
  }

  return specs;
}

function printStartupSummary(config, specs) {
  const urls = getPublicUrls(config);
  console.log(`Starting ${config.productName}`);
  console.log(`Company: ${config.companyName}`);
  console.log(`AI identity: ${config.aiDisplayName}`);
  specs.forEach(spec => {
    console.log(`- ${spec.name}: ${spec.command} ${spec.args.join(' ')}`);
  });
  console.log(`- web surface: ${urls.ide}`);
  console.log(`- runtime status: ${urls.status}`);
  console.log(`- runtime contract: ${urls.runtimeContract}`);
  console.log(`- product api: ${urls.agentBackend}`);
}

async function main() {
  const baseConfig = getStackConfig();
  const options = parseArgs(process.argv.slice(2));
  ensureRuntimeState(baseConfig, process.env);
  const childEnv = withLocalBinPath(loadShellEnv(baseConfig));
  const config = getStackConfig(childEnv);
  const specs = createProcessSpecs(config, options);

  for (const spec of specs) {
    spec.env = {
      ...childEnv,
      ...spec.env
    };
  }

  if (specs.length === 0) {
    throw new Error('No components selected to launch.');
  }

  printStartupSummary(config, specs);

  if (options.dryRun) {
    return;
  }

  const managed = specs.map(spawnManagedProcess);
  let shuttingDown = false;

  const shutdown = signal => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    for (const processSpec of managed) {
      if (!processSpec.child.killed) {
        processSpec.child.kill(signal);
      }
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await Promise.all(
    managed
      .filter(processSpec => processSpec.waitFor)
      .map(processSpec => waitForService(processSpec.waitFor))
  );

  console.log('All selected services are accepting connections.');

  const firstExit = await Promise.race(
    managed.map(
      processSpec =>
        new Promise(resolve => {
          processSpec.child.once('exit', (code, signal) => {
            resolve({ name: processSpec.name, code, signal });
          });
        })
    )
  );

  if (!shuttingDown) {
    console.error(
      `${firstExit.name} exited ${firstExit.signal ? `via ${firstExit.signal}` : `with code ${firstExit.code ?? 'unknown'}`}`
    );
    shutdown('SIGTERM');
    process.exitCode = firstExit.code ?? 1;
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});