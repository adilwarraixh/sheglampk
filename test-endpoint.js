/* =========================================================
   test-endpoint.js — verify order delivery actually works

   Sends one clearly-marked TEST submission to the endpoint
   configured in data/catalog.js, then tells you whether it
   was accepted. Check your inbox afterwards.

   Run:  node test-endpoint.js
   ========================================================= */
const { SITE } = require("./data/catalog.js");

const providerOf = (url) =>
  /web3forms\.com/i.test(url) ? "web3forms"
  : /formspree\.io/i.test(url) ? "formspree"
  : "custom";

function fail(msg, hint) {
  console.log(`\n✗ ${msg}`);
  if (hint) console.log(`\n${hint}`);
  process.exit(1);
}

(async () => {
  console.log("\nSHEGLAM PK — order endpoint test\n");

  if (!SITE.orderEndpoint) {
    fail("No endpoint configured.",
`data/catalog.js → SITE.orderEndpoint is empty, so orders currently reach you
ONLY when the customer taps "Confirm on WhatsApp".

To fix, in about a minute:
  1. Open https://web3forms.com
  2. Enter the email address you want orders sent to
  3. They email you an access key
  4. Put both into data/catalog.js:

       orderEndpoint:  "https://api.web3forms.com/submit",
       orderAccessKey: "paste-the-key-here",

  5. node test-endpoint.js
  6. node build.js`);
  }

  const provider = providerOf(SITE.orderEndpoint);
  console.log(`  endpoint : ${SITE.orderEndpoint}`);
  console.log(`  provider : ${provider}`);
  console.log(`  key      : ${SITE.orderAccessKey ? SITE.orderAccessKey.slice(0, 8) + "…" : "(none)"}\n`);

  if (provider === "web3forms" && !SITE.orderAccessKey) {
    fail("Web3Forms needs an access key.",
         "Set SITE.orderAccessKey in data/catalog.js to the key Web3Forms emailed you.");
  }

  const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  const body = {
    form_type: "test",
    site: SITE.name,
    order_ref: "SG-TEST-0000",
    customer: "Endpoint test",
    summary:
      `This is a TEST submission from test-endpoint.js at ${stamp}.\n` +
      `No customer placed this order — nothing to fulfil.\n\n` +
      `If you are reading this in your inbox, order delivery is working.`,
  };

  if (provider === "web3forms") {
    body.access_key = SITE.orderAccessKey;
    body.subject = `[TEST] ${SITE.name} order endpoint — ${stamp}`;
    body.from_name = SITE.name;
    body.botcheck = "";
  } else if (provider === "formspree") {
    body._subject = `[TEST] ${SITE.name} order endpoint — ${stamp}`;
  } else {
    body.subject = `[TEST] ${SITE.name} order endpoint — ${stamp}`;
    if (SITE.orderAccessKey) body.access_key = SITE.orderAccessKey;
  }

  let res, json = null;
  try {
    res = await fetch(SITE.orderEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    fail(`Could not reach the endpoint (${err.message}).`,
         "Check your internet connection and that the URL is correct.");
  }

  try { json = await res.json(); } catch { /* no JSON body */ }

  const ok = res.ok && !(json && json.success === false);

  if (!ok) {
    fail(`Endpoint rejected the submission — HTTP ${res.status}${json && json.message ? ` — ${json.message}` : ""}`,
`Common causes:
  · access key copied with a stray space, or not yet activated
  · the key belongs to a different endpoint
  · the email address on the Web3Forms account was never confirmed`);
  }

  console.log(`✓ Accepted — HTTP ${res.status}${json && json.message ? ` — ${json.message}` : ""}`);
  console.log(`\nNow check the inbox for the address you registered.`);
  console.log(`Look for: "[TEST] ${SITE.name} order endpoint — ${stamp}"`);
  console.log(`\nIf it does not arrive within a minute or two, check spam.`);
  console.log(`Once it lands, run: node build.js\n`);
})();
