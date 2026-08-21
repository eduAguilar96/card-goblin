import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/local", () => ({
  default: () => ({ variable: "mock-font" }),
}));
import { metadata as rootMetadata } from "@/app/layout";
import { metadata as homeMetadata } from "@/app/page";
import { metadata as docsLayoutMetadata } from "@/app/docs/layout";
import { metadata as docsIndexMetadata } from "@/app/docs/page";
import { generateMetadata } from "@/app/docs/[slug]/page";
import { absoluteUrl, SITE_URL } from "@/lib/site";

describe("documentation metadata", () => {
  it("does not stamp the homepage canonical onto every route", () => {
    expect(rootMetadata.alternates?.canonical).toBeUndefined();
    expect(rootMetadata.openGraph?.url).toBeUndefined();
    expect(homeMetadata.alternates?.canonical).toBe(SITE_URL);
    expect(homeMetadata.openGraph?.url).toBe(SITE_URL);
  });

  it("uses one docs title template instead of double-branding the index", () => {
    expect(docsLayoutMetadata.title).toEqual({
      default: "Documentation",
      template: "%s — Card Goblin docs",
    });
  });

  it("gives the docs index its own canonical and share URL", () => {
    expect(docsIndexMetadata.alternates?.canonical).toBe(absoluteUrl("/docs"));
    expect(docsIndexMetadata.openGraph?.url).toBe(absoluteUrl("/docs"));
  });

  it("gives every wiki page a slug-specific canonical and share URL", async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: "quickstart" }),
    });
    const url = absoluteUrl("/docs/quickstart");

    expect(metadata.title).toBe("Quickstart");
    expect(metadata.alternates?.canonical).toBe(url);
    expect(metadata.openGraph?.url).toBe(url);
    expect(metadata.openGraph?.title).toBe("Quickstart — Card Goblin docs");
  });
});
