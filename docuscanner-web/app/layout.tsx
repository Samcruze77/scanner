import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AnalyticsListener } from "@/components/analytics/AnalyticsListener";
import { PresenceHeartbeat } from "@/components/presence/PresenceHeartbeat";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { AuthModal } from "@/components/auth/AuthModal";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { MobileActionBar } from "@/components/layout/MobileActionBar";
import { THEME_INIT_SCRIPT } from "@/components/theme/theme";
import { getSiteUrl, SITE_DESCRIPTION, SITE_NAME } from "@/utils/seo/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// metadataBase makes every relative URL used below (canonical, Open Graph, the icon/
// opengraph-image routes) resolve against the real site address -- see utils/seo/site.ts
// for where that address comes from. Without it Next falls back to localhost, which is
// wrong in production.
//
// No title.template here on purpose: every page already writes its own full title
// ("Tools - PDFScanner", "Compress PDF - PDFScanner" ...), so a template would double
// up the site name instead of just filling in a gap. This plain title/description is
// what a page falls back to only if it defines none of its own (none currently do).
export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: `${SITE_NAME} - Free document scanning`,
  description: SITE_DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_US",
    title: `${SITE_NAME} - Free document scanning`,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} - Free document scanning`,
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: the inline script below sets data-theme before React loads.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Puts the saved (or system) theme on screen before the first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col overflow-x-hidden pb-16 sm:pb-0">
        <a
          href="#main"
          className="sr-only rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50"
        >
          Skip to content
        </a>
        <AnalyticsListener />
        <PresenceHeartbeat />
        <AuthProvider>
          <Header />
          {children}
          <Footer />
          <MobileActionBar />
          <AuthModal />
        </AuthProvider>
      </body>
    </html>
  );
}
