/* =========================================================
   lib/http.js — shared plumbing for the serverless API

   Every admin endpoint goes through guard(), so authentication, CSRF
   and permission checks are applied in one place rather than being
   re-implemented (and eventually forgotten) per route.
   ========================================================= */
const auth = require("./auth.js");
const rbac = require("./rbac.js");

const IS_PROD = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";

/* ---------- responses ---------- */
function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  // Admin data must never be framed, sniffed or leaked via referrer.
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.end(JSON.stringify(payload));
}

const ok = (res, data = {}) => json(res, 200, { ok: true, ...data });
const fail = (res, status, error, extra = {}) => json(res, status, { ok: false, error, ...extra });

/* ---------- request ---------- */
function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || null;
}

async function readBody(req, limitBytes = 1_000_000) {
  if (req.body !== undefined && req.body !== null) {
    // Vercel may have parsed it already
    return typeof req.body === "string" ? safeParse(req.body) : req.body;
  }
  return new Promise((resolve, reject) => {
    let raw = "", size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limitBytes) { reject(new Error("Request body too large")); req.destroy(); return; }
      raw += c;
    });
    req.on("end", () => resolve(safeParse(raw)));
    req.on("error", reject);
  });
}

function safeParse(raw) {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error("Invalid JSON body"); }
}

/* ---------- method routing ---------- */
function methods(req, res, handlers) {
  const fn = handlers[req.method];
  if (!fn) {
    res.setHeader("Allow", Object.keys(handlers).join(", "));
    return fail(res, 405, `${req.method} not allowed here`);
  }
  return fn();
}

/* ---------- the guard ----------
   Resolves the session, checks the permission, and for anything that
   changes state also verifies the CSRF token. Returns the session, or
   sends the error response and returns null. */
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function guard(req, res, permission, opts = {}) {
  const token = auth.readCookie(req.headers.cookie);
  const session = await auth.getSession(token);

  if (!session) { fail(res, 401, "Not signed in"); return null; }

  /* An account still carrying a temporary password can do exactly one
     thing: replace it. Without this the must_change_password flag would
     be decoration — the account would keep full access indefinitely.
     Only the endpoints needed to complete the change opt out. */
  if (session.user.mustChangePassword && !opts.allowPasswordChange) {
    fail(res, 403, "Set a new password before continuing.", { mustChangePassword: true });
    return null;
  }

  if (MUTATING.has(req.method)) {
    const sent = req.headers["x-csrf-token"];
    if (!sent || sent !== session.csrf) {
      await auth.audit({
        actorId: session.user.id, actorUsername: session.user.username,
        action: "CSRF_REJECTED", result: "DENIED", ip: clientIp(req),
        detail: { path: req.url, method: req.method },
      });
      fail(res, 403, "Invalid or missing CSRF token");
      return null;
    }
  }

  if (permission && !rbac.can(session.user.role, permission)) {
    await auth.audit({
      actorId: session.user.id, actorUsername: session.user.username,
      action: "PERMISSION_DENIED", result: "DENIED", ip: clientIp(req),
      detail: { permission, path: req.url },
    });
    fail(res, 403, "You do not have permission to do that");
    return null;
  }

  return session;
}

/* Wraps a handler so an unexpected throw becomes a 500 with a logged
   cause, never a stack trace sent to the browser. */
function handler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof rbac.AuthError) return fail(res, e.status, e.message);
      console.error(`[api] ${req.method} ${req.url} —`, e);
      return fail(res, 500, "Something went wrong. Please try again.");
    }
  };
}

module.exports = {
  IS_PROD, json, ok, fail, clientIp, readBody, methods, guard, handler,
};
