import { getStackConfig, getPublicUrls, withLocalBinPath } from './config.mjs';
import { createBridgeServer } from '../lib/bridge.mjs';
import { ensureRuntimeState, loadShellEnv } from '../lib/runtime.mjs';

async function main() {
  const baseConfig = getStackConfig();
  ensureRuntimeState(baseConfig, process.env);
  const env = withLocalBinPath(loadShellEnv(baseConfig));
  const config = getStackConfig(env);
  const server = createBridgeServer(config);
  const urls = getPublicUrls(config);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.bridge.port, config.bridge.host, resolve);
  });

  console.log(`Bridge listening on ${urls.bridge}`);

  const shutdown = signal => {
    server.close(() => {
      process.exit(signal === 'SIGTERM' ? 0 : 130);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});