import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const options = {
    workspaceId: null,
    workspaceName: null,
    role: null,
    port: null,
    rootDir: process.cwd()
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--workspace-id') {
      options.workspaceId = argv[index + 1] || null;
      index += 1;
      continue;
    }

    if (value === '--workspace-name') {
      options.workspaceName = argv[index + 1] || null;
      index += 1;
      continue;
    }

    if (value === '--role') {
      options.role = argv[index + 1] || null;
      index += 1;
      continue;
    }

    if (value === '--port') {
      options.port = Number.parseInt(argv[index + 1], 10);
      index += 1;
      continue;
    }

    if (value === '--root-dir') {
      options.rootDir = path.resolve(argv[index + 1] || process.cwd());
      index += 1;
      continue;
    }
  }

  if (!options.workspaceId) {
    throw new Error('workspace-id is required');
  }

  if (!options.workspaceName) {
    options.workspaceName = options.workspaceId;
  }

  if (!options.role || !['ide', 'agent'].includes(options.role)) {
    throw new Error('role must be one of: ide, agent');
  }

  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error('port must be a valid integer in range 1-65535');
  }

  return options;
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(payload));
}

function listRootEntries(rootDir) {
  try {
    return fs.readdirSync(rootDir).slice(0, 50);
  } catch {
    return [];
  }
}

function writeIdeRoot(response, context) {
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8'
  });

  response.end(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${context.workspaceName} isolated runtime</title>
  </head>
  <body>
    <h1>${context.workspaceName}</h1>
    <p>Workspace ID: ${context.workspaceId}</p>
    <p>Role: ${context.role}</p>
    <p>Root: ${context.rootDir}</p>
    <p>Port: ${context.port}</p>
  </body>
</html>`);
}

function createServer(context) {
  return http.createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');

    if (url.pathname === '/health') {
      writeJson(response, 200, {
        status: 'ok',
        workspaceId: context.workspaceId,
        workspaceName: context.workspaceName,
        role: context.role,
        rootDir: context.rootDir,
        pid: process.pid,
        now: new Date().toISOString()
      });
      return;
    }

    if (context.role === 'agent' && (url.pathname === '/' || url.pathname === '/docs')) {
      writeJson(response, 200, {
        ok: true,
        service: 'workspace-agent',
        workspaceId: context.workspaceId,
        workspaceName: context.workspaceName,
        rootDir: context.rootDir,
        entries: listRootEntries(context.rootDir)
      });
      return;
    }

    if (context.role === 'agent' && url.pathname.startsWith('/api/')) {
      writeJson(response, 200, {
        ok: true,
        service: 'workspace-agent',
        route: url.pathname,
        workspaceId: context.workspaceId,
        method: request.method,
        rootDir: context.rootDir
      });
      return;
    }

    if (context.role === 'ide' && url.pathname === '/') {
      writeIdeRoot(response, context);
      return;
    }

    if (context.role === 'ide' && url.pathname === '/api/files') {
      writeJson(response, 200, {
        ok: true,
        service: 'workspace-ide',
        workspaceId: context.workspaceId,
        rootDir: context.rootDir,
        entries: listRootEntries(context.rootDir)
      });
      return;
    }

    writeJson(response, 404, {
      ok: false,
      error: 'not_found',
      route: url.pathname,
      workspaceId: context.workspaceId,
      role: context.role
    });
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  process.chdir(args.rootDir);

  const context = {
    workspaceId: args.workspaceId,
    workspaceName: args.workspaceName,
    role: args.role,
    rootDir: args.rootDir,
    port: args.port
  };

  const server = createServer(context);
  server.listen(args.port, '127.0.0.1', () => {
    console.log(
      JSON.stringify({
        event: 'workspace_service_started',
        workspaceId: context.workspaceId,
        role: context.role,
        port: context.port,
        rootDir: context.rootDir,
        pid: process.pid
      })
    );
  });

  const shutdown = signal => {
    console.log(JSON.stringify({ event: 'workspace_service_stopping', workspaceId: context.workspaceId, role: context.role, signal }));
    server.close(() => {
      process.exit(0);
    });

    setTimeout(() => {
      process.exit(0);
    }, 2000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
