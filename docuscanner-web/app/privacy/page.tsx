import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { pageMetadata } from "@/utils/seo/metadata";

export const metadata: Metadata = pageMetadata({
  title: "Privacy Policy",
  description:
    "How FreePDFScanner.com collects, uses, shares and protects information, and the choices and rights available to you.",
  path: "/privacy",
});

// The legal text of this page is supplied by the site operator. Edit the
// content below (not the markup) to change the policy, and update the dates.
type Block = { p: string } | { h: string } | { ul: string[] };
interface PolicySection {
  title: string;
  blocks: Block[];
}

const EFFECTIVE = "September 30, 2026";
const UPDATED = "September 30, 2026";

const INTRO: string[] = [
  "FreePDFScanner.com (“FreePDFScanner”, “we”, “us”, or “our”) respects your privacy and is committed to protecting personal information you provide to us or that we collect when you use our website and services.",
  "This Privacy Policy explains what information we collect, how we use it, when we share it, how we protect it, and the choices and rights available to you.",
  "By using FreePDFScanner.com, you acknowledge that you have read this Privacy Policy. Where applicable law requires your consent for a particular processing activity, we will request that consent separately.",
  "Important: FreePDFScanner is designed to process documents efficiently while minimizing the amount of document information that we receive. Many document-processing functions are performed directly in your browser.",
];

const SECTIONS: PolicySection[] = [
  {
    title: "1. Who We Are",
    blocks: [
      { p: "FreePDFScanner.com is operated by:" },
      {
        ul: [
          "Legal/Business Name: S.O AJOSE TECH INTEGRATED SERVICE LTD",
          "Website: https://www.freepdfscanner.com",
          "Privacy Contact: info@freepdfscanner.com",
          "Support Contact: support@freepdfscanner.com",
        ],
      },
      { p: "For privacy questions, requests, complaints, or concerns about how your information is handled, contact us using the information above." },
    ],
  },
  {
    title: "2. Information We Collect",
    blocks: [
      { p: "The information we collect depends on how you use FreePDFScanner." },
      { h: "A. Information You Provide" },
      { p: "You may provide information when you:" },
      {
        ul: [
          "create or maintain an account;",
          "contact support;",
          "submit an inquiry;",
          "request assistance;",
          "save documents or use account-related features;",
          "interact with administrative or customer-support functionality.",
        ],
      },
      { p: "This information may include your email address, display name, account information, and other information you voluntarily provide." },
      { p: "We do not require you to create an account merely to use features that are designed to work without an account." },
      { h: "B. Documents and Files" },
      { p: "FreePDFScanner provides document scanning, PDF conversion, OCR, editing, and related tools." },
      { p: "Where a feature is designed for local browser processing, your document is processed on your device rather than uploaded to FreePDFScanner's servers." },
      { p: "We do not use locally processed document contents for advertising, behavioral profiling, or unrelated purposes." },
      {
        p: "Some features may require information to be transmitted to or stored by FreePDFScanner where that functionality is expressly provided, such as account-based saving or other services that require server-side processing. We will identify such functionality through the relevant user interface where reasonably practicable.",
      },
      { p: "You should not upload documents containing highly sensitive information unless you are comfortable using the particular feature and have reviewed the relevant disclosure." },
      { h: "C. Automatically Collected Technical Information" },
      { p: "When you use the website, certain technical information may be collected automatically, including where available:" },
      {
        ul: [
          "IP address or an IP-derived identifier;",
          "browser type;",
          "operating system;",
          "device type;",
          "language and locale;",
          "pages or paths visited;",
          "referring URL;",
          "timestamps;",
          "session and visitor identifiers;",
          "basic performance and diagnostic information;",
          "interactions with the website;",
          "approximate geographic information.",
        ],
      },
      { p: "We use this information primarily for security, analytics, troubleshooting, performance, service improvement, and advertising measurement." },
    ],
  },
  {
    title: "3. Approximate Location Information",
    blocks: [
      { p: "To understand where our visitors are located and to improve our services and advertising analytics, FreePDFScanner may process approximate location information derived from an IP address." },
      { p: "Depending on availability, this may include:" },
      {
        ul: [
          "country;",
          "state/province/region;",
          "city/town;",
          "postal code;",
          "county/district/local government area;",
          "other broader geographic information supplied by an approved location-enrichment provider.",
        ],
      },
      {
        p: "Vercel's request geolocation features can provide country, region, city, latitude/longitude and postal code from the requester's public IP address, and Vercel describes these values as approximate rather than precise location information.",
      },
      { p: "Where additional geographic information is obtained from a third-party enrichment provider, FreePDFScanner will use that information only for the purposes described in this Policy." },
      { p: "FreePDFScanner does not intentionally use IP-based geolocation to determine or publish your exact home address." },
      { p: "We do not intentionally collect GPS/device location from your device unless a particular feature clearly requests permission and you choose to provide it." },
    ],
  },
  {
    title: "4. How We Use Information",
    blocks: [
      { p: "We may use information we collect to:" },
      {
        ul: [
          "provide and operate FreePDFScanner;",
          "process documents and provide requested tools;",
          "create and manage user accounts;",
          "authenticate users;",
          "save documents where you request account-based storage;",
          "respond to support requests;",
          "monitor service reliability and security;",
          "detect abuse, fraud, malicious activity, and unauthorized access;",
          "understand website usage and improve functionality;",
          "measure advertising performance;",
          "understand aggregate visitor geography;",
          "generate analytics and reports for our administrators;",
          "maintain records required by law;",
          "enforce our Terms of Service;",
          "communicate important service or security information;",
          "protect our users, systems, and business.",
        ],
      },
      { p: "We do not use the contents of locally processed documents for unrelated advertising purposes." },
    ],
  },
  {
    title: "5. Legal Bases for Processing",
    blocks: [
      { p: "Depending on where you live and the processing activity involved, we may rely on one or more lawful bases, including:" },
      {
        ul: [
          "Performance of a contract — when processing is necessary to provide an account or requested service;",
          "Consent — where applicable law requires your consent;",
          "Legitimate interests — such as maintaining security, preventing abuse, improving the website, and understanding service usage, where those interests are not overridden by your rights;",
          "Legal obligations — where processing is necessary to comply with law, regulation, legal process, or lawful requests.",
        ],
      },
      { p: "Where we rely on consent, you may withdraw that consent, subject to applicable legal and technical limitations." },
    ],
  },
  {
    title: "6. Cookies and Similar Technologies",
    blocks: [
      { p: "FreePDFScanner may use cookies, local storage, pixels, scripts, or similar technologies." },
      { p: "We use these technologies for purposes such as:" },
      { h: "Essential technologies" },
      { p: "These may be necessary for:" },
      { ul: ["authentication;", "security;", "session management;", "remembering essential settings;", "fraud prevention;", "providing requested functionality."] },
      { h: "Analytics technologies" },
      { p: "Where enabled, analytics technologies help us understand:" },
      { ul: ["which pages are used;", "how visitors interact with the website;", "technical problems;", "general traffic patterns;", "website performance."] },
      { h: "Advertising technologies" },
      {
        p: "Where advertising is enabled, advertising partners may use cookies or similar technologies to measure advertisements, control frequency, understand campaign performance, or provide advertising that may be relevant to users.",
      },
      { p: "Non-essential cookies and similar technologies will be used subject to applicable law and any consent requirements that apply to you." },
      { p: "The UK Information Commissioner's Office states that visitors should be informed about cookies and that non-essential cookies generally require user agreement under applicable UK rules." },
    ],
  },
  {
    title: "7. Microsoft Clarity",
    blocks: [
      { p: "Where Microsoft Clarity is enabled on FreePDFScanner, we may use Clarity to understand how visitors interact with the website." },
      {
        p: "Clarity can process interaction and technical information such as clicks, scrolling, mouse movement, page events, diagnostic events and information used for session playback. Microsoft also provides masking controls intended to prevent sensitive content from being sent to Clarity.",
      },
      { p: "We use Clarity primarily to:" },
      {
        ul: [
          "understand how people use FreePDFScanner;",
          "identify usability problems;",
          "improve pages and features;",
          "understand navigation and engagement;",
          "improve website performance.",
        ],
      },
      { p: "FreePDFScanner does not intentionally configure Clarity to capture passwords, payment credentials, or other confidential information." },
      {
        p: "Where applicable law requires consent before Clarity cookies or similar technologies are used, we will obtain and communicate that consent through an appropriate consent mechanism. Microsoft states that explicit consent is required for Clarity cookies in the EEA, UK and Switzerland.",
      },
      { p: "Microsoft provides additional information about Clarity's privacy practices in its own documentation and privacy statement. Clarity data is hosted using Microsoft Azure infrastructure." },
    ],
  },
  {
    title: "8. Advertising",
    blocks: [
      { p: "FreePDFScanner may display advertisements through third-party advertising providers." },
      { p: "Advertising providers may receive or process information such as:" },
      {
        ul: [
          "device or browser information;",
          "approximate location;",
          "advertising identifiers;",
          "page or website interaction information;",
          "advertisement impressions and clicks;",
          "information needed to measure campaign performance.",
        ],
      },
      { p: "We do not intentionally provide advertisers with the contents of documents processed locally by FreePDFScanner." },
      { p: "Where an advertising provider uses cookies or similar technologies that require consent, those technologies will be subject to applicable consent requirements." },
      { p: "Because advertising providers can change over time, the specific providers active on the website may depend on the advertising configuration in use at a particular time." },
    ],
  },
  {
    title: "9. Third-Party Service Providers",
    blocks: [
      { p: "We use third-party providers to help operate FreePDFScanner." },
      { p: "These may include infrastructure, authentication, analytics, location, security, storage, communications, and advertising providers." },
      { p: "Examples may include:" },
      {
        ul: [
          "Supabase — authentication, database, and application infrastructure. Supabase publishes its own privacy policy describing its handling of personal information in connection with its services.",
          "Vercel — website hosting and application infrastructure. Vercel provides request-level geolocation information such as country, region, city and postal code based on public IP information.",
          "Microsoft Clarity — website behavior analytics where enabled.",
          "Location-enrichment providers — where enabled, an IP geolocation service may be used to provide additional approximate geographic information.",
        ],
      },
      { p: "Third-party providers may process information on our behalf or independently according to their own privacy policies and contractual arrangements." },
      { p: "We do not authorize service providers to use personal information for purposes unrelated to the services they provide to us, except where otherwise permitted or required by law." },
    ],
  },
  {
    title: "10. Information We Do Not Sell",
    blocks: [
      { p: "We do not sell your personal information as a standalone commercial product." },
      {
        p: "We may, however, use third-party advertising and analytics services that process certain website usage information. Depending on your jurisdiction, those activities may be subject to specific legal definitions concerning “sale,” “sharing,” targeted advertising, or similar concepts.",
      },
      { p: "Where those rights apply, we will provide the controls required by applicable law." },
    ],
  },
  {
    title: "11. Data Retention",
    blocks: [
      { p: "We retain information only for as long as reasonably necessary for the purposes described in this Policy, including to:" },
      {
        ul: [
          "provide requested services;",
          "maintain accounts;",
          "maintain security;",
          "resolve disputes;",
          "enforce agreements;",
          "comply with legal obligations;",
          "maintain legitimate business records.",
        ],
      },
      { p: "Retention periods depend on the type of information and why it was collected." },
      {
        p: "Where a fixed retention period is not appropriate, we use criteria such as the continued need to provide the service, security requirements, legal obligations, dispute-resolution requirements, and legitimate business needs.",
      },
      {
        p: "Third-party services may have their own retention periods. For example, Microsoft documents different retention periods for different categories of Clarity data; playback data is currently retained for 30 days, while certain aggregated or labeled data can be retained for longer periods.",
      },
      { p: "We periodically review information that is no longer required and delete, anonymize, or otherwise dispose of it where appropriate." },
    ],
  },
  {
    title: "12. Data Security",
    blocks: [
      { p: "We use reasonable technical and organizational safeguards designed to protect personal information against unauthorized access, alteration, disclosure, loss, or destruction." },
      { p: "These measures may include:" },
      {
        ul: [
          "access controls;",
          "authentication;",
          "encryption in transit;",
          "database security controls;",
          "role-based administrative permissions;",
          "security monitoring;",
          "restricted administrative access;",
          "hashing or other protective measures for certain technical identifiers.",
        ],
      },
      {
        p: "No internet-based service can guarantee absolute security. You should avoid submitting information to FreePDFScanner that you are not comfortable transmitting over the internet.",
      },
    ],
  },
  {
    title: "13. International Data Transfers",
    blocks: [
      { p: "FreePDFScanner and the third-party providers we use may process information in countries other than the country where you live." },
      {
        p: "Where personal information is transferred internationally, we take appropriate steps required by applicable data-protection law, which may include contractual safeguards, adequacy mechanisms, or other lawful transfer mechanisms.",
      },
      { p: "Microsoft states that Clarity data is hosted on Microsoft Azure and that cross-border transfer mechanisms may apply for relevant customers." },
    ],
  },
  {
    title: "14. Your Privacy Rights",
    blocks: [
      { p: "Depending on your location and applicable law, you may have rights including:" },
      {
        ul: [
          "the right to know what personal information we process;",
          "the right to request access to personal information;",
          "the right to request correction of inaccurate information;",
          "the right to request deletion;",
          "the right to request restriction of processing;",
          "the right to object to certain processing;",
          "the right to withdraw consent where processing is based on consent;",
          "the right to data portability where applicable;",
          "the right to opt out of certain advertising or data-sharing activities where applicable.",
        ],
      },
      { p: "Nigeria's data-protection framework recognizes data-subject rights and lawful processing requirements under the Nigeria Data Protection Act 2023." },
      {
        p: "For residents of California, applicable privacy law can provide additional rights, including rights to know, delete, correct, opt out of certain sale/sharing activities, limit certain sensitive-information uses, and receive equal treatment for exercising privacy rights.",
      },
      { p: "These rights are subject to applicable legal exceptions." },
      { p: "To submit a privacy request, contact:" },
      { p: "info@freepdfscanner.com" },
      { p: "We may need to verify your identity before completing certain requests in order to protect your information and prevent fraudulent requests." },
    ],
  },
  {
    title: "15. Children's Privacy",
    blocks: [
      { p: "FreePDFScanner is not intended to knowingly collect personal information from children in circumstances where doing so would violate applicable law." },
      {
        p: "Microsoft states that Clarity should not be used on websites or applications targeting users under 18. Accordingly, we will not intentionally use Microsoft Clarity as an analytics service for a website or experience specifically targeted at children under 18.",
      },
      { p: "If you believe that a child has provided personal information to us inappropriately, please contact us." },
    ],
  },
  {
    title: "16. Document Privacy",
    blocks: [
      { p: "FreePDFScanner may be used to process documents that contain personal, financial, business, educational, or other confidential information." },
      { p: "You are responsible for determining whether you are authorized to process a particular document through our service." },
      { p: "For features designed to process files locally in your browser:" },
      {
        ul: [
          "files are processed on your device;",
          "document contents are not intentionally uploaded to FreePDFScanner merely because you select a file;",
          "the document content is not intentionally used for advertising or behavioral profiling.",
        ],
      },
      {
        p: "Where a feature provides server-side saving, storage, sharing, or another function that requires transmission of your document, the relevant information may be transmitted and stored as necessary to provide that function.",
      },
    ],
  },
  {
    title: "17. Your Responsibilities",
    blocks: [
      { p: "You should:" },
      {
        ul: [
          "use FreePDFScanner only for lawful purposes;",
          "avoid uploading documents you are not authorized to process;",
          "protect your account credentials;",
          "log out of shared devices where appropriate;",
          "review downloaded files before sharing them;",
          "avoid entering passwords or highly sensitive information into analytics-visible fields.",
        ],
      },
    ],
  },
  {
    title: "18. Third-Party Websites",
    blocks: [
      { p: "FreePDFScanner may contain links to third-party websites, advertisements, services, or integrations." },
      { p: "We are not responsible for the privacy practices, security, or content of third-party websites." },
      { p: "You should review the privacy policies of those third parties before providing them with personal information." },
    ],
  },
  {
    title: "19. Changes to This Privacy Policy",
    blocks: [
      { p: "We may update this Privacy Policy from time to time to reflect changes in:" },
      { ul: ["the FreePDFScanner service;", "our data practices;", "third-party services;", "applicable law;", "security practices."] },
      { p: "When we make material changes, we will update the “Last Updated” date and, where appropriate, provide additional notice." },
      { p: "The current version will always be available at:" },
      { p: "https://www.freepdfscanner.com/privacy" },
      { p: "Privacy notices should be kept current and made readily accessible to users." },
    ],
  },
  {
    title: "20. Contact Us",
    blocks: [
      { p: "For questions, concerns, requests, or complaints regarding this Privacy Policy or your personal information:" },
      { ul: ["FreePDFScanner.com", "Privacy: info@freepdfscanner.com", "Support: support@freepdfscanner.com", "Website: https://www.freepdfscanner.com"] },
      {
        p: "For a formal privacy request, please include enough information for us to understand and respond to your request. We may ask for reasonable verification before disclosing or deleting personal information.",
      },
    ],
  },
];

// Turns email addresses and the site URL into links; everything else stays plain text.
const LINKABLE = /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|https?:\/\/[^\s)]+)/g;

function Text({ children }: { children: string }) {
  return (
    <>
      {children.split(LINKABLE).map((part, i) => {
        if (i % 2 === 0) return part;
        const href = part.includes("@") ? `mailto:${part}` : part;
        return (
          <a key={i} href={href} className="underline">
            {part}
          </a>
        );
      })}
    </>
  );
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((block, i) => {
        if ("h" in block) {
          return (
            <h3 key={i} className="pt-1 text-sm font-semibold text-inherit">
              {block.h}
            </h3>
          );
        }
        if ("ul" in block) {
          return (
            <ul key={i} className="list-disc space-y-1.5 pl-5">
              {block.ul.map((item) => (
                <li key={item}>
                  <Text>{item}</Text>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i}>
            <Text>{block.p}</Text>
          </p>
        );
      })}
    </>
  );
}

export default function PrivacyPage() {
  return (
    <PageShell>
      <PageHeader title="Privacy Policy">
        Effective Date: {EFFECTIVE} &middot; Last Updated: {UPDATED}
      </PageHeader>

      <div className="space-y-4">
        <section className="card p-5 sm:p-6">
          <div className="muted space-y-3 text-sm leading-6">
            {INTRO.map((text) => (
              <p key={text}>
                <Text>{text}</Text>
              </p>
            ))}
          </div>
        </section>

        {SECTIONS.map((section) => (
          <section key={section.title} className="card p-5 sm:p-6">
            <h2 className="section-title">{section.title}</h2>
            <div className="muted mt-3 space-y-3 text-sm leading-6">
              <Blocks blocks={section.blocks} />
            </div>
          </section>
        ))}
      </div>
    </PageShell>
  );
}
