/*
 * Leadership Boards server.
 *
 * Serves the report pages in public/ and proxies read-only GraphQL queries to
 * monday.com, so the monday API token stays on the server. Viewers sign in
 * with a shared team password.
 *
 * Environment:
 *   MONDAY_API_TOKEN   monday.com API token (required)
 *   REPORT_PASSWORD    team password for the site (required)
 *   SESSION_SECRET     secret used to sign sign-in cookies (required, long random string)
 *   PORT               port to listen on (default 3000)
 *   HOST               address to listen on (default 127.0.0.1: only the local reverse proxy can reach it)
 *   SESSION_HOURS      how long a sign-in lasts (default 720 = 30 days)
 *   CACHE_SECONDS      how long identical monday queries are cached (default 300)
 *
 * No npm dependencies: `node server.js`.
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN || "";
const REPORT_PASSWORD = process.env.REPORT_PASSWORD || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const SESSION_HOURS = Number(process.env.SESSION_HOURS || 720);
const CACHE_SECONDS = Number(process.env.CACHE_SECONDS || 300);
const PUBLIC_DIR = path.join(__dirname, "public");
const MONDAY_URL = process.env.MONDAY_API_URL || "https://api.monday.com/v2"; // override only for testing
const COOKIE = "lb_session";

for (const [name, value] of Object.entries({ MONDAY_API_TOKEN, REPORT_PASSWORD, SESSION_SECRET })) {
  if (!value) {
    console.error(`Missing required environment variable ${name}`);
    process.exit(1);
  }
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

// ------------------------------------------------------------------ sessions

function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
}

function makeSession() {
  const expires = Date.now() + SESSION_HOURS * 3600 * 1000;
  const payload = String(expires);
  return `${payload}.${sign(payload)}`;
}

function validSession(req) {
  const cookies = Object.fromEntries((req.headers.cookie || "").split(";").map((c) => {
    const i = c.indexOf("=");
    return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
  }));
  const value = cookies[COOKIE];
  if (!value) return false;
  const [payload, mac] = value.split(".");
  if (!payload || !mac) return false;
  const expected = sign(payload);
  if (expected.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(mac))) return false;
  return Number(payload) > Date.now();
}

function sessionCookie(value, maxAgeSeconds, req) {
  const secure = req.headers["x-forwarded-proto"] === "https" || req.socket.encrypted ? "; Secure" : "";
  return `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`;
}

function passwordMatches(given) {
  const a = crypto.createHash("sha256").update(String(given || "")).digest();
  const b = crypto.createHash("sha256").update(REPORT_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

// Slow down password guessing: 10 failed tries per IP per 15 minutes
const failures = new Map();
function clientIp(req) {
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "";
}
function tooManyFailures(ip) {
  const entry = failures.get(ip);
  if (!entry || entry.until < Date.now()) return false;
  return entry.count >= 10;
}
function recordFailure(ip) {
  const entry = failures.get(ip);
  if (!entry || entry.until < Date.now()) failures.set(ip, { count: 1, until: Date.now() + 15 * 60 * 1000 });
  else entry.count += 1;
}

// ------------------------------------------------------------------ helpers

function send(res, status, body, headers) {
  const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": typeof body === "object" && !Buffer.isBuffer(body) ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    ...headers,
  });
  res.end(data);
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(new Error("Request too large")); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// Only read queries are passed to monday.com (no mutations, no subscriptions)
function isReadOnly(query) {
  const withoutStrings = String(query).replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/#[^\n]*/g, "");
  return !/\b(mutation|subscription)\b/i.test(withoutStrings);
}

const cache = new Map();
function cacheGet(key) {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  cache.delete(key);
  return null;
}
function cacheSet(key, value) {
  if (cache.size > 500) cache.clear();
  cache.set(key, { value, until: Date.now() + CACHE_SECONDS * 1000 });
}

// -------------------------------------------------------------------- routes

async function handleApi(req, res, pathname) {
  if (pathname === "/api/session" && req.method === "GET") {
    return send(res, 200, { signedIn: validSession(req) });
  }

  if (pathname === "/api/login" && req.method === "POST") {
    const ip = clientIp(req);
    if (tooManyFailures(ip)) return send(res, 429, { error: "Too many attempts. Try again in 15 minutes." });
    let password = "";
    try { password = JSON.parse(await readBody(req, 10 * 1024)).password; } catch (e) { /* treated as wrong */ }
    if (!passwordMatches(password)) {
      recordFailure(ip);
      return send(res, 401, { error: "Wrong password." });
    }
    failures.delete(ip);
    return send(res, 200, { signedIn: true },
      { "Set-Cookie": sessionCookie(makeSession(), SESSION_HOURS * 3600, req) });
  }

  if (pathname === "/api/logout" && req.method === "POST") {
    return send(res, 200, { signedIn: false }, { "Set-Cookie": sessionCookie("", 0, req) });
  }

  if (pathname === "/api/monday" && req.method === "POST") {
    if (!validSession(req)) return send(res, 401, { error: "Please sign in." });
    let body;
    try { body = JSON.parse(await readBody(req)); } catch (e) { return send(res, 400, { error: "Bad request." }); }
    if (!body || typeof body.query !== "string") return send(res, 400, { error: "Missing query." });
    if (!isReadOnly(body.query)) return send(res, 403, { error: "Only read queries are allowed." });

    const key = crypto.createHash("sha256").update(JSON.stringify([body.query, body.variables || {}])).digest("hex");
    const cached = cacheGet(key);
    if (cached) return send(res, 200, cached, { "X-Cache": "hit" });

    try {
      const upstream = await fetch(MONDAY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: MONDAY_API_TOKEN, "API-Version": "2025-04" },
        body: JSON.stringify({ query: body.query, variables: body.variables || {} }),
      });
      const text = await upstream.text();
      if (upstream.ok && !/"errors"\s*:/.test(text)) cacheSet(key, text);
      return send(res, upstream.status, text, { "Content-Type": "application/json; charset=utf-8" });
    } catch (err) {
      console.error("monday.com request failed:", err.message);
      return send(res, 502, { error: "Couldn't reach monday.com." });
    }
  }

  return send(res, 404, { error: "Not found." });
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, "Forbidden");
  fs.stat(file, (err, stat) => {
    if (!err && stat.isDirectory()) {
      res.writeHead(301, { Location: pathname + "/" });
      return res.end();
    }
    if (err || !stat.isFile()) return send(res, 404, "Not found");
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": file.endsWith(".html") ? "no-cache" : "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  try {
    if (pathname === "/healthz") return send(res, 200, "ok");
    if (pathname.startsWith("/api/")) return await handleApi(req, res, pathname);
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed");
    return serveStatic(req, res, pathname);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 500, { error: "Server error." });
  }
});

server.listen(PORT, HOST, () => console.log(`Leadership Boards listening on ${HOST}:${PORT}`));
