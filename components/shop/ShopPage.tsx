/* A shop page: the shared header, the page itself in <main>, the
   newsletter band, footer and overlays. The chrome is the same markup
   build.js gives generated pages (data/chrome.js), with clean links; the
   wrapper takes no space (display: contents), so the layout is unchanged.
   <main> carries the page context app.js reads. */
import { Fragment, type ReactNode } from "react";
import { C, T } from "@/lib/shop";

const Chrome = ({ html }: { html: string }) => (
  <div style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: C.cleanLinks(html) }} />
);

export default function ShopPage(o: { page: string; slug?: string; hideNewsletter?: boolean; children: ReactNode }) {
  return (
    <>
      <Chrome html={C.buildHeader(o.page, "/")} />
      <main id="main" data-page={o.page} data-base="/" data-slug={o.slug}>{o.children}</main>
      {!o.hideNewsletter && <Chrome html={C.buildNewsletter("/")} />}
      <Chrome html={C.buildFooter("/")} />
      <Chrome html={C.buildOverlays("/")} />
    </>
  );
}

/* JSON-LD, escaped so no value can end the script element. */
export const JsonLd = ({ data }: { data: object }) => (
  <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: C.scriptJson(data, 2) }} />
);

/* The page heading band and breadcrumbs, as content pages have them. */
export function PageHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <section className="pagehead">
      <div className="container">
        <h1>{title}</h1>
        {sub ? <p>{sub}</p> : null}
      </div>
    </section>
  );
}

export function Crumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <div className="container">
      <nav className="crumbs" aria-label="Breadcrumb">
        {items.map((it, i) =>
          i === items.length - 1
            ? <span key={i} aria-current="page">{it.label}</span>
            : <Fragment key={i}><a href={it.href}>{it.label}</a><span className="sep">/</span></Fragment>
        )}
      </nav>
    </div>
  );
}

/* An icon from data/templates.js (an inline SVG string). The wrapper takes
   no space; no style targets icons as direct children. */
export const Icon = ({ name, size, stroke, brand }: { name: string; size?: number; stroke?: number; brand?: boolean }) => (
  <span style={{ display: "contents" }}
    dangerouslySetInnerHTML={{ __html: brand ? T.brandIcon(name, size) : T.icon(name, size, stroke) }} />
);

/* A section heading with an optional "View all" link, as content.js sechead(). */
export function Sechead({ tag, title, link }: { tag?: string; title: string; link?: [string, string] }) {
  return (
    <div className="sechead">
      <div>{tag ? <span className="sechead__tag">{tag}</span> : null}<h2 className="sechead__title">{title}</h2></div>
      {link ? <a className="viewall" href={link[1]}>{link[0]} <Icon name="chevronR" size={15} /></a> : null}
    </div>
  );
}

/* Questions and answers; the first is open. Answers may hold links, so
   they are HTML written in this codebase (never customer text). */
export function Accordion({ items }: { items: { q: string; a: string }[] }) {
  return (
    <div className="acc">
      {items.map((it, i) => (
        <div key={i} className={"acc__item" + (i === 0 ? " is-open" : "")}>
          <button className="acc__btn" type="button">{it.q} <Icon name="plus" size={16} /></button>
          <div className="acc__body"><p dangerouslySetInnerHTML={{ __html: C.cleanLinks(it.a) }} /></div>
        </div>
      ))}
    </div>
  );
}

/* Product cards stay data/templates.js strings: app.js re-renders grids
   with the same function, so there is one card markup. */
export const Cards = ({ products }: { products: unknown[] }) => (
  <div className="grid" dangerouslySetInnerHTML={{ __html: C.cleanLinks(products.map((p) => T.card(p, "/")).join("")) }} />
);
