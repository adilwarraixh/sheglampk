/* test-import.js — CSV parsing, analysis and apply.
   Run: node test-import.js */
const P = __dirname.split(String.fromCharCode(92)).join("/");
const { sql } = require(P+"/db/client");
const I = require(P+"/lib/product-import.js");
const out=[]; const t=(l,c,x="")=>out.push(`${c?"✓":"✗"} ${l}${x?"  → "+x:""}`);
(async()=>{
  // 1. template reflects the live catalogue
  const tpl = await I.template();
  const tplRows = require(P+"/lib/csv.js").parse(tpl);
  t("template includes the current catalogue", tplRows.length === 14, `${tplRows.length-1} products + header`);

  // 2. analyse a file: 1 new, 1 update (by SKU), 1 error, 1 warning
  const file = [
    "Name,SKU,Price,Stock,Category,Subcategory,Status,Shades",
    "Brand New Gloss,CSV-NEW-1,1250,15,lips,Lip Gloss,published,Pink|Coral",
    "Camera On Smooth & Blur Primer,SGPK-001,2190,30,face,Primer,published,",   // exists -> update
    "Broken Price,CSV-BAD-1,not-a-number,5,face,Primer,published,",             // error
    "No Price Product,CSV-NEW-2,,8,face,Primer,published,",                     // warning -> DRAFT
    "Ghost Category,CSV-NEW-3,900,4,nonexistent,Primer,draft,",                 // warning
  ].join("\r\n");

  const a = await I.analyse(file);
  t("analysis classifies rows", a.summary.create===3 && a.summary.update===1 && a.summary.errors===1,
    `create=${a.summary.create} update=${a.summary.update} errors=${a.summary.errors}`);
  const upd = a.plan.find(p=>p.action==="update");
  t("matched the existing product on SKU", upd && upd.matchedOn==="SKU", upd && upd.existingName);
  const err = a.plan.find(p=>p.action==="error");
  t("bad price reported with the row number", err && err.row===4 && /not a number/.test(err.errors[0]), err && err.errors[0]);
  const noPrice = a.plan.find(p=>p.name==="No Price Product");
  t("published-without-price downgraded to DRAFT", noPrice.status==="DRAFT", noPrice.warnings[0]);
  const ghost = a.plan.find(p=>p.name==="Ghost Category");
  t("unknown category warned, not fatal", ghost.warnings.some(w=>/does not exist/.test(w)));
  t("analysis wrote nothing", (await sql`SELECT count(*)::int n FROM products WHERE sku LIKE 'CSV-%'`)[0].n===0);

  // 3. duplicate detection inside the file
  const dupes = "Name,SKU,Price\r\nA,DUP-1,100\r\nB,DUP-1,200\r\n";
  const da = await I.analyse(dupes);
  t("duplicate SKU inside the file caught", da.summary.errors===1, da.plan[1].errors[0]);

  // 4. apply
  const before = (await sql`SELECT count(*)::int n FROM products`)[0].n;
  const r = await I.apply(file);
  t("apply creates and updates", r.created===3 && r.updated===1, `created=${r.created} updated=${r.updated} skipped=${r.skipped}`);
  t("errored row skipped, not imported", r.skipped===1 && r.failed.length===0);
  const after = (await sql`SELECT count(*)::int n FROM products`)[0].n;
  t("product count moved by the created rows only", after===before+3, `${before} → ${after}`);

  const [priceCheck] = await sql`SELECT price FROM products WHERE sku='SGPK-001'`;
  t("existing product's price updated", Number(priceCheck.price)===2190, `Rs.${Number(priceCheck.price)}`);
  const [shades] = await sql`SELECT count(*)::int n FROM product_variants WHERE product_id=(SELECT id FROM products WHERE sku='CSV-NEW-1')`;
  t("shades created from the pipe-separated column", shades.n===2, `${shades.n} shades`);
  const [draft] = await sql`SELECT status, price FROM products WHERE sku='CSV-NEW-2'`;
  t("no-price row landed as DRAFT", draft.status==="DRAFT" && draft.price===null);

  // 5. a price-only update must not wipe existing shades
  const [target] = await sql`SELECT id FROM products WHERE sku='SGPK-002'`;
  const beforeShades = (await sql`SELECT count(*)::int n FROM product_variants WHERE product_id=${target.id}`)[0].n;
  await I.apply("Name,SKU,Price\r\nFall In Line Peel Off Lip Liner Stain,SGPK-002,1390\r\n");
  const afterShades = (await sql`SELECT count(*)::int n FROM product_variants WHERE product_id=${target.id}`)[0].n;
  t("price-only update preserves shades", beforeShades===afterShades && beforeShades===7, `${beforeShades} → ${afterShades}`);

  // cleanup
  await sql`DELETE FROM products WHERE sku LIKE 'CSV-%'`;
  await sql`UPDATE products SET price=2090 WHERE sku='SGPK-001'`;
  await sql`UPDATE products SET price=1290 WHERE sku='SGPK-002'`;
  const [final]=await sql`SELECT count(*)::int n FROM products`;
  t("cleaned up", final.n===13, `${final.n} products`);

  console.log(out.join("\n"));
  const f=out.filter(l=>l.startsWith("✗")).length;
  console.log(`\n${out.length-f} passed, ${f} failed`);
  process.exit(f?1:0);
})().catch(e=>{console.error("ERR",e.message,e.stack);process.exit(1);});
