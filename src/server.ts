import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from './db';
import { AppError, parseBits, parseNonNegativeInteger } from './errors';
import {
  appendObservation,
  comparisonPayload,
  createAnalysis,
  describeVersions,
  exportVersion,
  extensionPayload,
  getSteps,
  independentMinimalityCheck,
  requireLatestVersion,
  requireVersion,
  verificationPayload,
} from './service';

const DEFAULT_DB = resolve(process.cwd(), 'data', 'bm.sqlite');

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload, null, 2);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

async function readJson(request: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError('INVALID_JSON', '请求体必须是合法 JSON。', 400);
  }
}

function start(path: string, port = 0): Promise<{ server: Server; port: number }> {
  const db = openDatabase(path);
  const server = createServer((request, response) => {
    route(db, request, response).catch((error: unknown) => {
      if (error instanceof AppError) {
        sendJson(response, error.status, { error: { code: error.code, message: error.message } });
      } else {
        const message = error instanceof Error ? error.message : '未知错误';
        sendJson(response, 500, { error: { code: 'INTERNAL_ERROR', message } });
      }
    });
  });
  return new Promise((resolveListen) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('无法获取监听端口。');
      }
      resolveListen({ server, port: address.port });
    });
  });
}

async function route(db: DatabaseSync, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const pathParts = url.pathname.split('/').filter(Boolean);
  const method = request.method ?? 'GET';

  if (method === 'GET' && url.pathname === '/health') {
    sendJson(response, 200, { ok: true, algorithm: 'berlekamp-massey-gf2' });
    return;
  }

  if (method === 'POST' && url.pathname === '/api/analyses') {
    const body = await readJson(request);
    sendJson(response, 201, createAnalysis(db, body.bits ?? body.sequence));
    return;
  }

  if (method === 'POST' && pathParts[0] === 'api' && pathParts[1] === 'analyses' && pathParts[3] === 'append') {
    const body = await readJson(request);
    sendJson(response, 201, appendObservation(db, pathParts[2], body.additionalBits ?? body.bits));
    return;
  }

  if (method === 'GET' && pathParts[0] === 'api' && pathParts[1] === 'analyses' && pathParts[3] === 'steps') {
    sendJson(response, 200, getSteps(db, pathParts[2], url.searchParams.get('version') ?? 1));
    return;
  }

  if (method === 'GET' && pathParts[0] === 'api' && pathParts[1] === 'analyses' && pathParts[3] === 'compare-prefixes') {
    sendJson(response, 200, comparisonPayload(db, pathParts[2], url.searchParams));
    return;
  }

  if (method === 'GET' && pathParts[0] === 'api' && pathParts[1] === 'analyses' && pathParts[3] === 'export') {
    const version = url.searchParams.get('version');
    sendJson(response, 200, exportVersion(db, pathParts[2], version ?? undefined));
    return;
  }

  if (method === 'GET' && pathParts[0] === 'api' && pathParts[1] === 'analyses' && pathParts.length === 3) {
    const version = url.searchParams.get('version');
    const stored = version === null ? requireLatestVersion(db, pathParts[2]) : requireVersion(db, pathParts[2], version);
    sendJson(response, 200, { ...stored, versions: describeVersions(db, pathParts[2]) });
    return;
  }

  if (method === 'POST' && url.pathname === '/api/verify') {
    sendJson(response, 200, verificationPayload(await readJson(request)));
    return;
  }

  if (method === 'POST' && url.pathname === '/api/extend') {
    sendJson(response, 200, extensionPayload(await readJson(request)));
    return;
  }

  if (method === 'POST' && url.pathname === '/api/check-minimality') {
    const body = await readJson(request);
    const sequence = parseBits(body.sequence ?? body.bits, 'sequence');
    const order = parseNonNegativeInteger(body.order, 'order');
    sendJson(response, 200, independentMinimalityCheck(sequence, order));
    return;
  }

  sendJson(response, 404, { error: { code: 'NOT_FOUND', message: '接口不存在。' } });
}

if (require.main === module) {
  const requestedPort = Number(process.env.PORT ?? '0');
  const port = Number.isInteger(requestedPort) && requestedPort >= 0 && requestedPort <= 65535 ? requestedPort : 0;
  start(process.env.DB_PATH ?? DEFAULT_DB, port).then(({ port: actualPort }) => {
    console.log(`BM GF(2) API: http://127.0.0.1:${actualPort}`);
    console.log(`SQLite: ${process.env.DB_PATH ?? DEFAULT_DB}`);
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export { start };
