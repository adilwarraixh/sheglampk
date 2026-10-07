import type { Metadata } from "next";
import ShopPage, { PageHead, Crumbs } from "@/components/shop/ShopPage";
import { D, SITE, pageMeta } from "@/lib/shop";

export const metadata: Metadata = pageMeta({
  title: `Shipping & Delivery | ${SITE.name}`,
  description: `Delivery charges, timelines and courier information for orders across Pakistan. Free delivery over ${D.money(SITE.freeShippingOver)}, flat ${D.money(SITE.flatShipping)} otherwise.`,
  path: "/shipping",
});

export default function Shipping() {
  const free = D.money(SITE.freeShippingOver);
  return (
    <ShopPage page="shipping">
      <PageHead title="Shipping & delivery" sub="What it costs, how long it takes, and what happens if something goes wrong." />
      <Crumbs items={[{ label: "Home", href: "/" }, { label: "Shipping" }]} />
      <div className="container--narrow prose">
        <h2>Delivery charges</h2>
        <table>
          <thead><tr><th>Order value</th><th>Delivery charge</th></tr></thead>
          <tbody>
            <tr><td>{free} and above</td><td><strong>Free</strong></td></tr>
            <tr><td>Below {free}</td><td>{D.money(SITE.flatShipping)} flat, anywhere in Pakistan</td></tr>
          </tbody>
        </table>
        <p>There is no extra charge for choosing cash on delivery.</p>

        <h2>Delivery timelines</h2>
        <table>
          <thead><tr><th>Destination</th><th>Estimated delivery</th></tr></thead>
          <tbody>
            <tr><td>Lahore</td><td>2–3 working days</td></tr>
            <tr><td>Karachi &amp; Islamabad / Rawalpindi</td><td>2–3 working days</td></tr>
            <tr><td>Faisalabad, Multan, Peshawar, Sialkot, Gujranwala</td><td>3–4 working days</td></tr>
            <tr><td>All other cities and towns</td><td>3–5 working days</td></tr>
            <tr><td>Gilgit-Baltistan &amp; remote areas</td><td>5–8 working days</td></tr>
          </tbody>
        </table>
        <div className="note">Timelines start from dispatch, not from when you place the order. We dispatch within 1–2 working days of receiving an order.</div>

        <h2>Tracking</h2>
        <p>As soon as your parcel is booked with the courier we send the tracking number to your WhatsApp number. You can also look up your order any time on the <a href="/track-order">Track Order</a> page using the reference from your confirmation.</p>

        <h2>Payment method</h2>
        <p><strong>Cash on delivery</strong> is the only payment method we accept. You pay the courier when the parcel arrives — there is no advance payment and no extra fee. This applies to every order, everywhere in Pakistan.</p>

        <h2>If something goes wrong</h2>
        <ul>
          <li><strong>Parcel not arrived in the estimated window?</strong> Message us with your reference and we will chase the courier the same day.</li>
          <li><strong>Damaged in transit?</strong> Send photos within 48 hours of delivery and we will replace it free, including delivery charges.</li>
          <li><strong>Wrong item received?</strong> Same — photos within 48 hours and we make it right at our cost.</li>
          <li><strong>Refused or undelivered orders</strong> may mean we decline future orders from the same number or address. We are a small business and courier return charges are real.</li>
        </ul>

        <h2>Questions</h2>
        <p>WhatsApp <a href={`https://wa.me/${SITE.whatsapp}`} target="_blank" rel="noopener">{SITE.whatsappShow}</a> or email <a href={`mailto:${SITE.email}`}>{SITE.email}</a>.</p>
      </div>
    </ShopPage>
  );
}
