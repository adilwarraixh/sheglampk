import ShopPage, { PageHead, Crumbs } from "@/components/shop/ShopPage";
import { SITE, pageMeta } from "@/lib/shop";

export const metadata = pageMeta({
  title: `Privacy Policy | ${SITE.name}`,
  description: "What personal data SHEGLAM PK collects, why we collect it, who we share it with, and how to have it deleted.",
  path: "/privacy",
});

export default function Privacy() {
  const mail = <a href={`mailto:${SITE.email}`}>{SITE.email}</a>;
  return (
    <ShopPage page="privacy" hideNewsletter>
      <PageHead title="Privacy policy" sub={`How ${SITE.name} handles your personal information.`} />
      <Crumbs items={[{ label: "Home", href: "/" }, { label: "Privacy" }]} />
      <div className="container--narrow prose">
        <p><em>Last updated: {new Date().toISOString().slice(0, 10)}</em></p>

        <h2>What we collect</h2>
        <ul>
          <li><strong>Order information</strong> — your name, mobile number, delivery address, city, and email if you provide one.</li>
          <li><strong>Contact messages</strong> — anything you send us through the contact form or WhatsApp.</li>
          <li><strong>Newsletter</strong> — your email address, if you sign up.</li>
          <li><strong>Reviews</strong> — the name, rating and words you submit, and an order reference if you give one. A review is published only after we have read it.</li>
          <li><strong>Usage data</strong> — the pages you visit and shop actions such as viewing a product, adding to cart and placing an order, recorded by the TikTok Pixel so we can measure our TikTok advertising.</li>
        </ul>

        <h2>What stays on your own device</h2>
        <p>Your cart, wishlist and recently viewed products are stored in your browser&apos;s local storage. They never leave your device and we cannot see them. Clearing your browser data will erase them. Your order details are not kept on your device: to check an order, use the Track Order page with your order reference and phone number.</p>

        <h2>Why we collect it</h2>
        <ul>
          <li>To pack, dispatch and deliver your order.</li>
          <li>To contact you about that order — confirmations, tracking, delivery issues.</li>
          <li>To answer questions you send us.</li>
          <li>To send marketing emails, but only if you subscribed. You can unsubscribe from any email.</li>
        </ul>

        <h2>Who we share it with</h2>
        <p>Only the parties needed to fulfil your order:</p>
        <ul>
          <li><strong>Courier companies</strong> — your name, address and phone number, so they can deliver the parcel.</li>
          <li><strong>Our email provider</strong> — sends your order confirmation, and tells us about new orders, messages and reviews.</li>
          <li><strong>TikTok</strong> — through the TikTok Pixel: the pages you view and the products you view, add to cart or order, with the order value, so we can measure and improve our TikTok ads. We do not send TikTok your name, phone number, email or address.</li>
        </ul>
        <p>We do not sell your data. We do not pass your number to other sellers.</p>

        <h2>Cookies and analytics</h2>
        <p>This site uses the TikTok Pixel, which sets cookies so TikTok can measure visits and the results of our ads. You can block cookies in your browser settings or limit ad tracking in your TikTok privacy settings; the shop will still work.</p>

        <h2>How long we keep it</h2>
        <p>Order records are kept for two years for accounting and warranty purposes. Contact messages are kept for one year. Newsletter subscriptions are kept until you unsubscribe.</p>

        <h2>Your rights</h2>
        <p>You can ask us to show you what we hold about you, correct it, or delete it. Email {mail} and we will action it within 30 days. Note that we cannot delete records we are legally required to retain for tax purposes.</p>

        <h2>Children</h2>
        <p>This site is not intended for anyone under 13, and we do not knowingly collect their data.</p>

        <h2>Changes</h2>
        <p>If this policy changes materially we will update the date at the top of this page.</p>

        <h2>Contact</h2>
        <p>Questions about privacy: {mail}.</p>
      </div>
    </ShopPage>
  );
}
