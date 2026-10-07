import type { Metadata } from "next";
import ShopPage, { PageHead, Crumbs, Icon } from "@/components/shop/ShopPage";
import { SITE, pageMeta } from "@/lib/shop";

export const metadata: Metadata = pageMeta({
  title: `Contact Us | ${SITE.name}`,
  description: `Get in touch with ${SITE.name}. WhatsApp ${SITE.phoneShow}, email ${SITE.email}, or send us a message — we reply within one working day.`,
  path: "/contact",
});

export default function Contact() {
  return (
    <ShopPage page="contact">
      <PageHead title="Contact us" sub="Questions about an order, a shade or a product? We answer our own messages." />
      <Crumbs items={[{ label: "Home", href: "/" }, { label: "Contact" }]} />
      <div className="container" style={{ padding: "44px 0 64px" }}>
        <div className="contactgrid">
          <div>
            <h2 style={{ fontSize: "20px", marginBottom: "10px" }}>Reach us directly</h2>
            <p style={{ color: "var(--muted)", fontSize: "14.5px", lineHeight: "1.7" }}>WhatsApp is by far the fastest — we usually reply within a couple of hours during the day.</p>
            <ul className="contactlist">
              <li>
                <span className="contactlist__icon"><Icon name="whatsapp" size={18} brand /></span>
                <span><strong>WhatsApp</strong><a href={`https://wa.me/${SITE.whatsapp}`} target="_blank" rel="noopener">{SITE.whatsappShow}</a></span>
              </li>
              <li>
                <span className="contactlist__icon"><Icon name="box" size={18} /></span>
                <span><strong>Email</strong><a href={`mailto:${SITE.email}`}>{SITE.email}</a></span>
              </li>
              <li>
                <span className="contactlist__icon"><Icon name="truck" size={18} /></span>
                <span><strong>Based in</strong><span>{SITE.address} — online only, no walk-in counter</span></span>
              </li>
            </ul>
            <div className="note" style={{ marginTop: "20px", background: "var(--bg-warm)", borderLeft: "3px solid var(--brand)", padding: "14px 18px", borderRadius: "0 8px 8px 0", fontSize: "14px" }}>
              <strong>Order enquiry?</strong> Have your order reference ready (it looks like SG-2601-ABCDE) and we can look it up straight away.
            </div>
            <h3 style={{ fontSize: "16px", margin: "26px 0 10px" }}>Hours</h3>
            <p style={{ color: "var(--muted)", fontSize: "14.5px" }}>Monday to Saturday, 10am – 8pm PKT. Messages sent on Sunday are answered Monday morning.</p>
          </div>

          <div className="formcard">
            <h2 style={{ fontSize: "18px", marginBottom: "6px" }}>Send a message</h2>
            <p style={{ color: "var(--muted)", fontSize: "14px", marginBottom: "20px" }}>We reply within one working day.</p>
            <form id="contactForm" noValidate>
              <div className="hp" aria-hidden="true"><label>Leave this empty <input type="text" name="website" tabIndex={-1} autoComplete="off" /></label></div>
              <div className="field">
                <label htmlFor="ctName">Your name</label>
                <input type="text" id="ctName" placeholder="Ayesha Khan" autoComplete="name" />
                <small className="err" data-for="ctName"></small>
              </div>
              <div className="field">
                <label htmlFor="ctEmail">Email</label>
                <input type="email" id="ctEmail" placeholder="you@example.com" autoComplete="email" />
                <small className="err" data-for="ctEmail"></small>
              </div>
              <div className="field">
                <label htmlFor="ctPhone">Mobile <span style={{ color: "var(--menu)", fontWeight: "400" }}>(optional)</span></label>
                <input type="tel" id="ctPhone" placeholder="0322 0305000" autoComplete="tel" />
                <small className="err" data-for="ctPhone"></small>
              </div>
              <div className="field">
                <label htmlFor="ctMessage">Message</label>
                <textarea id="ctMessage" rows={5} placeholder="How can we help?"></textarea>
                <small className="err" data-for="ctMessage"></small>
              </div>
              <button className="btn btn--primary btn--block" type="submit">Send message</button>
              <p className="formmsg" id="contactMsg" role="status" style={{ marginTop: "12px", fontSize: "14px", minHeight: "1.2em" }}></p>
            </form>
          </div>
        </div>
      </div>
    </ShopPage>
  );
}
