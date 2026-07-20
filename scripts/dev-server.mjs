#!/usr/bin/env node
/**
 * Dev server for the live-HA fast loop.
 *
 * Home Assistant has a Lovelace resource pointing at
 * http://<this-machine>:5173/mosaic-card.js. Serving dist/ here — together with
 * `npm run watch` — means a browser refresh picks up the latest build with no
 * scp/gzip round trip.
 *
 * Two headers matter and are easy to get wrong:
 *  - CORS: HA loads this as a cross-origin ES module, which fails silently
 *    (blank card, CORS error in console) without Access-Control-Allow-Origin.
 *  - no-store: otherwise the browser serves a stale build and the whole point
 *    of the loop is lost.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../dist", import.meta.url)));
const PORT = Number(process.env.PORT ?? 5173);

const MIME = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = createServer(async (req, res) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store, must-revalidate",
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, { ...headers, "Access-Control-Allow-Headers": "*" });
    res.end();
    return;
  }

  // Strip the query string — HA appends cache-busting params like ?hacstag=…
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  // Reject traversal outside dist/ rather than trusting the path.
  const filePath = resolve(join(ROOT, path));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, headers);
    res.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      ...headers,
      "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream",
    });
    res.end(body);
    console.log(`200 ${path}`);
  } catch {
    res.writeHead(404, headers);
    res.end("Not found");
    console.log(`404 ${path}`);
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`mosaic-card dev server → http://0.0.0.0:${PORT} (serving ${ROOT})`);
  console.log("HA resource should point at http://192.168.0.10:5173/mosaic-card.js");
});
