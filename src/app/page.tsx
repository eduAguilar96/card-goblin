import type { Metadata } from "next";
import HomePage from "@/app/_components/homePage";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";

/**
 * The landing page owns its full title (no "— Card Goblin" suffix) and carries
 * `SoftwareApplication` structured data, which is what lets a search result
 * show the app's category and price rather than a bare link.
 */
export const metadata: Metadata = {
  title: {
    absolute: `${SITE_NAME} — free print-and-play card generator for board game designers`,
  },
  description: SITE_DESCRIPTION,
  alternates: { canonical: SITE_URL },
};

const STRUCTURED_DATA = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: SITE_NAME,
  description: SITE_DESCRIPTION,
  url: SITE_URL,
  applicationCategory: "DesignApplication",
  operatingSystem: "Any (web browser)",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
});

export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: STRUCTURED_DATA }}
      />
      <HomePage />
    </>
  );
}
