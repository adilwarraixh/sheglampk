/* test-media.js — upload validation and serving.
   Run: node test-media.js */
const P = __dirname.split(String.fromCharCode(92)).join("/");
const fs=require("fs"), zlib=require("zlib");
const { sql } = require(P+"/db/client"); const auth = require(P+"/lib/auth");
const { snapshotCredentials, restoreCredentials } = require("./test-helpers.js");
function mockRes(){return{statusCode:200,headers:{},body:null,chunks:[],
  setHeader(k,v){this.headers[k.toLowerCase()]=v;},getHeader(k){return this.headers[k.toLowerCase()];},
  end(p){if(Buffer.isBuffer(p)){this.raw=p;}else{try{this.body=JSON.parse(p);}catch{this.body=p;}}}};}
async function call(mod,{method="GET",cookie,csrf,query={},body,headers={}}={}){const res=mockRes();
  await require(P+mod)({method,url:"/",headers:{cookie:cookie||"",...(csrf?{"x-csrf-token":csrf}:{}),...headers},
    socket:{remoteAddress:"127.0.0.1"},query,body,on(){}},res);return res;}

const b64=b=>b.toString("base64");
(async()=>{
  const mk=async u=>{const [r]=await sql`SELECT id FROM users WHERE username=${u}`;
    await sql`UPDATE users SET must_change_password=false WHERE id=${r.id}`;
    const s=await auth.createSession(r.id,{ip:"127.0.0.1",userAgent:"mtest"});
    return {cookie:`sgpk_session=${s.token}`,csrf:s.csrf,token:s.token};};
  const savedCredentials = await snapshotCredentials();
  const U=await mk("umama"), A=await mk("ashba");
  const R={up:"/api/admin/upload.js", get:"/api/media/[id].js"};
  const out=[]; const t=(l,c,x="")=>out.push(`${c?"✓":"✗"} ${l}${x?"  → "+x:""}`);

  const realPng = fs.readFileSync(P+"/assets/img/products/01-camera-on-smooth-and-blur-primer-clear.png");

  // 1. a genuine PNG is accepted
  const good=await call(R.up,{method:"POST",cookie:U.cookie,csrf:U.csrf,body:{data:b64(realPng),filename:"photo.png"}});
  t("real PNG accepted",good.statusCode===200&&good.body.media.mime==="image/png",
    `${good.body.media&&good.body.media.width}x${good.body.media&&good.body.media.height}`);
  const mediaId=good.body.media.id;

  // 2. HTML disguised as a .png with an image content-type
  const html=Buffer.from("<html><script>alert(document.cookie)</script></html>");
  const evil=await call(R.up,{method:"POST",cookie:U.cookie,csrf:U.csrf,body:{data:b64(html),filename:"evil.png"}});
  t("HTML named .png REFUSED",evil.statusCode===400,evil.body.error);

  // 3. SVG with script
  const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const svgRes=await call(R.up,{method:"POST",cookie:U.cookie,csrf:U.csrf,body:{data:b64(svg),filename:"logo.svg"}});
  t("SVG REFUSED",svgRes.statusCode===400,svgRes.body.error.slice(0,60));

  // 4. a PHP/script payload with a PNG magic-byte prefix is still not a valid image? 
  //    (prefix makes it detect as PNG — check it is stored as image/png and served as such)
  const polyglot=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from("<?php system($_GET['c']); ?>")]);
  const poly=await call(R.up,{method:"POST",cookie:U.cookie,csrf:U.csrf,body:{data:b64(polyglot),filename:"shell.php.png"}});
  if(poly.statusCode===200){
    const served=await call(R.get,{query:{id:String(poly.body.media.id)}});
    t("PNG-prefixed payload served as image/png with nosniff",
      served.getHeader("content-type")==="image/png"&&served.getHeader("x-content-type-options")==="nosniff",
      `type=${served.getHeader("content-type")} nosniff=${served.getHeader("x-content-type-options")}`);
    t("filename sanitised, no path or double extension executed",
      /^shell.php.png$/.test(poly.body.media.filename),poly.body.media.filename);
    await sql`DELETE FROM media WHERE id=${poly.body.media.id}`;
  } else t("PNG-prefixed payload handled",true,"refused: "+poly.body.error);

  // 5. oversize
  const big=Buffer.alloc(4*1024*1024); realPng.copy(big);
  const over=await call(R.up,{method:"POST",cookie:U.cookie,csrf:U.csrf,body:{data:b64(big),filename:"big.png"}});
  t("oversize REFUSED",over.statusCode===400,over.body.error);

  // 6. path traversal in the filename
  const trav=await call(R.up,{method:"POST",cookie:U.cookie,csrf:U.csrf,
    body:{data:b64(fs.readFileSync(P+"/assets/img/products/05-lashlighter-up-and-out-mascara.png")),filename:"../../../../etc/passwd.png"}});
  t("path traversal stripped from filename",trav.statusCode===200&&!trav.body.media.filename.includes("/")&&!trav.body.media.filename.includes(".."),
    trav.body.media&&trav.body.media.filename);
  const travId=trav.body.media.id;

  // 7. deduplication
  const dupe=await call(R.up,{method:"POST",cookie:U.cookie,csrf:U.csrf,body:{data:b64(realPng),filename:"again.png"}});
  t("same bytes deduplicated",dupe.body.media.id===mediaId&&dupe.body.media.deduped===true);

  // 8. RBAC
  const aUp=await call(R.up,{method:"POST",cookie:A.cookie,csrf:A.csrf,body:{data:b64(realPng),filename:"x.png"}});
  t("ashba CANNOT upload → 403",aUp.statusCode===403,String(aUp.statusCode));
  t("upload without CSRF → 403",
    (await call(R.up,{method:"POST",cookie:U.cookie,body:{data:b64(realPng),filename:"x.png"}})).statusCode===403);

  // 9. serving
  const served=await call(R.get,{query:{id:String(mediaId)}});
  t("image served with correct bytes",served.raw&&served.raw.length===realPng.length&&served.raw.equals(realPng));
  t("served immutable + nosniff",/immutable/.test(served.getHeader("cache-control"))&&served.getHeader("x-content-type-options")==="nosniff");
  const etag=served.getHeader("etag");
  const cached=await call(R.get,{query:{id:String(mediaId)},headers:{"if-none-match":etag}});
  t("ETag revalidation returns 304",cached.statusCode===304);
  t("missing image → 404",(await call(R.get,{query:{id:"99999999"}})).statusCode===404);

  // 10. cannot delete while a product uses it
  await sql`INSERT INTO product_images (product_id, url, position, is_primary)
            VALUES ((SELECT id FROM products LIMIT 1), ${'/api/media/'+mediaId}, 99, false)`;
  const del=await call(R.up,{method:"DELETE",cookie:U.cookie,csrf:U.csrf,query:{id:String(mediaId)}});
  t("cannot delete an image a product still uses",del.statusCode===400,del.body.error);
  await sql`DELETE FROM product_images WHERE url=${'/api/media/'+mediaId}`;
  const del2=await call(R.up,{method:"DELETE",cookie:U.cookie,csrf:U.csrf,query:{id:String(mediaId)}});
  t("delete works once unreferenced",del2.statusCode===200);

  await sql`DELETE FROM media WHERE id=${travId}`;
  await auth.revokeSession(U.token); await auth.revokeSession(A.token);
  await restoreCredentials(savedCredentials);
  console.log(out.join("\n"));
  const f=out.filter(l=>l.startsWith("✗")).length;
  console.log(`\n${out.length-f} passed, ${f} failed`);
  process.exit(f?1:0);
})().catch(e=>{console.error("ERR",e.message,e.stack);process.exit(1);});
