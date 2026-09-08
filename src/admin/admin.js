/* =========================================================
   SHEGLAM PK — shared admin runtime

   The server decides everything: which nav items exist, which
   permissions the account holds, whether a request is allowed. This
   file only renders what it is told. Hiding a button here is
   presentation — the API refuses the call regardless.
   ========================================================= */
(function (global) {
  "use strict";

  const $  = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.prototype.slice.call(c.querySelectorAll(s));

  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  const money = (n) => "Rs. " + Number(n || 0).toLocaleString("en-PK", { maximumFractionDigits: 0 });

  function when(value, withTime = false) {
    if (!value) return "—";
    const d = new Date(value);
    if (isNaN(d)) return "—";
    const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    return withTime ? `${date}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : date;
  }

  /* ---------- toast ---------- */
  let toastTimer;
  function toast(message, isError) {
    let el = $("#toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.toggle("err", !!isError);
    el.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("is-on"), isError ? 5000 : 2600);
  }

  /* ---------- api ---------- */
  let csrfToken = null;

  async function api(path, options = {}) {
    const opts = Object.assign({ headers: {} }, options);
    opts.headers = Object.assign({ "Content-Type": "application/json" }, opts.headers);
    // Writes must carry the CSRF token issued with this session
    if (opts.method && opts.method !== "GET" && csrfToken) opts.headers["X-CSRF-Token"] = csrfToken;
    if (opts.body && typeof opts.body !== "string") opts.body = JSON.stringify(opts.body);

    const res = await fetch(path, opts);

    // Session gone or expired: back to login rather than a confusing error
    if (res.status === 401 && !/\/login$/.test(location.pathname)) {
      location.href = "/admin/login?next=" + encodeURIComponent(location.pathname + location.search);
      throw new Error("Signed out");
    }

    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }

    /* The account still has a temporary password. The server refuses
       everything else, so send them to the one page that works. */
    if (res.status === 403 && data && data.mustChangePassword &&
        !/\/password$/.test(location.pathname)) {
      location.href = "/admin/password";
      throw new Error("Password change required");
    }

    if (!res.ok || (data && data.ok === false)) {
      throw new Error((data && data.error) || `Request failed (${res.status})`);
    }
    return data;
  }

  /* ---------- session + chrome ---------- */
  let session = null;

  async function boot(activeHref) {
    try {
      session = await api("/api/admin/session");
    } catch (e) {
      if (!/Signed out/.test(e.message)) {
        document.body.innerHTML =
          '<div class="login-wrap"><div class="login">' +
          '<div class="brand">SHEGLAM<span>.PK</span><em>ADMIN</em></div>' +
          '<h1>Cannot reach the server</h1>' +
          '<p class="sub">' + esc(e.message) + '</p>' +
          '<a class="btn btn--primary btn--block" href="/admin/login">Back to sign in</a>' +
          '</div></div>';
      }
      throw e;
    }

    csrfToken = session.csrfToken;

    /* Caught here as well as in api(): /api/admin/session deliberately
       still answers while locked, so boot() would otherwise render a
       dashboard whose every subsequent call fails. */
    if (session.user.mustChangePassword && !/\/password$/.test(location.pathname)) {
      location.href = "/admin/password";
      throw new Error("Password change required");
    }

    renderChrome(activeHref);
    return session;
  }

  function renderChrome(activeHref) {
    const nav = $("#nav");
    if (nav) {
      nav.innerHTML = session.nav
        .map((i) => `<a href="${esc(i.href)}"${i.href === activeHref ? ' class="is-on"' : ""}>${esc(i.label)}</a>`)
        .join("");
    }
    const who = $("#whoami");
    if (who) {
      who.innerHTML =
        `<b>${esc(session.user.displayName)}</b>` +
        `<span class="role">${session.user.role === "SUPER_ADMIN" ? "Super Admin" : "Admin"}</span>`;
    }
    const out = $("#logout");
    if (out) {
      out.addEventListener("click", async () => {
        try { await api("/api/admin/logout", { method: "POST" }); } catch {}
        location.href = "/admin/login";
      });
    }
    const burger = $("#burger"), side = $("#side"), mask = $("#mask");
    if (burger && side) {
      burger.addEventListener("click", () => {
        side.classList.toggle("is-on");
        if (mask) mask.classList.toggle("is-on", side.classList.contains("is-on"));
      });
      if (mask) mask.addEventListener("click", () => {
        side.classList.remove("is-on");
        mask.classList.remove("is-on");
      });
    }
  }

  /* True only if the server granted it — used to decide whether to
     render a control at all. The API still enforces it. */
  const can = (permission) => !!session && session.permissions.indexOf(permission) > -1;

  global.Admin = { $, $$, esc, money, when, toast, api, boot, can, get session() { return session; } };
})(window);
