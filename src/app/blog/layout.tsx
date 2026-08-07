import type { ReactElement, ReactNode } from "react";
import SiteFooter from "@/app/_components/siteFooter";
import SiteHeader from "@/app/_components/siteHeader";

export default function BlogLayout({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  return (
    <div className="flex min-h-screen flex-col bg-gray-900 text-gray-300">
      <SiteHeader section="Blog" />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12 sm:px-6">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
