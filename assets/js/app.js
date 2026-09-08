/* =========================================================
   SHEGLAM PK — app.js
   Runtime behaviour only. All chrome and initial grids are
   pre-rendered by build.js, so the site works with JS disabled
   and this file progressively enhances it.
   ========================================================= */
(function () {
  "use strict";

  const D = window.SGPK;   // catalog + config
  const T = window.SGPKT;  // shared templates
  if (!D || !T) { console.error("[sgpk] catalog/templates failed to load"); return; }

  const { SITE, PRODUCTS, CATEGORIES, FINISHES, PROMOS, money, byId, bySlug } = D;

  /* ---------------------------------------------------------
     Helpers
     --------------------------------------------------------- */
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.prototype.slice.call(c.querySelectorAll(s));
  const BASE = document.body.dataset.base || "";
  const PAGE = document.body.dataset.page || "";
  const on = (el, ev, fn, opt) => el && el.addEventListener(ev, fn, opt);
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  const store = {
    get(k, fb) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? fb : v; } catch { return fb; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  let cart = store.get("sgpk_cart", []);
  let wishlist = store.get("sgpk_wishlist", []);
  let orders = store.get("sgpk_orders", []);

  const lineKey = (id, shade) => `${id}::${shade || ""}`;
  const saveCart = () => store.set("sgpk_cart", cart);
  const saveWish = () => store.set("sgpk_wishlist", wishlist);

  const cartCount = () => cart.reduce((s, l) => s + l.qty, 0);
  const cartSubtotal = () => cart.reduce((s, l) => { const p = byId(l.id); return p ? s + p.price * l.qty : s; }, 0);
  const shippingFor = (sub) => (sub >= SITE.freeShippingOver || sub === 0 ? 0 : SITE.flatShipping);

  /* ---------------------------------------------------------
     Analytics (only fires when an ID is configured)
     --------------------------------------------------------- */
  function initAnalytics() {
    if (SITE.ga4) {
      const s = document.createElement("script");
      s.async = true;
      s.src = "https://www.googletagmanager.com/gtag/js?id=" + SITE.ga4;
      document.head.appendChild(s);
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag("js", new Date());
      window.gtag("config", SITE.ga4);
    }
    if (SITE.metaPixel) {
      /* eslint-disable */
      !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
      n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
      n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
      t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}
      (window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
      /* eslint-enable */
      window.fbq("init", SITE.metaPixel);
      window.fbq("track", "PageView");
    }
  }
  function track(name, params) {
    if (window.gtag) window.gtag("event", name, params || {});
    if (window.fbq) {
      const map = { add_to_cart: "AddToCart", begin_checkout: "InitiateCheckout", purchase: "Purchase", view_item: "ViewContent", search: "Search" };
      if (map[name]) window.fbq("track", map[name], params || {});
    }
  }

  /* ---------------------------------------------------------
     Toast
     --------------------------------------------------------- */
  let toastTimer;
  function toast(msg, ok = true) {
    const t = $("#toast");
    if (!t) return;
    t.innerHTML = (ok ? T.icon("check", 18, 2.4) : "") + "<span>" + T.esc(msg) + "</span>";
    t.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("is-on"), 2600);
  }

  /* ---------------------------------------------------------
     Overlay / panels
     --------------------------------------------------------- */
  const overlay = () => $("#overlay");
  function openPanel(el) {
    if (!el) return;
    el.classList.add("is-open");
    el.setAttribute("aria-hidden", "false");
    overlay().classList.add("is-on");
    document.body.style.overflow = "hidden";
  }
  function closeAll() {
    $$(".drawer").forEach((d) => { d.classList.remove("is-open"); d.setAttribute("aria-hidden", "true"); });
    const nav = $("#nav"), ham = $("#hamburger"), f = $("#filters");
    if (nav) nav.classList.remove("is-open");
    if (ham) { ham.classList.remove("is-open"); ham.setAttribute("aria-expanded", "false"); }
    if (f) f.classList.remove("is-open");
    $$(".has-mega").forEach((m) => m.classList.remove("is-open"));
    const sb = $("#searchbar");
    if (sb) { sb.classList.remove("is-open"); sb.setAttribute("aria-hidden", "true"); }
    const ov = overlay();
    if (ov) ov.classList.remove("is-on");
    document.body.style.overflow = "";
  }
  function closeModal(el) {
    if (!el) return;
    el.classList.remove("is-open");
    el.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }
  function openModal(el) {
    if (!el) return;
    el.classList.add("is-open");
    el.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  /* ---------------------------------------------------------
     Badges
     --------------------------------------------------------- */
  function updateBadges() {
    const c = cartCount(), w = wishlist.length;
    const cb = $("#cartCount"), wb = $("#wishCount");
    if (cb) { cb.textContent = c; cb.classList.toggle("is-on", c > 0); }
    if (wb) { wb.textContent = w; wb.classList.toggle("is-on", w > 0); }
  }

  /* ---------------------------------------------------------
     Cart
     --------------------------------------------------------- */
  function addToCart(id, shade, qty) {
    const p = byId(id);
    if (!p) return;
    if (!p.inStock) { toast("That one is sold out", false); return; }
    if (p.shades && p.shades.length && !shade) {
      // No shade chosen — send the shopper to the product page to pick one.
      location.href = `${BASE}product/${p.slug}.html#shade`;
      return;
    }
    qty = qty || 1;
    const key = lineKey(id, shade);
    const line = cart.find((l) => lineKey(l.id, l.shade) === key);
    if (line) line.qty = clamp(line.qty + qty, 1, 99);
    else cart.push({ id, shade: shade || "", qty: clamp(qty, 1, 99) });
    saveCart(); renderCart(); updateBadges();
    toast(`${p.name}${shade ? " — " + shade : ""} added to cart`);
    track("add_to_cart", { currency: "PKR", value: p.price * qty, items: [{ item_id: p.sku, item_name: p.name, quantity: qty }] });
  }
  function setQty(key, delta) {
    const line = cart.find((l) => lineKey(l.id, l.shade) === key);
    if (!line) return;
    line.qty += delta;
    if (line.qty < 1) cart = cart.filter((l) => lineKey(l.id, l.shade) !== key);
    saveCart(); renderCart(); updateBadges();
  }
  function removeLine(key) {
    cart = cart.filter((l) => lineKey(l.id, l.shade) !== key);
    saveCart(); renderCart(); updateBadges();
  }

  function renderCart() {
    const box = $("#cartItems");
    if (!box) return;
    if (!cart.length) {
      box.innerHTML = `<div class="drawer__empty">${T.icon("cart", 40, 1.2)}
        <h4>Your cart is empty</h4>
        <p>Browse the bestsellers and find something you love.</p>
        <a class="btn btn--primary" href="${BASE}best-sellers.html">Shop bestsellers</a></div>`;
    } else {
      box.innerHTML = cart.map((l) => {
        const p = byId(l.id);
        if (!p) return "";
        const key = lineKey(l.id, l.shade);
        return `<div class="lineitem">
          <img class="lineitem__img" src="${p.image}" alt="${T.esc(p.name)}" data-tile="${p.tile}" data-fallback="${T.esc(p.name.charAt(0))}">
          <div>
            <div class="lineitem__name"><a href="${BASE}product/${p.slug}.html">${T.esc(p.name)}</a></div>
            ${l.shade ? `<div class="lineitem__variant">Shade: ${T.esc(l.shade)}</div>` : ""}
            <div class="lineitem__price">${money(p.price * l.qty)}</div>
            <div class="lineitem__qty">
              <button class="js-qty" data-key="${key}" data-d="-1" aria-label="Decrease quantity">&minus;</button>
              <span>${l.qty}</span>
              <button class="js-qty" data-key="${key}" data-d="1" aria-label="Increase quantity">+</button>
            </div>
          </div>
          <button class="lineitem__x js-rm" data-key="${key}" aria-label="Remove">${T.icon("close", 16)}</button>
        </div>`;
      }).join("");
    }
    const sub = cartSubtotal();
    const st = $("#cartSubtotal");
    if (st) st.textContent = money(sub);
    const ship = $("#cartShipNote");
    if (ship) {
      const left = SITE.freeShippingOver - sub;
      ship.innerHTML = !cart.length ? ""
        : left > 0
          ? `Add <b>${money(left)}</b> more for free delivery`
          : `You have unlocked <b>free delivery</b>`;
    }
    const co = $("#checkoutBtn");
    if (co) co.disabled = !cart.length;
    const wa = $("#cartWa");
    if (wa) {
      if (cart.length) { wa.href = waCartURL(); wa.classList.remove("is-disabled"); }
      else { wa.removeAttribute("href"); wa.classList.add("is-disabled"); }
    }
  }

  /* ---------------------------------------------------------
     Wishlist
     --------------------------------------------------------- */
  function toggleWish(id) {
    const p = byId(id);
    const i = wishlist.indexOf(id);
    if (i > -1) { wishlist.splice(i, 1); toast(`${p.name} removed from wishlist`); }
    else { wishlist.push(id); toast(`${p.name} saved to wishlist`); }
    saveWish(); renderWishlist(); updateBadges(); syncWishButtons();
  }
  function syncWishButtons() {
    $$(".js-wish").forEach((b) => b.classList.toggle("is-on", wishlist.includes(+b.dataset.id)));
    const pw = $("#pdpWish");
    if (pw) {
      const on = wishlist.includes(+pw.dataset.id);
      pw.classList.toggle("is-on", on);
      pw.querySelector("span").textContent = on ? "Saved" : "Save";
    }
  }
  function renderWishlist() {
    const box = $("#wishItems");
    if (!box) return;
    if (!wishlist.length) {
      box.innerHTML = `<div class="drawer__empty">${T.icon("heart", 40, 1.2)}
        <h4>Nothing saved yet</h4>
        <p>Tap the heart on any product to keep it here.</p>
        <a class="btn btn--primary" href="${BASE}face.html">Start browsing</a></div>`;
      return;
    }
    box.innerHTML = wishlist.map((id) => {
      const p = byId(id);
      if (!p) return "";
      return `<div class="lineitem">
        <img class="lineitem__img" src="${p.image}" alt="${T.esc(p.name)}" data-tile="${p.tile}" data-fallback="${T.esc(p.name.charAt(0))}">
        <div>
          <div class="lineitem__name"><a href="${BASE}product/${p.slug}.html">${T.esc(p.name)}</a></div>
          <div class="lineitem__price">${money(p.price)}</div>
          <a class="btn btn--rose btn--sm" style="margin-top:8px" href="${BASE}product/${p.slug}.html">
            ${p.shades && p.shades.length ? "Choose shade" : "View product"}</a>
        </div>
        <button class="lineitem__x js-wish-rm" data-id="${p.id}" aria-label="Remove">${T.icon("close", 16)}</button>
      </div>`;
    }).join("");
  }

  /* ---------------------------------------------------------
     WhatsApp order links
     --------------------------------------------------------- */
  const waBase = "https://wa.me/" + SITE.whatsapp + "?text=";
  function waCartURL() {
    const lines = [`Hello ${SITE.name}! I'd like to place an order:`, ""];
    cart.forEach((l) => {
      const p = byId(l.id);
      lines.push(`• ${p.name}${l.shade ? " — " + l.shade : ""} (x${l.qty}) — ${money(p.price * l.qty)}`);
    });
    const sub = cartSubtotal();
    const ship = shippingFor(sub);
    lines.push("", `Subtotal: ${money(sub)}`, `Delivery: ${ship ? money(ship) : "Free"}`, `*Total: ${money(sub + ship)}*`);
    return waBase + encodeURIComponent(lines.join("\n"));
  }
  function waOrderURL(o) {
    const lines = [
      `Hello ${SITE.name}! Here are my order details:`, "",
      `Order Ref: ${o.ref}`, `Name: ${o.name}`, `Phone: ${o.phone}`,
      `City: ${o.city}`, `Address: ${o.address}`,
      `Payment: ${o.payment}`, "", "Items:",
    ];
    o.items.forEach((i) => lines.push(`• ${i.name}${i.shade ? " — " + i.shade : ""} (x${i.qty}) — ${money(i.price * i.qty)}`));
    lines.push("", `Subtotal: ${money(o.subtotal)}`, `Delivery: ${o.shipping ? money(o.shipping) : "Free"}`, `*Total: ${money(o.total)}*`);
    return waBase + encodeURIComponent(lines.join("\n"));
  }

  /* ---------------------------------------------------------
     Header behaviour
     --------------------------------------------------------- */
  function initHeader() {
    on($("#hamburger"), "click", () => {
      const nav = $("#nav"), ham = $("#hamburger");
      const isOpen = nav.classList.toggle("is-open");
      ham.classList.toggle("is-open", isOpen);
      ham.setAttribute("aria-expanded", String(isOpen));
      overlay().classList.toggle("is-on", isOpen);
      document.body.style.overflow = isOpen ? "hidden" : "";
    });

    // Mega menu: hover on desktop (CSS), click on mobile
    $$(".has-mega > .nav__link").forEach((btn) => {
      on(btn, "click", (e) => {
        if (window.matchMedia("(min-width:901px)").matches) return;
        e.preventDefault();
        btn.parentElement.classList.toggle("is-open");
      });
    });

    on($("#searchToggle"), "click", () => {
      const sb = $("#searchbar");
      const isOpen = sb.classList.toggle("is-open");
      sb.setAttribute("aria-hidden", String(!isOpen));
      if (isOpen) setTimeout(() => $("#searchInput").focus(), 180);
    });

    const region = $("#region");
    on($("#regionToggle"), "click", (e) => { e.stopPropagation(); region.classList.toggle("is-open"); });
    on(document, "click", () => region && region.classList.remove("is-open"));

    on($("#cartToggle"), "click", () => { renderCart(); openPanel($("#cartDrawer")); });
    on($("#wishToggle"), "click", () => { renderWishlist(); openPanel($("#wishDrawer")); });
    on($("#cartClose"), "click", closeAll);
    on($("#wishClose"), "click", closeAll);
    on(overlay(), "click", closeAll);

    on($("#accountBtn"), "click", () => {
      toast("Accounts are coming soon — order as a guest for now", false);
    });

    // Sticky shadow
    const header = $("#header");
    let last = 0;
    on(window, "scroll", () => {
      const y = window.scrollY;
      if (header) header.style.boxShadow = y > 4 ? "0 6px 20px -14px rgba(33,36,43,.4)" : "";
      const bt = $("#backTop");
      if (bt) bt.classList.toggle("is-on", y > 700);
      last = y;
    }, { passive: true });

    on($("#backTop"), "click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

    on(document, "keydown", (e) => {
      if (e.key === "Escape") { closeAll(); $$(".modal.is-open").forEach(closeModal); }
    });
  }

  /* ---------------------------------------------------------
     Announcement rotation
     --------------------------------------------------------- */
  function initTopbar() {
    const el = $("#promoText");
    if (!el || PROMOS.length < 2) return;
    let i = 0, timer;
    const show = (n) => {
      i = (n + PROMOS.length) % PROMOS.length;
      el.style.opacity = "0";
      setTimeout(() => { el.textContent = PROMOS[i]; el.style.opacity = "1"; }, 260);
    };
    const start = () => { clearInterval(timer); timer = setInterval(() => show(i + 1), 5000); };
    on($("#promoNext"), "click", () => { show(i + 1); start(); });
    on($("#promoPrev"), "click", () => { show(i - 1); start(); });
    start();
  }

  /* ---------------------------------------------------------
     Search
     --------------------------------------------------------- */
  function searchProducts(term) {
    const q = term.trim().toLowerCase();
    if (!q) return [];
    const words = q.split(/\s+/);
    return PRODUCTS
      .map((p) => {
        const hay = `${p.name} ${p.categoryLabel} ${p.sub} ${p.finish} ${(p.shades || []).map((s) => s.name).join(" ")}`.toLowerCase();
        let score = 0;
        words.forEach((w) => {
          if (hay.includes(w)) score += 1;
          if (p.name.toLowerCase().startsWith(w)) score += 2;
          if (p.sub.toLowerCase().includes(w)) score += 1;
        });
        return { p, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.p.id - b.p.id)
      .map((x) => x.p);
  }

  function initSearch() {
    const input = $("#searchInput"), res = $("#searchRes");
    if (!input) return;
    let t;
    on(input, "input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const q = input.value.trim();
        if (!q) { res.innerHTML = ""; return; }
        const hits = searchProducts(q);
        track("search", { search_term: q });
        res.innerHTML = hits.length
          ? hits.slice(0, 6).map((p) => `<a class="searchres__item" href="${BASE}product/${p.slug}.html">
              <img class="searchres__thumb" src="${p.image}" alt="" data-tile="${p.tile}" data-fallback="${T.esc(p.name.charAt(0))}">
              <div><div class="searchres__name">${T.esc(p.name)}</div>
              <div class="searchres__meta">${T.esc(p.sub)} · ${money(p.price)}</div></div></a>`).join("")
            + `<a class="searchres__all" href="${BASE}search.html?q=${encodeURIComponent(q)}">See all ${hits.length} results</a>`
          : `<div class="empty"><h3>No matches for “${T.esc(q)}”</h3>
             <p>Try a category like “blush”, “primer” or “lip gloss”.</p></div>`;
      }, 160);
    });
    on(input, "keydown", (e) => {
      if (e.key === "Enter" && input.value.trim()) {
        location.href = `${BASE}search.html?q=${encodeURIComponent(input.value.trim())}`;
      }
    });
    $$(".searchbar__hints button").forEach((b) =>
      on(b, "click", () => { input.value = b.textContent; input.dispatchEvent(new Event("input")); })
    );
  }

  function initSearchPage() {
    if (PAGE !== "search") return;
    const q = new URLSearchParams(location.search).get("q") || "";
    const hits = searchProducts(q);
    const title = $("#searchTitle"), count = $("#searchCount"), out = $("#searchGrid");
    if (title) title.textContent = q ? `Results for “${q}”` : "Search";
    if (count) count.textContent = `${hits.length} ${hits.length === 1 ? "product" : "products"}`;
    const box = $("#searchQuery");
    if (box) box.value = q;
    if (out) {
      out.innerHTML = hits.length
        ? hits.map((p) => T.card(p, BASE)).join("")
        : `<div class="empty"><h3>No products matched “${T.esc(q)}”</h3>
           <p>Check the spelling, or browse a category instead.</p>
           <a class="btn btn--primary" href="${BASE}face.html">Shop face</a></div>`;
      syncWishButtons();
    }
  }

  /* ---------------------------------------------------------
     Listing pages — filters, sort, pagination
     --------------------------------------------------------- */
  const SORTS = {
    recommend: (a, b) => (b.isBestSeller - a.isBestSeller) || a.id - b.id,
    new: (a, b) => (b.isNew - a.isNew) || b.id - a.id,
    "price-asc": (a, b) => a.price - b.price,
    "price-desc": (a, b) => b.price - a.price,
    rating: (a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount,
    discount: (a, b) => b.discount - a.discount,
  };

  function initListing() {
    const root = $("#listing");
    if (!root) return;

    const feed = root.dataset.feed;
    const collectionSlug = root.dataset.collection || "";
    let source;
    if (feed === "collection") {
      const col = D.COLLECTIONS.find((c) => c.slug === collectionSlug);
      source = col ? col.ids.map(byId).filter(Boolean) : [];
    } else {
      source = (D.FEEDS[feed] || D.FEEDS.all)();
    }

    const gridEl = $("#grid"), countEl = $("#count"), chipsEl = $("#chips");
    const PER_PAGE = 20;
    let shown = PER_PAGE;

    const state = { sub: [], finish: [], shade: [], min: null, max: null, sort: "recommend", inStock: false };

    /* --- read URL --- */
    (function readURL() {
      const q = new URLSearchParams(location.search);
      if (q.get("sub")) state.sub = q.get("sub").split(",");
      if (q.get("finish")) state.finish = q.get("finish").split(",");
      if (q.get("min")) state.min = +q.get("min");
      if (q.get("max")) state.max = +q.get("max");
      if (q.get("sort")) state.sort = q.get("sort");
      if (q.get("stock")) state.inStock = true;
    })();

    function writeURL() {
      const q = new URLSearchParams();
      if (state.sub.length) q.set("sub", state.sub.join(","));
      if (state.finish.length) q.set("finish", state.finish.join(","));
      if (state.min != null) q.set("min", state.min);
      if (state.max != null) q.set("max", state.max);
      if (state.sort !== "recommend") q.set("sort", state.sort);
      if (state.inStock) q.set("stock", "1");
      const s = q.toString();
      history.replaceState(null, "", s ? `?${s}` : location.pathname);
    }

    function apply() {
      let out = source.filter((p) => {
        if (state.sub.length && !state.sub.includes(p.sub)) return false;
        if (state.finish.length && !state.finish.includes(p.finish)) return false;
        if (state.min != null && p.price < state.min) return false;
        if (state.max != null && p.price > state.max) return false;
        if (state.inStock && !p.inStock) return false;
        return true;
      });
      out.sort(SORTS[state.sort] || SORTS.recommend);
      return out;
    }

    function renderChips(list) {
      if (!chipsEl) return;
      const chips = [];
      state.sub.forEach((s) => chips.push({ k: "sub", v: s, label: s }));
      state.finish.forEach((s) => chips.push({ k: "finish", v: s, label: s }));
      if (state.min != null) chips.push({ k: "min", v: 1, label: `From ${money(state.min)}` });
      if (state.max != null) chips.push({ k: "max", v: 1, label: `Up to ${money(state.max)}` });
      if (state.inStock) chips.push({ k: "inStock", v: 1, label: "In stock only" });
      chipsEl.innerHTML = chips.length
        ? chips.map((c) => `<span class="chip">${T.esc(c.label)}
            <button class="js-chip" data-k="${c.k}" data-v="${T.esc(String(c.v))}" aria-label="Remove filter">${T.icon("close", 13, 2)}</button></span>`).join("")
          + `<button class="chip js-clear" style="color:var(--rose)">Clear all</button>`
        : "";
    }

    function render() {
      const list = apply();
      if (countEl) countEl.innerHTML = `<strong>${list.length}</strong> ${list.length === 1 ? "product" : "products"}`;
      const page = list.slice(0, shown);
      gridEl.innerHTML = page.length
        ? page.map((p) => T.card(p, BASE)).join("")
        : `<div class="empty"><h3>Nothing matches those filters</h3>
           <p>Try widening the price range or clearing a filter.</p>
           <button class="btn btn--primary js-clear">Clear all filters</button></div>`;
      const more = $("#loadMore");
      if (more) more.style.display = list.length > shown ? "" : "none";
      const rem = list.length - shown;
      const mb = $("#loadMoreBtn");
      if (mb) mb.textContent = `View more (${rem > 0 ? rem : 0} left)`;
      renderChips(list);
      syncWishButtons();
      writeURL();
    }

    /* --- build the filter panel from what is actually in this feed --- */
    function buildFilters() {
      const box = $("#filterGroups");
      if (!box) return;
      const countBy = (key) => {
        const m = {};
        source.forEach((p) => { m[p[key]] = (m[p[key]] || 0) + 1; });
        return m;
      };
      const subs = countBy("sub"), fins = countBy("finish");
      const group = (title, name, entries, sel) => `
        <div class="fgroup">
          <button class="fgroup__btn" type="button">${title} ${T.icon("chevron", 16)}</button>
          <div class="fgroup__body">
            ${Object.keys(entries).sort().map((v) => `
              <label class="check">
                <input type="checkbox" data-f="${name}" value="${T.esc(v)}" ${sel.includes(v) ? "checked" : ""}>
                <span>${T.esc(v)}</span><span class="count">${entries[v]}</span>
              </label>`).join("")}
          </div>
        </div>`;

      box.innerHTML =
        (Object.keys(subs).length > 1 ? group("Category", "sub", subs, state.sub) : "") +
        (Object.keys(fins).length > 1 ? group("Finish", "finish", fins, state.finish) : "") +
        `<div class="fgroup">
          <button class="fgroup__btn" type="button">Price ${T.icon("chevron", 16)}</button>
          <div class="fgroup__body">
            <div class="pricerow">
              <input type="number" id="fMin" placeholder="Min" min="0" value="${state.min != null ? state.min : ""}">
              <span>–</span>
              <input type="number" id="fMax" placeholder="Max" min="0" value="${state.max != null ? state.max : ""}">
            </div>
            <button class="btn btn--outline btn--sm" id="fApply" style="margin-top:10px">Apply</button>
          </div>
        </div>
        <div class="fgroup">
          <button class="fgroup__btn" type="button">Availability ${T.icon("chevron", 16)}</button>
          <div class="fgroup__body">
            <label class="check"><input type="checkbox" id="fStock" ${state.inStock ? "checked" : ""}><span>In stock only</span></label>
          </div>
        </div>`;

      $$(".fgroup__btn", box).forEach((b) =>
        on(b, "click", () => b.parentElement.classList.toggle("is-collapsed"))
      );
      $$("input[data-f]", box).forEach((cb) =>
        on(cb, "change", () => {
          const k = cb.dataset.f;
          const v = cb.value;
          if (cb.checked) { if (!state[k].includes(v)) state[k].push(v); }
          else state[k] = state[k].filter((x) => x !== v);
          shown = PER_PAGE;
          render();
        })
      );
      on($("#fApply"), "click", () => {
        const mn = $("#fMin").value, mx = $("#fMax").value;
        state.min = mn === "" ? null : +mn;
        state.max = mx === "" ? null : +mx;
        shown = PER_PAGE; render();
      });
      on($("#fStock"), "change", (e) => { state.inStock = e.target.checked; shown = PER_PAGE; render(); });
    }

    buildFilters();

    const sortSel = $("#sortSelect");
    if (sortSel) {
      sortSel.value = state.sort;
      on(sortSel, "change", () => { state.sort = sortSel.value; shown = PER_PAGE; render(); });
    }
    on($("#loadMoreBtn"), "click", () => { shown += PER_PAGE; render(); });
    on($("#filterOpen"), "click", () => openPanel($("#filters")));
    on($("#filterClose"), "click", closeAll);
    on($("#filterDone"), "click", closeAll);

    on(document, "click", (e) => {
      const chip = e.target.closest(".js-chip");
      const clear = e.target.closest(".js-clear");
      if (chip) {
        const k = chip.dataset.k, v = chip.dataset.v;
        if (k === "sub" || k === "finish") state[k] = state[k].filter((x) => x !== v);
        else if (k === "min") state.min = null;
        else if (k === "max") state.max = null;
        else if (k === "inStock") state.inStock = false;
        shown = PER_PAGE; buildFilters(); render();
      } else if (clear) {
        state.sub = []; state.finish = []; state.min = null; state.max = null; state.inStock = false;
        shown = PER_PAGE; buildFilters(); render();
      }
    });

    render();
  }

  /* ---------------------------------------------------------
     Quick view
     --------------------------------------------------------- */
  function openQuickView(id) {
    const p = byId(id);
    const m = $("#quickView");
    if (!p || !m) return;
    $("#qvBody").innerHTML = `
      <div class="qv">
        <div class="qv__media"><img src="${p.imageLarge}" alt="${T.esc(p.name)}" data-tile="${p.galleryTiles[0]}" data-fallback="${T.esc(p.name.charAt(0))}"></div>
        <div class="qv__info">
          <span class="pdp__cat">${T.esc(p.categoryLabel)} · ${T.esc(p.sub)}</span>
          <h2 class="pdp__name">${T.esc(p.name)}</h2>
          ${p.reviewCount ? `<div class="pdp__ratingrow">${T.stars(p.rating)} <span>${p.rating} (${p.reviewCount})</span></div>` : ""}
          <div class="pdp__pricerow">
            <span class="pdp__price">${money(p.price)}</span>
            ${p.oldPrice ? `<span class="pdp__old">${money(p.oldPrice)}</span><span class="pdp__save">-${p.discount}%</span>` : ""}
          </div>
          <p class="pdp__tax">Inclusive of all taxes · ${T.esc(p.size)}</p>
          ${p.shades && p.shades.length ? `
            <div class="optblock">
              <div class="optblock__head"><span class="optblock__label">Shade: <b id="qvShadeName">Select</b></span></div>
              <div class="shades" id="qvShades">
                ${p.shades.map((s) => `<button class="shade ${s.stock ? "" : "is-out"}" data-shade="${T.esc(s.name)}"
                    style="background:${s.hex}" title="${T.esc(s.name)}" ${s.stock ? "" : "disabled"}></button>`).join("")}
              </div>
            </div>` : ""}
          <p style="font-size:14px;color:var(--muted);line-height:1.7;margin-bottom:20px">${T.esc(p.desc)}</p>
          <div class="buyrow">
            <button class="btn btn--primary btn--block" id="qvAdd" data-id="${p.id}">Add to Cart</button>
          </div>
          <a class="viewall" href="${BASE}product/${p.slug}.html">Full details ${T.icon("chevronR", 15)}</a>
        </div>
      </div>`;

    let picked = "";
    $$("#qvShades .shade").forEach((b) =>
      on(b, "click", () => {
        $$("#qvShades .shade").forEach((x) => x.classList.remove("is-on"));
        b.classList.add("is-on");
        picked = b.dataset.shade;
        $("#qvShadeName").textContent = picked;
      })
    );
    on($("#qvAdd"), "click", () => {
      if (p.shades && p.shades.length && !picked) { toast("Please choose a shade first", false); return; }
      addToCart(p.id, picked, 1);
      closeModal(m);
    });
    openModal(m);
    track("view_item", { items: [{ item_id: p.sku, item_name: p.name }] });
  }

  /* ---------------------------------------------------------
     Product detail page
     --------------------------------------------------------- */
  function initPDP() {
    if (PAGE !== "product") return;
    const slug = document.body.dataset.slug;
    const p = bySlug(slug);
    if (!p) return;

    let shade = "";
    const qtyInput = $("#pdpQty");

    // Gallery
    $$(".gallery__thumb").forEach((th) =>
      on(th, "click", () => {
        $$(".gallery__thumb").forEach((x) => x.classList.remove("is-on"));
        th.classList.add("is-on");
        $("#galleryMain").src = th.dataset.full;
      })
    );
    const main = $("#galleryMainWrap");
    on(main, "click", () => main.classList.toggle("is-zoomed"));

    // Shades
    $$("#pdpShades .shade").forEach((b) =>
      on(b, "click", () => {
        $$("#pdpShades .shade").forEach((x) => x.classList.remove("is-on"));
        b.classList.add("is-on");
        shade = b.dataset.shade;
        $("#pdpShadeName").textContent = shade;
        const s = p.shades.find((x) => x.name === shade);
        const line = $("#pdpStock");
        if (line && s) {
          line.className = "stockline" + (s.stock === 0 ? " is-out" : s.stock <= 5 ? " is-low" : "");
          // Target the label, not the first span — the first span is the dot.
          line.querySelector(".stockline__label").textContent =
            s.stock === 0 ? "Out of stock" : s.stock <= 5 ? `Only ${s.stock} left in this shade` : "In stock — ships within 1–2 days";
        }
      })
    );

    // Quantity
    const setQtyVal = (v) => { qtyInput.value = clamp(parseInt(v, 10) || 1, 1, 99); };
    on($("#qtyDec"), "click", () => setQtyVal(+qtyInput.value - 1));
    on($("#qtyInc"), "click", () => setQtyVal(+qtyInput.value + 1));
    on(qtyInput, "change", () => setQtyVal(qtyInput.value));

    on($("#pdpAdd"), "click", () => {
      if (p.shades && p.shades.length && !shade) {
        toast("Please choose a shade first", false);
        const el = $("#pdpShades");
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.animate([{ opacity: 1 }, { opacity: .35 }, { opacity: 1 }], { duration: 620, iterations: 2 });
        return;
      }
      addToCart(p.id, shade, +qtyInput.value);
      openPanel($("#cartDrawer"));
    });
    on($("#pdpBuy"), "click", () => {
      if (p.shades && p.shades.length && !shade) { toast("Please choose a shade first", false); return; }
      addToCart(p.id, shade, +qtyInput.value);
      openCheckout();
    });
    /* No click handler here on purpose: #pdpWish carries the .js-wish class,
       so the delegated handler owns it. Binding both fired toggleWish twice
       and cancelled itself out. syncWishButtons() updates its label. */
    on($("#pdpWa"), "click", (e) => {
      const lines = [`Hello ${SITE.name}! I'm interested in:`, "",
        `• ${p.name}${shade ? " — " + shade : ""} (x${qtyInput.value})`,
        `${money(p.price)} each`, "", `Link: ${SITE.domain}/product/${p.slug}.html`];
      e.currentTarget.href = waBase + encodeURIComponent(lines.join("\n"));
    });

    // If arrived via #shade (from a card with no shade chosen), nudge the picker
    if (location.hash === "#shade" && $("#pdpShades")) {
      setTimeout(() => {
        $("#pdpShades").scrollIntoView({ behavior: "smooth", block: "center" });
        toast("Choose a shade to add this to your cart", false);
      }, 400);
    }

    // Accordions
    $$(".acc__btn").forEach((b) =>
      on(b, "click", () => b.parentElement.classList.toggle("is-open"))
    );

    initReviews(p);
    trackRecentlyViewed(p);
    track("view_item", { currency: "PKR", value: p.price, items: [{ item_id: p.sku, item_name: p.name }] });
  }

  /* ---------------------------------------------------------
     Reviews
     --------------------------------------------------------- */
  function localReviews(slug) {
    return store.get("sgpk_reviews", {})[slug] || [];
  }
  function initReviews(p) {
    const listEl = $("#reviewList");
    if (!listEl) return;
    const all = p.reviews.concat(localReviews(p.slug));
    const PER = 5;
    let page = 1, fRating = "all", fShade = "all", sort = "recent";

    const shadeNames = Array.from(new Set(all.map((r) => r.s).filter(Boolean)));
    const shadeSel = $("#rvShade");
    if (shadeSel && shadeNames.length) {
      shadeSel.innerHTML = `<option value="all">All shades</option>` +
        shadeNames.map((s) => `<option value="${T.esc(s)}">${T.esc(s)}</option>`).join("");
      shadeSel.closest(".selectwrap").style.display = "";
    }

    function filtered() {
      let out = all.slice();
      if (fRating !== "all") out = out.filter((r) => r.r === +fRating);
      if (fShade !== "all") out = out.filter((r) => r.s === fShade);
      if (sort === "recent") out.sort((a, b) => (a.d < b.d ? 1 : -1));
      if (sort === "high") out.sort((a, b) => b.r - a.r);
      if (sort === "low") out.sort((a, b) => a.r - b.r);
      return out;
    }

    function render() {
      const list = filtered();
      const start = (page - 1) * PER;
      const slice = list.slice(start, start + PER);
      listEl.innerHTML = slice.length
        ? slice.map(T.reviewItem).join("")
        : `<div class="reviews__empty"><h3>No reviews match that filter</h3>
           <p>Try selecting a different rating or shade.</p></div>`;
      const pages = Math.ceil(list.length / PER);
      const pager = $("#reviewPager");
      if (pager) {
        pager.innerHTML = pages > 1
          ? Array.from({ length: pages }, (_, i) =>
              `<button class="${i + 1 === page ? "is-on" : ""}" data-p="${i + 1}">${i + 1}</button>`).join("")
          : "";
        $$("button", pager).forEach((b) =>
          on(b, "click", () => { page = +b.dataset.p; render(); listEl.scrollIntoView({ behavior: "smooth", block: "start" }); })
        );
      }
    }

    on($("#rvRating"), "change", (e) => { fRating = e.target.value; page = 1; render(); });
    on(shadeSel, "change", (e) => { fShade = e.target.value; page = 1; render(); });
    on($("#rvSort"), "change", (e) => { sort = e.target.value; page = 1; render(); });

    // Write a review
    on($("#rvWrite"), "click", () => openModal($("#reviewModal")));
    $$("#starpick label").forEach((lab) =>
      on(lab, "click", () => {
        const n = +lab.dataset.star;
        $$("#starpick label").forEach((x) => x.classList.toggle("is-on", +x.dataset.star <= n));
      })
    );
    on($("#reviewForm"), "submit", (e) => {
      e.preventDefault();
      const name = $("#rvName").value.trim();
      const rating = +($('input[name="rvStars"]:checked') || {}).value || 0;
      const text = $("#rvText").value.trim();
      if (name.length < 2 || !rating || text.length < 10) {
        toast("Please add your name, a rating and a few words", false);
        return;
      }
      const review = {
        a: name, r: rating, t: text, s: $("#rvShadeIn") ? $("#rvShadeIn").value : "",
        d: new Date().toISOString().slice(0, 10), v: 0,
      };
      const map = store.get("sgpk_reviews", {});
      map[p.slug] = (map[p.slug] || []).concat(review);
      store.set("sgpk_reviews", map);
      submitOrQueue("review", {
        product: p.name,
        product_slug: p.slug,
        reviewer: review.a,
        rating: review.r + " / 5",
        shade: review.s || "(not given)",
        review: review.t,
        date: review.d,
        note: "Verify this against a real order before publishing it in data/catalog.js",
      }, { subject: `New review: ${p.name} — ${review.r}/5 from ${review.a}` });
      closeModal($("#reviewModal"));
      toast("Thank you — your review has been submitted");
      setTimeout(() => location.reload(), 900);
    });

    render();
  }

  function trackRecentlyViewed(p) {
    let rv = store.get("sgpk_recent", []);
    rv = [p.id].concat(rv.filter((x) => x !== p.id)).slice(0, 8);
    store.set("sgpk_recent", rv);
  }

  function renderRecentlyViewed() {
    const box = $("#recentGrid");
    if (!box) return;
    const ids = store.get("sgpk_recent", []).filter((id) => id !== +(document.body.dataset.productId || -1));
    const items = ids.map(byId).filter(Boolean).slice(0, 5);
    if (!items.length) { const s = box.closest("section"); if (s) s.style.display = "none"; return; }
    box.innerHTML = items.map((p) => T.card(p, BASE)).join("");
    syncWishButtons();
  }

  /* ---------------------------------------------------------
     Checkout
     --------------------------------------------------------- */
  function orderRef() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let r = "";
    for (let i = 0; i < 5; i++) r += chars[Math.floor(Math.random() * chars.length)];
    return `SG-${new Date().getFullYear().toString().slice(-2)}${String(new Date().getMonth() + 1).padStart(2, "0")}-${r}`;
  }

  function renderCheckoutSummary() {
    const box = $("#coLines");
    if (!box) return;
    box.innerHTML = cart.map((l) => {
      const p = byId(l.id);
      return `<div class="coline">
        <img src="${p.image}" alt="" data-tile="${p.tile}" data-fallback="${T.esc(p.name.charAt(0))}">
        <div><div>${T.esc(p.name)}</div>
          ${l.shade ? `<div class="coline__v">${T.esc(l.shade)} · Qty ${l.qty}</div>` : `<div class="coline__v">Qty ${l.qty}</div>`}</div>
        <strong>${money(p.price * l.qty)}</strong>
      </div>`;
    }).join("");
    const sub = cartSubtotal(), ship = shippingFor(sub);
    $("#coSub").textContent = money(sub);
    $("#coShip").textContent = ship ? money(ship) : "Free";
    $("#coTotal").textContent = money(sub + ship);
  }

  function openCheckout() {
    if (!cart.length) { toast("Your cart is empty", false); return; }
    closeAll();
    renderCheckoutSummary();
    $("#coFormState").style.display = "";
    $("#coDoneState").style.display = "none";
    openModal($("#checkoutModal"));
    track("begin_checkout", { currency: "PKR", value: cartSubtotal() });
  }

  function setErr(id, msg) {
    const f = $("#" + id);
    if (!f) return;
    f.classList.toggle("is-bad", !!msg);
    const e = $(`.err[data-for="${id}"]`);
    if (e) e.textContent = msg || "";
  }

  function validateCheckout() {
    let ok = true;
    const name = $("#coName").value.trim();
    const phone = $("#coPhone").value.trim();
    const city = $("#coCity").value.trim();
    const addr = $("#coAddress").value.trim();
    const email = $("#coEmail").value.trim();

    if (name.length < 3) { setErr("coName", "Please enter your full name."); ok = false; } else setErr("coName", "");
    if (!/^(\+92|0)?3\d{2}[\s-]?\d{7}$/.test(phone.replace(/\s/g, ""))) {
      setErr("coPhone", "Enter a valid Pakistani mobile number, e.g. 0322 0305000."); ok = false;
    } else setErr("coPhone", "");
    if (city.length < 2) { setErr("coCity", "Please enter your city."); ok = false; } else setErr("coCity", "");
    if (addr.length < 12) { setErr("coAddress", "Please give a complete address including area and landmark."); ok = false; } else setErr("coAddress", "");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setErr("coEmail", "That email does not look right."); ok = false; } else setErr("coEmail", "");
    return ok;
  }

  /* =========================================================
     FORM SUBMISSION
     Provider-aware: Web3Forms and Formspree use different reserved
     field names, and Web3Forms can return {success:false} inside a
     200 response — so checking res.ok alone is not enough.
     ========================================================= */
  function providerOf(url) {
    if (/web3forms\.com/i.test(url)) return "web3forms";
    if (/formspree\.io/i.test(url)) return "formspree";
    return "custom";
  }

  const endpointReady = () =>
    !!SITE.orderEndpoint &&
    (providerOf(SITE.orderEndpoint) !== "web3forms" || !!SITE.orderAccessKey);

  /* kind: order | contact | newsletter | review
     opts: { subject, replyTo } */
  async function submitForm(kind, fields, opts) {
    opts = opts || {};
    if (!endpointReady()) return { ok: false, reason: "not-configured" };

    const provider = providerOf(SITE.orderEndpoint);
    const body = Object.assign({ form_type: kind, site: SITE.name }, fields);

    if (provider === "web3forms") {
      body.access_key = SITE.orderAccessKey;
      if (opts.subject) body.subject = opts.subject;
      body.from_name = SITE.name;
      if (opts.replyTo) body.replyto = opts.replyTo;
      body.botcheck = "";                       // honeypot: must stay empty
    } else if (provider === "formspree") {
      if (opts.subject) body._subject = opts.subject;
      if (opts.replyTo) body._replyto = opts.replyTo;
    } else {
      if (opts.subject) body.subject = opts.subject;
      if (opts.replyTo) body.replyto = opts.replyTo;
      if (SITE.orderAccessKey) body.access_key = SITE.orderAccessKey;
    }

    try {
      const res = await fetch(SITE.orderEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      let json = null;
      try { json = await res.json(); } catch { /* some endpoints return no body */ }
      const ok = res.ok && !(json && json.success === false);
      return { ok, reason: ok ? "" : (json && json.message) || `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, reason: "network" };
    }
  }

  /* ---- Outbox -----------------------------------------------------------
     A submission that fails (offline, flaky mobile data, endpoint down) is
     queued and retried on the next page load, so an order is not lost just
     because the network dropped at the wrong moment.
  ---------------------------------------------------------------------- */
  function queueOutbox(kind, fields, opts) {
    const q = store.get("sgpk_outbox", []);
    q.push({ kind, fields, opts, at: Date.now() });
    store.set("sgpk_outbox", q.slice(-25));
  }

  async function flushOutbox() {
    if (!endpointReady()) return;
    const q = store.get("sgpk_outbox", []);
    if (!q.length) return;
    const keep = [];
    for (const item of q) {
      // Drop anything older than 14 days rather than retrying forever
      if (Date.now() - item.at > 12096e5) continue;
      const r = await submitForm(item.kind, item.fields, item.opts);
      if (!r.ok) keep.push(item);
    }
    store.set("sgpk_outbox", keep);
    if (q.length && !keep.length) console.info("[sgpk] queued submissions delivered");
  }

  /* Submit, and queue for retry if it fails. */
  async function submitOrQueue(kind, fields, opts) {
    const r = await submitForm(kind, fields, opts);
    if (!r.ok && r.reason !== "not-configured") queueOutbox(kind, fields, opts);
    return r;
  }

  function initCheckout() {
    on($("#checkoutBtn"), "click", openCheckout);
    on($("#coClose"), "click", () => closeModal($("#checkoutModal")));
    on($("#checkoutModal"), "click", (e) => { if (e.target.id === "checkoutModal") closeModal($("#checkoutModal")); });
    on($("#qvClose"), "click", () => closeModal($("#quickView")));
    on($("#quickView"), "click", (e) => { if (e.target.id === "quickView") closeModal($("#quickView")); });
    on($("#rvClose"), "click", () => closeModal($("#reviewModal")));
    on($("#reviewModal"), "click", (e) => { if (e.target.id === "reviewModal") closeModal($("#reviewModal")); });

    $$(".radio").forEach((r) =>
      on(r, "click", () => {
        $$(".radio").forEach((x) => x.classList.remove("is-on"));
        r.classList.add("is-on");
        r.querySelector("input").checked = true;
      })
    );

    on($("#coForm"), "submit", async (e) => {
      e.preventDefault();
      if (!validateCheckout()) return;

      const btn = $("#coSubmit");
      btn.disabled = true;
      btn.textContent = "Placing order…";

      const sub = cartSubtotal(), ship = shippingFor(sub);
      const order = {
        ref: orderRef(),
        placed: new Date().toISOString(),
        name: $("#coName").value.trim(),
        phone: $("#coPhone").value.trim(),
        email: $("#coEmail").value.trim(),
        city: $("#coCity").value.trim(),
        address: $("#coAddress").value.trim(),
        notes: $("#coNotes").value.trim(),
        payment: ($('input[name="pay"]:checked') || {}).value || "Cash on Delivery",
        items: cart.map((l) => {
          const p = byId(l.id);
          return { sku: p.sku, name: p.name, shade: l.shade, qty: l.qty, price: p.price };
        }),
        subtotal: sub, shipping: ship, total: sub + ship,
        status: "Received",
      };

      const itemLines = order.items
        .map((i) => `  • ${i.name}${i.shade ? " — " + i.shade : ""}  x${i.qty}  ${money(i.price * i.qty)}`)
        .join("\n");

      const result = await submitOrQueue("order", {
        order_ref: order.ref,
        customer: order.name,
        phone: order.phone,
        email: order.email || "(not given)",
        city: order.city,
        address: order.address,
        payment: order.payment,
        notes: order.notes || "(none)",
        items: itemLines,
        subtotal: money(order.subtotal),
        shipping: order.shipping ? money(order.shipping) : "Free",
        total: money(order.total),
        summary:
          `ORDER ${order.ref}\n` +
          `${order.name} · ${order.phone}\n` +
          `${order.address}, ${order.city}\n` +
          `Payment: ${order.payment}\n\n` +
          `${itemLines}\n\n` +
          `Subtotal ${money(order.subtotal)}\n` +
          `Delivery ${order.shipping ? money(order.shipping) : "Free"}\n` +
          `TOTAL    ${money(order.total)}`,
      }, {
        subject: `New order ${order.ref} — ${order.name} (${money(order.total)})`,
        replyTo: order.email || undefined,
      });
      const sent = result.ok;
      order.delivered = sent;

      /* Also append to the orders spreadsheet, if configured, so the admin
         portal can list and track it. Fire-and-forget: email above is the
         primary channel and the customer must not wait on this. */
      if (SITE.ordersApi) {
        fetch(SITE.ordersApi, {
          method: "POST",
          // Apps Script rejects a preflight, so keep this a simple request
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({
            ref: order.ref, placed: order.placed, name: order.name, phone: order.phone,
            email: order.email, city: order.city, address: order.address,
            payment: order.payment, notes: order.notes, items: order.items,
            subtotal: order.subtotal, shipping: order.shipping, total: order.total,
          }),
        }).catch((err) => console.warn("[sgpk] orders API unreachable", err));
      }

      orders = [order].concat(orders).slice(0, 30);
      store.set("sgpk_orders", orders);

      track("purchase", {
        transaction_id: order.ref, currency: "PKR", value: order.total, shipping: order.shipping,
        items: order.items.map((i) => ({ item_id: i.sku, item_name: i.name, quantity: i.qty, price: i.price })),
      });

      $("#coRef").textContent = order.ref;
      $("#coWa").href = waOrderURL(order);
      const warn = $("#coWarn");
      if (warn) {
        warn.style.display = sent ? "none" : "";
        warn.innerHTML = sent
          ? ""
          : result.reason === "not-configured"
            ? `<b>Please tap “Confirm on WhatsApp” below</b> so we receive your order.`
            : `We could not reach our system just now. Your order is saved and will send automatically, but <b>please tap “Confirm on WhatsApp”</b> to be sure.`;
      }

      cart = []; saveCart(); renderCart(); updateBadges();
      $("#coFormState").style.display = "none";
      $("#coDoneState").style.display = "";
      btn.disabled = false;
      btn.textContent = "Place order";
    });

    on($("#coContinue"), "click", () => closeModal($("#checkoutModal")));
  }

  /* ---------------------------------------------------------
     Track order page
     --------------------------------------------------------- */
  function initTracker() {
    if (PAGE !== "track") return;
    const form = $("#trackForm");
    on(form, "submit", (e) => {
      e.preventDefault();
      const ref = $("#trackRef").value.trim().toUpperCase();
      const box = $("#trackResult");
      const o = orders.find((x) => x.ref.toUpperCase() === ref);
      if (!o) {
        box.classList.add("is-on");
        box.innerHTML = `<h3 style="font-size:17px;margin-bottom:8px">We could not find that reference on this device</h3>
          <p style="color:var(--muted);font-size:14px;line-height:1.7">Order lookup works on the device the order was placed from.
          For any other order, send your reference to us on WhatsApp and we will check it for you.</p>
          <a class="btn btn--wa" style="margin-top:16px" target="_blank" rel="noopener"
             href="${waBase + encodeURIComponent(`Hello ${SITE.name}! Please check the status of my order: ${ref}`)}">
             ${T.brandIcon("whatsapp", 18)} Ask on WhatsApp</a>`;
        return;
      }
      box.classList.add("is-on");
      box.innerHTML = `
        <div class="tracker__row"><span>Reference</span><b>${T.esc(o.ref)}</b></div>
        <div class="tracker__row"><span>Placed</span><span>${new Date(o.placed).toLocaleString("en-GB")}</span></div>
        <div class="tracker__row"><span>Status</span><b style="color:var(--ok)">${T.esc(o.status)}</b></div>
        <div class="tracker__row"><span>Deliver to</span><span>${T.esc(o.name)}, ${T.esc(o.city)}</span></div>
        <div class="tracker__row"><span>Payment</span><span>${T.esc(o.payment)}</span></div>
        <div class="tracker__row"><span>Items</span><span>${o.items.reduce((s, i) => s + i.qty, 0)}</span></div>
        <div class="tracker__row"><span>Total</span><b>${money(o.total)}</b></div>
        <a class="btn btn--wa btn--block" style="margin-top:16px" target="_blank" rel="noopener"
           href="${waOrderURL(o)}">${T.brandIcon("whatsapp", 18)} Ask about this order</a>`;
    });
  }

  /* ---------------------------------------------------------
     Newsletter + contact
     --------------------------------------------------------- */
  function initForms() {
    const nf = $("#newsletterForm");
    on(nf, "submit", async (e) => {
      e.preventDefault();
      const email = $("#newsletterEmail").value.trim();
      const msg = $("#newsletterMsg");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        msg.style.color = "#ffc9c9";
        msg.textContent = "Please enter a valid email address.";
        return;
      }
      await submitOrQueue("newsletter", { email }, { subject: `Newsletter signup — ${email}`, replyTo: email });
      msg.style.color = "#c9f5dd";
      msg.textContent = "You're on the list — welcome to SHEGLAM PK.";
      nf.reset();
      track("generate_lead", { method: "newsletter" });
    });

    const cf = $("#contactForm");
    on(cf, "submit", async (e) => {
      e.preventDefault();
      let ok = true;
      const name = $("#ctName").value.trim(), email = $("#ctEmail").value.trim(),
            phone = $("#ctPhone").value.trim(), message = $("#ctMessage").value.trim();
      if (name.length < 2) { setErr("ctName", "Please enter your name."); ok = false; } else setErr("ctName", "");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setErr("ctEmail", "Enter a valid email."); ok = false; } else setErr("ctEmail", "");
      if (phone && !/^(\+92|0)?3\d{2}[\s-]?\d{7}$/.test(phone.replace(/\s/g, ""))) { setErr("ctPhone", "Enter a valid mobile number."); ok = false; } else setErr("ctPhone", "");
      if (message.length < 10) { setErr("ctMessage", "Please tell us a bit more."); ok = false; } else setErr("ctMessage", "");
      const msg = $("#contactMsg");
      if (!ok) { msg.style.color = "var(--err)"; msg.textContent = "Please fix the highlighted fields."; return; }

      const { ok: sent } = await submitOrQueue("contact",
        { name, email, phone: phone || "(not given)", message },
        { subject: `Contact form — ${name}`, replyTo: email });
      msg.style.color = sent ? "var(--ok)" : "var(--muted)";
      msg.textContent = sent
        ? "Thanks — we'll reply within one working day."
        : "Thanks! For the fastest reply, message us on WhatsApp.";
      cf.reset();
    });

    // FAQ accordions on content pages
    $$(".acc__btn").forEach((b) =>
      on(b, "click", () => b.parentElement.classList.toggle("is-open"))
    );
  }

  /* ---------------------------------------------------------
     Hero slider
     --------------------------------------------------------- */
  /* ---------------------------------------------------------
     Hero slider with video slides

     Rules that matter here:
     · only the active slide's video is ever playing
     · a slide's video is not even downloaded until it is needed
     · autoplay is best-effort — if the browser blocks it the poster
       stays and the slider keeps advancing on a timer
     --------------------------------------------------------- */
  function initHero() {
    const hero = $("#hero");
    const slides = $$(".hero__slide");
    if (!hero || !slides.length) return;

    const dots = $("#heroDots");
    const videos = slides.map((s) => $(".hero__video", s));
    const isMobile = () => window.matchMedia("(max-width:900px)").matches;
    let i = 0, timer = null, paused = false;

    const AUTOPLAY_MS = 7000;

    /* Point the element at the right file for this viewport, once. */
    function ensureSource(v) {
      if (!v) return;
      const wanted = (isMobile() && v.dataset.srcMobile) || v.dataset.src;
      if (!wanted) return;
      if (!v.getAttribute("src")) { v.preload = "auto"; v.src = wanted; }
      else if (!v.src.endsWith(wanted)) { v.src = wanted; }
    }

    /* Warm the next slide so switching does not stall on a cold fetch. */
    function preloadNeighbour(n) {
      const v = videos[(n + 1) % videos.length];
      if (v && !v.getAttribute("src")) { v.preload = "metadata"; v.src = (isMobile() && v.dataset.srcMobile) || v.dataset.src; }
    }

    function playActive() {
      videos.forEach((v, n) => {
        if (!v) return;
        if (n === i) {
          ensureSource(v);
          v.muted = true;                       // required for autoplay
          const p = v.play();
          if (p && p.catch) p.catch(() => { /* blocked: poster stays, slider still advances */ });
        } else {
          // Reset unconditionally: the browser may have paused this itself
          // (hidden tab, power saving), and we still want a clean restart.
          if (!v.paused) v.pause();
          if (v.currentTime) { try { v.currentTime = 0; } catch {} }
        }
      });
    }

    /* A play() issued before the file is decodable resolves into nothing.
       Retry once the browser says it can actually play, if still on screen. */
    videos.forEach((v, n) =>
      on(v, "canplay", () => {
        if (n === i && !paused && v.paused) {
          const p = v.play();
          if (p && p.catch) p.catch(() => {});
        }
      })
    );

    slides.forEach((_, n) => {
      const d = document.createElement("button");
      d.className = "hero__dot" + (n === 0 ? " is-active" : "");
      d.setAttribute("role", "tab");
      d.setAttribute("aria-label", "Slide " + (n + 1));
      d.setAttribute("aria-selected", String(n === 0));
      on(d, "click", () => { go(n); restart(); });
      dots.appendChild(d);
    });
    const allDots = $$(".hero__dot", dots);

    function go(n) {
      slides[i].classList.remove("is-active");
      allDots[i].classList.remove("is-active");
      allDots[i].setAttribute("aria-selected", "false");
      i = (n + slides.length) % slides.length;
      slides[i].classList.add("is-active");
      allDots[i].classList.add("is-active");
      allDots[i].setAttribute("aria-selected", "true");
      playActive();
      preloadNeighbour(i);
    }

    function restart() {
      clearInterval(timer);
      if (paused || slides.length < 2) return;
      timer = setInterval(() => go(i + 1), AUTOPLAY_MS);
    }

    on($("#heroNext"), "click", () => { go(i + 1); restart(); });
    on($("#heroPrev"), "click", () => { go(i - 1); restart(); });

    /* Pause on hover so a shopper reading the copy is not yanked away. */
    on(hero, "mouseenter", () => { paused = true; clearInterval(timer); });
    on(hero, "mouseleave", () => { paused = false; restart(); });

    /* Swipe on touch devices. */
    let x0 = null, y0 = null;
    on(hero, "touchstart", (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    on(hero, "touchend", (e) => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0;
      const dy = e.changedTouches[0].clientY - y0;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) { go(i + (dx < 0 ? 1 : -1)); restart(); }
      x0 = y0 = null;
    }, { passive: true });

    /* Nothing should play while the hero is scrolled away or the tab is hidden.
       The observer only ever *pauses* something it previously saw playing —
       its first callback can report "not intersecting" before layout settles,
       and acting on that would stop the video the moment it started. */
    if ("IntersectionObserver" in window) {
      let seenVisible = false;
      new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            seenVisible = true;
            playActive();
            restart();
          } else if (seenVisible) {
            clearInterval(timer);
            videos.forEach((v) => v && !v.paused && v.pause());
          }
        });
      }, { threshold: 0.15 }).observe(hero);
    }
    on(document, "visibilitychange", () => {
      if (document.hidden) { clearInterval(timer); videos.forEach((v) => v && !v.paused && v.pause()); }
      else { playActive(); restart(); }
    });

    /* Crossing the mobile/desktop boundary can mean a different file. */
    let wasMobile = isMobile();
    on(window, "resize", () => {
      if (isMobile() === wasMobile) return;
      wasMobile = isMobile();
      videos.forEach((v, n) => { if (v && n !== i) { v.removeAttribute("src"); v.preload = "none"; } });
      playActive();
    });

    /* Respect a reduced-motion preference: no autoplay, no auto-advance. */
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      paused = true;
      videos.forEach((v) => v && v.pause());
      return;
    }

    playActive();
    preloadNeighbour(0);
    restart();
  }

  /* ---------------------------------------------------------
     Image fallback — replaces broken photos with a branded tile
     --------------------------------------------------------- */
  /* A product photo that has not been shot yet (or fails to load) falls back
     to its generated studio tile rather than a broken image. */
  function initImageFallback() {
    document.addEventListener("error", (e) => {
      const el = e.target;
      if (el.tagName !== "IMG" || el.dataset.failed) return;
      el.dataset.failed = "1";
      if (el.dataset.tile) { el.src = el.dataset.tile; return; }
      const wrap = document.createElement("div");
      wrap.className = "card__fallback";
      wrap.innerHTML = `<span>${T.esc(el.dataset.fallback || "SG")}</span>`;
      if (el.parentElement) el.parentElement.appendChild(wrap);
      el.style.visibility = "hidden";
    }, true);
  }

  /* ---------------------------------------------------------
     Delegated clicks
     --------------------------------------------------------- */
  function initDelegates() {
    on(document, "click", (e) => {
      const add = e.target.closest(".js-add");
      const wish = e.target.closest(".js-wish");
      const quick = e.target.closest(".js-quick");
      const qty = e.target.closest(".js-qty");
      const rm = e.target.closest(".js-rm");
      const wrm = e.target.closest(".js-wish-rm");

      if (add) { e.preventDefault(); addToCart(+add.dataset.id, "", 1); }
      else if (wish) { e.preventDefault(); toggleWish(+wish.dataset.id); }
      else if (quick) { e.preventDefault(); openQuickView(+quick.dataset.id); }
      else if (qty) setQty(qty.dataset.key, +qty.dataset.d);
      else if (rm) removeLine(rm.dataset.key);
      else if (wrm) toggleWish(+wrm.dataset.id);
    });
  }

  /* ---------------------------------------------------------
     Boot
     --------------------------------------------------------- */
  function init() {
    initAnalytics();
    initImageFallback();
    initHeader();
    initTopbar();
    initSearch();
    initSearchPage();
    initDelegates();
    initListing();
    initPDP();
    initCheckout();
    initTracker();
    initForms();
    initHero();
    renderCart();
    renderWishlist();
    renderRecentlyViewed();
    updateBadges();
    syncWishButtons();
    flushOutbox();          // retry anything that failed to send earlier
    on(window, "online", flushOutbox);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
