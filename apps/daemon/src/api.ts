import { createServer, type Server } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { eventSchema } from "../../../packages/contracts/src/index.js";

export interface EventSink {
  ingest(event: unknown): { disposition: "accepted" | "duplicate"; sequence: number };
}
const LIMIT = 64 * 1024;
function json(res: import("node:http").ServerResponse, status: number, body: object): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body));
}
function sameToken(header: string | undefined, token: string): boolean {
  const a = Buffer.from(header ?? ""); const b = Buffer.from(`Bearer ${token}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function createApi(token: string, sink: EventSink, shutdown?: () => void): Server {
  const server = createServer((req, res) => {
    const host = req.headers.host ?? "";
    if (!/^127\.0\.0\.1(?::\d+)?$/.test(host) || req.headers.origin) return json(res, 403, { code: "FORBIDDEN", message: "Invalid request origin" });
    if (req.method === "GET" && req.url === "/health") return json(res, 200, { status: "ok", protocolVersion: 1 });
    if (!sameToken(req.headers.authorization, token)) return json(res, 401, { code: "UNAUTHORIZED", message: "Unauthorized" });
    if (req.method === "GET" && req.url === "/v1/identity") return json(res, 200, { pid: process.pid });
    if (req.method === "POST" && req.url === "/v1/shutdown" && shutdown) { json(res, 200, { status: "stopping" }); setImmediate(shutdown); return; }
    if (req.method !== "POST" || req.url !== "/v1/events") return json(res, 404, { code: "NOT_FOUND", message: "Not found" });
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] ?? "")) return json(res, 400, { code: "INVALID_REQUEST", message: "Expected JSON" });
    if (Number(req.headers["content-length"] ?? 0) > LIMIT) { req.resume(); return json(res, 413, { code: "PAYLOAD_TOO_LARGE", message: "Event exceeds limit" }); }
    let size = 0; const chunks: Buffer[] = []; let tooLarge = false;
    req.on("data", (chunk: Buffer) => { size += chunk.length; if (size > LIMIT) { if (!tooLarge) json(res, 413, { code: "PAYLOAD_TOO_LARGE", message: "Event exceeds limit" }); tooLarge = true; } else chunks.push(chunk); });
    req.on("end", () => {
      if (tooLarge) return;
      let body: unknown; try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return json(res, 400, { code: "INVALID_JSON", message: "Invalid JSON" }); }
      const parsed = eventSchema.safeParse(body);
      if (!parsed.success) return json(res, 400, { code: "INVALID_EVENT", message: "Invalid event" });
      try {
        const result = sink.ingest(parsed.data);
        json(res, result.disposition === "accepted" ? 202 : 200, { eventId: parsed.data.eventId, ...result });
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "FORBIDDEN") return json(res, 403, { code, message: "Unauthorized source or project" });
        if (code === "CONFLICT") return json(res, 409, { code, message: "Conflicting event" });
        return json(res, 503, { code: "INGESTION_UNAVAILABLE", message: "Ingestion unavailable" });
      }
    });
    req.on("error", () => { if (!res.headersSent) json(res, 400, { code: "INVALID_REQUEST", message: "Invalid request" }); });
  });
  server.requestTimeout = 5000; server.headersTimeout = 6000; server.maxConnections = 64;
  return server;
}
