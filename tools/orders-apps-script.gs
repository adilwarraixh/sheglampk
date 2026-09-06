/* =========================================================
   SHEGLAM PK — Orders API (Google Apps Script)

   Turns a Google Sheet into a free, serverless order database.
   Orders placed on the site are appended as rows; the admin portal
   reads them back with "Sync from site".

   ---------------------------------------------------------
   SETUP — about 5 minutes, no card, no hosting
   ---------------------------------------------------------
   1. Go to https://sheets.google.com and create a blank spreadsheet.
      Name it something like "SHEGLAM PK Orders".

   2. In that sheet: Extensions → Apps Script.
      Delete whatever is in the editor and paste this whole file in.

   3. At the top of this file, change SECRET_KEY to a long random
      string you invent. Anything hard to guess, e.g.
        var SECRET_KEY = "sgpk-8Kd92mFq7xTn4Lp0";

   4. Click Deploy → New deployment.
        Type            : Web app
        Description     : Orders API
        Execute as      : Me
        Who has access  : Anyone
      Click Deploy, then Authorize access and accept the prompts.
      (Google warns the app is unverified because you wrote it —
       choose Advanced → Go to … (unsafe). It is your own script.)

   5. Copy the Web app URL. It looks like
        https://script.google.com/macros/s/AKfy…/exec

   6. Put both values into data/catalog.js:
        ordersApi:    "the URL you copied"
        ordersApiKey: "the same SECRET_KEY string"

   7. Run:  node build.js
      Then in the admin portal, press "Sync from site".

   ---------------------------------------------------------
   NOTE ON THE KEY
   "Who has access: Anyone" is required because the shop is a static
   site with no login. SECRET_KEY is what actually protects the data:
   reads are refused without it. Writes are deliberately open so the
   checkout can post without shipping a secret in the page source —
   the worst case is junk rows, which you can delete.
   ========================================================= */

var SECRET_KEY = "CHANGE-ME-to-a-long-random-string";
var SHEET_NAME = "Orders";

var HEADERS = [
  "ref", "placed", "name", "phone", "email", "city", "address",
  "payment", "notes", "items", "subtotal", "shipping", "total", "status"
];

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
  }
  return sh;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------- WRITE: called by the shop's checkout ---------- */
function doPost(e) {
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }
    if (!body.ref) return json_({ ok: false, error: "missing ref" });

    var sh = sheet_();

    // Ignore a duplicate submission of the same reference
    var existing = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues();
    for (var i = 1; i < existing.length; i++) {
      if (String(existing[i][0]) === String(body.ref)) {
        return json_({ ok: true, duplicate: true });
      }
    }

    var items = "";
    if (Object.prototype.toString.call(body.items) === "[object Array]") {
      items = body.items.map(function (it) {
        return it.name + (it.shade ? " — " + it.shade : "") + " x" + it.qty + " @ " + it.price;
      }).join(" | ");
    } else {
      items = String(body.items || "");
    }

    sh.appendRow([
      body.ref, body.placed || new Date().toISOString(), body.name || "", body.phone || "",
      body.email || "", body.city || "", body.address || "", body.payment || "",
      body.notes || "", items, body.subtotal || "", body.shipping || "",
      body.total || "", "Received"
    ]);

    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/* ---------- READ: called by the admin portal ---------- */
function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    if (p.key !== SECRET_KEY) {
      return json_({ ok: false, error: "bad or missing key" });
    }
    if (p.action !== "list") {
      return json_({ ok: true, message: "Orders API is live. Use ?action=list&key=…" });
    }

    var sh = sheet_();
    var last = sh.getLastRow();
    if (last < 2) return json_({ ok: true, orders: [] });

    var values = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
    var orders = values.map(function (row) {
      var o = {};
      HEADERS.forEach(function (h, i) { o[h] = row[i]; });

      // Rebuild line items from the flattened text
      o.items = String(o.items || "").split(" | ").filter(String).map(function (s) {
        var m = s.match(/^(.*?)(?: — (.*?))? x(\d+) @ (\d+)$/);
        return m
          ? { name: m[1], shade: m[2] || "", qty: +m[3], price: +m[4] }
          : { name: s, shade: "", qty: 1, price: 0 };
      });

      o.total = +o.total || 0;
      o.subtotal = +o.subtotal || 0;
      o.shipping = +o.shipping || 0;
      if (o.placed instanceof Date) o.placed = o.placed.toISOString();
      return o;
    });

    return json_({ ok: true, orders: orders, count: orders.length });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}
