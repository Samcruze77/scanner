import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { pageMetadata } from "@/utils/seo/metadata";

export const metadata: Metadata = pageMetadata({
  title: "Privacy Policy",
  description:
    "What PDFScanner collects, why, who processes it, and the choices you have. Your files are processed in your browser and are not uploaded unless you choose to save them to your account.",
  path: "/privacy",
});

const UPDATED = "30 September 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-5 sm:p-6">
      <h2 className="section-title">{title}</h2>
      <div className="muted mt-3 space-y-3 text-sm leading-6">{children}</div>
    </section>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export default function PrivacyPage() {
  return (
    <PageShell>
      <PageHeader title="Privacy Policy">
        How PDFScanner (freepdfscanner.com) handles information. Last updated {UPDATED}.
      </PageHeader>

      <div className="space-y-4">
        <Section title="The short version">
          <List
            items={[
              "Your documents are processed in your browser and are not uploaded. A finished file is stored only if you sign in and choose to save it to your account.",
              "We measure how the site is used with an anonymous visitor ID, not your name. We record approximate location (country, region, city) derived from your IP address, but we do not store your IP address.",
              "The site is free and supported by ads. We count ad views and clicks so advertisers can be told how their ads performed.",
              "We do not sell your personal information.",
            ]}
          />
        </Section>

        <Section title="Your files">
          <p>
            Scanning, editing, signing, OCR, compression and conversion run in your browser on your device. The contents of
            your documents are not sent to our servers for these tools.
          </p>
          <p>
            If you are signed in and choose &ldquo;Save to account&rdquo;, the finished PDF is stored for you in our storage
            provider so you can find it in your history. You can remove saved documents, and you can ask us to delete them
            (see &ldquo;Your choices&rdquo;).
          </p>
          <p>Some preferences, such as your theme or a saved signature, are kept in your browser&apos;s local storage on your device.</p>
        </Section>

        <Section title="Account information">
          <p>
            If you create an account we collect your email address and a password (stored only as a one-way hash by our
            authentication provider), and, if you provide one, a display name. We use this to sign you in, reset your
            password, and show your saved documents.
          </p>
        </Section>

        <Section title="Usage analytics">
          <p>To understand which tools are used and to keep the site working, our own analytics records:</p>
          <List
            items={[
              "an anonymous visitor ID (stored in your browser’s local storage) and a session ID that changes after about 30 minutes of inactivity",
              "events such as page views, starting or finishing a scan or conversion, downloading a document, signing up, signing in, feature use and errors, with the page path and referring page",
              "your device type, browser and operating system, taken from your browser’s user-agent",
              "approximate location: country, state or province, city and postal code, and, where our location provider supplies them, county or district and neighbourhood or suburb",
              "if you are signed in, your account ID, so activity can be tied to your account",
              "which page or tool is currently open in a session (a periodic presence signal)",
              "a one-way hash of your IP address, used only to limit abuse. We do not store the IP address itself.",
            ]}
          />
          <p>Analytics never includes the contents of your documents.</p>
        </Section>

        <Section title="Location">
          <p>
            Location is approximate and comes from your IP address. It is derived on our servers by our hosting provider
            (Vercel) and, if we have turned it on, by a third-party IP geolocation service that we send your IP address to
            for the lookup only (currently IP2Location). We keep only the resulting place names, not the IP address, and we
            do not store coordinates. We never ask your browser for your GPS position.
          </p>
          <p>IP-based location can be wrong, and it does not identify your street or home.</p>
        </Section>

        <Section title="Advertising">
          <p>
            PDFScanner is supported by ads that we place and manage ourselves. When an ad is shown or clicked we record the
            campaign and ad slot, the page, your session ID, device type and approximate location, so we can report results
            to advertisers. We do not tell advertisers who you are.
          </p>
          <p>
            Some ads embed video from YouTube or Vimeo. If you play one, that provider may set its own cookies and collect
            information under its own privacy policy. Clicking an ad takes you to the advertiser&apos;s site, which has its
            own policy.
          </p>
        </Section>

        <Section title="Session analytics from Microsoft Clarity">
          <p>
            If enabled, we use Microsoft Clarity to understand how pages are used (for example clicks, scrolling and
            heatmaps) and to cross-check our own analytics. Clarity is operated by Microsoft under the Microsoft Privacy
            Statement.
          </p>
        </Section>

        <Section title="Who processes your information">
          <List
            items={[
              "Vercel: hosting and network delivery of the website",
              "Supabase: database, sign-in and storage for accounts, analytics and saved documents",
              "An IP geolocation provider (currently IP2Location, if enabled): receives your IP address to return approximate location",
              "Microsoft Clarity (if enabled): usage recordings and heatmaps",
              "Video providers (YouTube, Vimeo) only when you play an embedded video ad",
            ]}
          />
          <p>We may also disclose information if the law requires it.</p>
        </Section>

        <Section title="Who can see analytics">
          <p>
            A small number of PDFScanner administrators can view aggregated analytics and download reports (including
            location breakdowns). Reports can include visitor and session identifiers but not IP addresses or document
            contents. Administrator actions, including report downloads, are recorded in an audit log.
          </p>
        </Section>

        <Section title="How long we keep information">
          <p>
            We keep analytics for as long as we need them for reporting and to run the service. Saved documents are kept
            until you delete them or ask us to. Account details are kept while your account exists. When information is no
            longer needed we delete it or remove what identifies you.
          </p>
        </Section>

        <Section title="Your choices">
          <List
            items={[
              "Clearing your browser’s site data resets your anonymous visitor ID.",
              "You can block scripts and storage in your browser settings; the tools continue to work, though some features (like saved signatures) may not persist.",
              "To access, correct or delete information linked to your account, or to delete saved documents, email support@freepdfscanner.com.",
              "Depending on where you live you may have additional rights over your personal information. Contact us and we will help.",
            ]}
          />
        </Section>

        <Section title="Children">
          <p>PDFScanner is not directed at children under 13, and we do not knowingly collect their personal information.</p>
        </Section>

        <Section title="Changes and contact">
          <p>
            We will update this page when our practices change and change the date above. Questions:{" "}
            <a href="mailto:support@freepdfscanner.com" className="underline">
              support@freepdfscanner.com
            </a>{" "}
            or{" "}
            <a href="mailto:info@freepdfscanner.com" className="underline">
              info@freepdfscanner.com
            </a>
            .
          </p>
        </Section>
      </div>
    </PageShell>
  );
}
