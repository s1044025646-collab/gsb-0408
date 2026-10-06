/** 基于 node:http 的 JSON API 服务，无外部依赖。 */

import * as http from "node:http";
import { Service } from "./service";

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(data);
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 2 * 1024 * 1024) {
        reject(Object.assign(new Error("请求体过大。"), { code: "PAYLOAD_TOO_LARGE" }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("请求体不是合法 JSON。"), { code: "INVALID_JSON" }));
      }
    });
    req.on("error", reject);
  });
}

export function createServer(service: Service): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;
      const method = req.method ?? "GET";
      const m = (re: RegExp) => path.match(re);

      if (method === "POST" && path === "/analyses") {
        const body = (await readBody(req)) as Record<string, unknown>;
        return send(res, 201, service.analyze(body.sequence));
      }
      if (method === "GET" && path === "/analyses") {
        return send(res, 200, service.list());
      }
      let mm: RegExpMatchArray | null;
      if ((mm = m(/^\/analyses\/(\d+)$/)) && method === "GET") {
        const v = url.searchParams.get("version");
        return send(res, 200, service.getReport(Number(mm[1]), v ? Number(v) : undefined));
      }
      if ((mm = m(/^\/analyses\/(\d+)\/steps$/)) && method === "GET") {
        const v = url.searchParams.get("version");
        return send(res, 200, service.getSteps(Number(mm[1]), v ? Number(v) : undefined));
      }
      if ((mm = m(/^\/analyses\/(\d+)\/append$/)) && method === "POST") {
        const body = (await readBody(req)) as Record<string, unknown>;
        return send(res, 201, service.append(Number(mm[1]), body.bits));
      }
      if ((mm = m(/^\/analyses\/(\d+)\/extend$/)) && method === "POST") {
        const body = (await readBody(req)) as Record<string, unknown>;
        return send(res, 200, service.extend(Number(mm[1]), body.count, body.L, body.C));
      }
      if ((mm = m(/^\/analyses\/(\d+)\/export$/)) && method === "GET") {
        const v = url.searchParams.get("version");
        const report = service.getReport(Number(mm[1]), v ? Number(v) : undefined);
        const steps = service.getSteps(Number(mm[1]), v ? Number(v) : undefined);
        return send(res, 200, { exportedAt: new Date().toISOString(), report, steps });
      }
      if (method === "POST" && path === "/validate") {
        const body = (await readBody(req)) as Record<string, unknown>;
        return send(res, 200, service.validate(body.sequence, body.L, body.C));
      }
      if (method === "POST" && path === "/compare") {
        const body = (await readBody(req)) as Record<string, unknown>;
        return send(res, 200, service.compare(Number(body.a), Number(body.b)));
      }
      if (method === "GET" && path === "/health") {
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: { code: "NOT_FOUND", message: "路由不存在。" } });
    } catch (e) {
      const err = e as Error & { code?: string };
      const code = err.code ?? "INTERNAL_ERROR";
      const status =
        code === "NOT_FOUND" ? 404 : code === "INTERNAL_ERROR" ? 500 : 400;
      return send(res, status, { error: { code, message: err.message } });
    }
  });
}

/** 启动服务；port 为 0 或未提供时由系统分配空闲端口。 */
export function startServer(service: Service, port = 0): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const server = createServer(service);
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const actual = typeof addr === "object" && addr ? addr.port : port;
      resolve({ port: actual, close: () => server.close() });
    });
  });
}
