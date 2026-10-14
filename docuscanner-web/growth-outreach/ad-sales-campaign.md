# FreePDFScanner advertising sales campaign - research and drafts for approval

Prepared 2026-10-12. **Nothing has been sent, submitted, booked or promised.** Every email below is a draft awaiting your explicit approval.

**Revision 2026-10-13 (final drafts):** Drafts 1-3 (Internxt, SignWell, MyJobMag) are finalised with your sign-off and **await your final approval**; routes were rechecked on 2026-10-13. Internxt and SignWell are separate partnership/affiliate enquiries, MyJobMag an exploratory editorial/cross-promotion idea. Jobberman and AbSApp are deferred. The free 14-day Founding Advertiser Pilot is defined in section C and is not mentioned in the three drafts. Still nothing sent.

Labels used throughout: **[Verified]** = seen on an official page or in your own database today (source given). **[Estimate]** = my judgement. **[Unverified]** = could not confirm.

---

## A. Executive summary

**The honest headline: today's traffic is too small to sell display advertising to most of the companies on your list.**

Your own analytics (Supabase `analytics_events`, queried 2026-10-12, aggregate counts only) show:

| Measure | Value | Notes |
|---|---|---|
| Tracking started | 2026-09-18 | No history before this |
| Page views, whole period (all <= 30 days) | 8,140 from 1,449 visitor IDs | **Inflated**: week of 2026-09-21 alone had 6,176 views / 1,212 visitor IDs, 99% desktop, mostly no country. That pattern looks like bots, testing or a one-off spike, not buyers' audience. |
| Last 7 days | 842 views, 109 visitor IDs, 188 sessions | |
| Last 14 days | 1,553 views, 233 visitor IDs | 228 of those views are `/admin*` (you), 610 are on tool/scan/convert pages |
| Mobile share, last 14 days | 0 | Device detection may be wrong, or mobile traffic is nil. Needs checking before quoting any mobile placement. |
| Identified countries (30 days, views) | NG 670, IN 160, US 151, ID 97 | NG is probably inflated by your own testing; few visitors per country (35 / 51 / 37 / 18) |
| Top referrers | direct, Bing, Yahoo, DuckDuckGo | small search trickle |
| Ad delivery to date | 2 ad events, both from an archived "QA Tester" campaign | **No real advertiser has ever run.** No CTR or delivery history exists. |

Realistic reading: roughly 100 genuine unique visitors a week. Do not present any number above to an advertiser as an audience claim without cleaning it (excluding admin, localhost and bot traffic) and dating it.

**What this means for strategy**
1. A job board with "1M+" visitors (Jobberman, MyJobMag) or a bank is very unlikely to buy a banner on a site this size. They are listed because the audience *topic* fits, but I rank them Tier 2/3.
2. The first paying relationships are most likely to be **performance (pay-per-result) partners** - e-signature, cloud storage, resume tools - who already pay publishers per sale and carry no risk on small traffic. These are not "ad purchases", so revenue per month will be small until traffic grows. [Estimate]
3. A flat-fee **Founding Advertiser pilot** with a small, local or early-stage company is the best route to a first *paying* advertiser, and to real impression/click data you can reuse in later pitches.
4. Traffic growth (your SEO plan in `30-day-growth-plan.md`) will do more for ad revenue than any outreach this month. I would not send enterprise outreach until you have 8 or more weeks of clean analytics.

**Missing information that would strengthen the pitch** is listed in section C.

---

## Audit: what advertising inventory actually exists

Source: the code ([components/ads/AdSlot.tsx](../components/ads/AdSlot.tsx), [components/layout/PageShell.tsx](../components/layout/PageShell.tsx), [utils/admin/ads.ts](../utils/admin/ads.ts)) and the `ad_campaigns` table. [Verified]

| Slot | Size | Where it appears |
|---|---|---|
| `top` | full-width banner, 64px tall (80px from the `sm` breakpoint) | "Content" pages only |
| `side` | 300x250 medium rectangle (max 336 wide on small screens) | "Content" pages with wide layout, desktop right rail; drops below content on mobile |
| `bottom` | full-width banner, 64 / 80px tall | **Every** page using the shared page frame |
| `inline` | full-width, 80 / 96px tall | Available in code; no page found using it |

- "Workflow" pages (`/scan`, every `/tools/*`, every `/convert/*`) show **only the bottom banner**, deliberately below the work. These carry about 610 of 1,553 views in the last 14 days, so most of your traffic sees only one slot.
- "Content" pages (home, `/tools`, `/convert`, `/guides`, `/history`, the landing pages such as `/jpg-to-pdf`) can show top + side + bottom.
- Formats supported: image or self-hosted MP4/WebM, or a YouTube/Vimeo embed (embed only plays with advertising cookie consent). Click-through opens in a new tab with `rel="sponsored"`.
- Targeting that **exists in the system**: country, region, exact page path, device (all / desktop / mobile), day-of-week and time window, priority weight, frequency cap per session. Reporting that exists: impressions, clicks, CTR, by slot, device, country, region, path, daily (admin dashboard).
- Targeting that is **not safe to promise yet**: country/region (about 14% of recent views have no country, and the spike data is unreliable), device (mobile is reading as 0%), audience/behavioural/demographic (does not exist).
- Always labelled "Advertisement", never fixed or overlaying content (your policy; a selling point for privacy-conscious advertisers).
- Open questions I could not verify from code alone: whether impressions are recorded for visitors who decline advertising consent (the consent layer gates some storage). Confirm before promising "full" reporting.

---

## B. Prospect database

Only prospects with at least one **verified** way to reach the company are listed. I found far fewer than 30 genuine ones; I did not pad the list. Contact names: **none verified**. I did not find a named, publicly listed advertising decision-maker for any company, so every route below is a company role mailbox or form. I have not invented names, titles or LinkedIn URLs.

Budget category is an [Estimate] unless stated.

### Tier 1 - realistic now (performance partners and a first pilot)

| # | Company | Market / Industry | Why it fits | Verified route (source) | Offer to pitch | Budget [Est.] | Priority |
|---|---|---|---|---|---|---|---|
| 1 | **Internxt** | Spain / privacy cloud storage | Users scan and store documents; privacy-first brand matches your "files never leave your device" story | affiliates@internxt.com; affiliate page states 30% on annual plans, 15% on lifetime, 30-day cookie, "affiliate manager will get back to you in about 24 hours" ([internxt.com/affiliates](https://internxt.com/affiliates)) | Performance placement in a Tools/Guides page (not a flat fee) | Performance only | High |
| 2 | **SignWell** | US / e-signature | You already have sign-PDF tools; direct audience overlap | Partner form only, no email shown ([referral program](https://signwell.com/referral-program), [partner form](https://www.signwell.com/partner-with-signwell-contact/)). 25% recurring for up to one year. **No Google/Bing paid ads allowed** - they do not restrict a publisher's own page placements, but read their terms first. | Performance placement on `/tools/sign-pdf` | Performance only | High |
| 3 | **MyJobMag** | Nigeria / job board | CV and document handling for job seekers | services@myjobmag.com, phone 08121633133, contact form, "Talk to Sales" ([contact](https://www.myjobmag.com/contact), [advertise page](https://www.myjobmag.com/advertise)). Their own media kit PDF: /files/advertise-nigeria.pdf | Sponsored placement or content swap. They *sell* ads, so they are more naturally a **partner/cross-promotion** than a buyer. | Medium | Medium |
| 4 | **Jobberman** (One Africa Media) - **DEFERRED** until clean analytics and stronger traffic evidence exist | Nigeria / job board | Same audience overlap | sales@jobberman.com listed as Sales/Business Development; info@jobberman.com general ([contact page](https://www.jobberman.com/contact-us)). 2024 banner rate card exists ([PDF](https://static.jobberman.com/banner-rate-card-nigeria.pdf)); I could not extract its text, so **no rates verified**. | Content/link partnership first; paid ad is unlikely at current traffic | Large | Medium |
| 5 | **AbSApp (AbS Technology)** - **DEFERRED** until clean analytics and stronger traffic evidence exist | Nigeria / student study platform | Students handle PDFs and scans; "Open to Applications" partner programme | Partner page lists no email; "Become a Partner" at /partner-with-us and WhatsApp +234 905 272 8257 ([partnership page](https://www.abstechconnect.com/partnership)) | Cross-promotion, then a small paid pilot | Small | Medium |
| 6 | **Allschool** | Nigeria / secondary-school learning | Sells ad products (text, banner, sponsored content, newsletter) per its own advertise page. **Page returned HTTP 403 to my fetcher, so I could not read the contact details.** | [allschool.ng/advertise](https://allschool.ng/advertise/) | Open the page in your browser and copy the contact | Small | Low until contact verified |

### Tier 2 - strategic, need traffic evidence first

| # | Company | Fit | Verified route | Note | Priority |
|---|---|---|---|---|---|
| 7 | **Paystack** | Nigerian business payments; SMEs and freelancers handle documents | "Contact Sales" form on [paystack.com/contact](https://paystack.com/contact); press/media kit link | Enterprise-minded; unlikely to buy small placements. Form only. | Low |
| 8 | **Kuda** | Consumer and business banking | help@kuda.com is customer support only ([Kuda FAQ](https://kuda.com/en-ng/legal/faq)); **not an advertising route**; I found no press or partnerships email | Needs a real contact | Low |
| 9 | **Resume.io** | Resume builder for job seekers | Affiliate programme; sources disagree on terms (8%, 24% or 30%) so **terms unverified**; allows banner ads and text links per one listing, restricts email/Bing/forums ([FlexOffers listing](https://www.flexoffers.com/affiliate-programs/resume-io-affiliate-program)). Their own affiliate URL returned 404 for me. | Apply through their programme; verify terms there | Medium |
| 10 | **Proton Drive / pCloud** | Cloud storage | Affiliate listings only (Proton via FlexOffers, listed 50%; pCloud 20-30% per a review site). **I could not reach either company's own page. Unverified.** | Same performance logic as Internxt | Low until verified |

### Tier 3 - long term, agency-led
Telecoms (MTN Nigeria, Airtel, Glo), Flutterwave, Moniepoint, multinational banks, airlines, FMCG, electronics brands. I found **no verified advertising or partnerships contact** for Moniepoint or Flutterwave and did not look for the others. These buy through agencies and want audited traffic. Revisit when you have 8+ weeks of clean analytics and a media kit. No outreach drafted.

### Categories searched with no verifiable prospect
Nigerian coworking spaces and business-registration providers (search returned news articles, no advertising pages); proofreading and typing services (freelancers and marketplaces, no partner pages); universities and certification bodies (not researched in depth); VPN providers (affiliate-only, not researched). I will not list companies I cannot show a contact route for.

### Alternative demand if direct sales stay slow
Networks I checked, with their own stated entry rules: **Google AdSense** (no traffic floor per several sources, low CPMs), **EthicalAds** (50,000 monthly page views stated on its FAQ - you are below it), **Carbon Ads** (invite-only, factors include traffic), **Ezoic** (250k traffic for new sites after 2026-02-19 per its support page), **Mediavine** (sources conflict; verify on their site), **Adsterra** (no stated minimum per secondary sources; verify, and check ad quality since it can serve intrusive formats that conflict with your "never in the way" policy). Note your ad system serves campaigns from your own database; plugging in a network would be a development task. [Verified on network pages where noted; otherwise third-party sources]

---

## C. Proposed advertising packages and pricing

**I am not proposing numeric prices.** You have no impression history, no real CTR and a contaminated traffic baseline. Inventing a CPM or flat rate would be a made-up number. Instead:

| Package | What the advertiser gets | Commercial basis [proposal, not verified] |
|---|---|---|
| **Founding Advertiser Pilot** (free limited launch offer - terms below) | One agreed placement, 14 days, one advertiser | **Free**, for feedback and (if agreed) anonymised performance figures; not a published price |
| **Targeted-page sponsor** | Exclusive placement on named pages (e.g. `/tools/sign-pdf`, `/tools/compress-pdf`) | Flat monthly fee **[you set it]**, priced after the pilot using measured page views |
| **Performance partner** | Placement in exchange for affiliate commission | Commission set by the advertiser's own programme (see tiers above) |
| **Full-site sponsor** | Top + side + bottom, one advertiser | Quote only after 8+ weeks of clean analytics |

### Founding Advertiser Pilot - terms (your decision 2026-10-13)

A **free, limited launch offer**, not a published pricing policy. Offered individually and in writing, only to an advertiser who has expressed interest in advertising. It is **separate from, and never a condition of, any affiliate programme**; affiliate commission and direct advertising are different commercial arrangements. It is not mentioned in the Internxt, SignWell or MyJobMag drafts.

| Term | Pilot |
|---|---|
| Cost | **Free**, in exchange for honest feedback and, **subject to the advertiser's agreement**, permission to use anonymised campaign performance figures in future media materials |
| Length | **14 days**, fixed, from an agreed start date |
| Advertisers | **One** advertiser |
| Placement | **One** agreed placement: a named slot (`top`, `side` or `bottom`) and, if wanted, a named page group. Nothing else included. |
| Creative | Advertiser supplies image/video at the sizes in the audit table; you approve it and can refuse or pause anything that conflicts with your ad policy |
| Reporting | Impressions and clicks **as actually recorded by FreePDFScanner** (admin dashboard), by slot/path/device, delivered after day 14, with a plain note on how they are counted (visitors who decline advertising consent may not be counted) |
| Guarantees | **None**: no guaranteed traffic, impressions, clicks, leads, sales or conversions. No audience, demographic, country or device claims. |
| Renewal | **No automatic renewal** and **no obligation** to buy a later campaign. It ends on day 14. |
| Agreement | **Written agreement** on the placement and campaign terms **before activation**. Nothing is activated until then. |
| Ending early | Either side can stop with short written notice (wording for you to set) |
| Before launch | Resolve the open data points in "Information needed" above, at minimum how impressions are counted |

I am not giving legal advice; have the written agreement reviewed as you see fit.

**How to price after the pilot:** measure real impressions and clicks in the admin dashboard for 2-4 weeks, then set flat fees from what the pilot delivered and what the advertiser's own customer value is. Offer a published rate only when you have data. Never quote guaranteed reach or clicks.

**Information needed before quoting a final price**
1. A clean 4-8 week traffic series (excluding `/admin`, localhost, bot patterns), per page group.
2. Why mobile shows 0% (bug or real) and why ~14% of recent views have no country.
3. Whether impressions are logged when visitors decline advertising consent.
4. Real-advertiser delivery history (currently none).
5. Ad dimensions you will accept for each slot (code sizes above), file types and max file size.
6. Your minimum campaign length, payment method and invoicing process, refund/make-good policy, and who approves creative.
7. A one-page media kit (audience, placements, policy, reporting sample). Not written yet.

---

## D. Outreach drafts (review only - not sent)

### D1. Master pitch (reusable)

> **Subject:** Sponsor placement on FreePDFScanner - founding advertiser offer
>
> Hello [name or team],
>
> I run FreePDFScanner (https://www.freepdfscanner.com), a free online tool for scanning, converting, signing and compressing documents, with the processing done in the visitor's browser.
>
> We are opening a small number of founding advertiser spots. Placements are clearly labelled, sit outside the tools so they never get in the way, and I can report impressions and clicks by page from our own dashboard. We are an early-stage site, so I am offering a free 14-day pilot (terms in writing first) to find out together whether it works for [Company].
>
> Would you be open to a 15-20 minute call to see whether this is relevant? [Proposed times - only once you approve your availability]
>
> Kind regards,
> [Your name], FreePDFScanner

### D2. FINAL drafts - awaiting your final approval (not sent)

Routes rechecked on **2026-10-13**, immediately before presenting each. You will send these yourself. Nothing has been sent, submitted or activated.

Common rules applied to all three:
- Sign-off is identical: Samuel Ajose, Founder, FreePDFScanner, https://www.freepdfscanner.com.
- No meeting time is proposed; each asks for a short introductory call of about 15-20 minutes.
- No audience figures are quoted. I will not quote any until you have a clean, dated report.
- The free Founding Advertiser Pilot is **not mentioned** in any of the three, and is never a condition of an affiliate arrangement. Affiliate commission and direct advertising are separate. See the pilot terms in section C for use only if an advertiser asks.

---

#### Draft 1 - Internxt: affiliate / partnership enquiry

**Route:** email to **affiliates@internxt.com** (the address the affiliate page gives for questions), *and/or* the affiliate sign-up link on https://internxt.com/affiliates. Verified 2026-10-13.

**Subject:** `Affiliate programme enquiry from FreePDFScanner`

**Message:**

> Hello Internxt affiliate team,
>
> I run FreePDFScanner (https://www.freepdfscanner.com), a free online tool for scanning, converting, signing and compressing documents, with the processing done in the visitor's browser. Privacy is part of why people use it, which seemed close to Internxt's positioning.
>
> I am writing to ask about your affiliate programme before I apply. Could you tell me:
>
> 1. Whether a small but relevant publisher like ours is eligible, and whether applications need approval.
> 2. How referrals are tracked and attributed.
> 3. The current commission terms, and whether there is a schedule of rules I should read first. Your page mentions Terms and Conditions but I could not find a link to a specific affiliate document.
> 4. Whether there is a suitable opportunity for a site like ours, for example a clearly labelled recommendation on our tool or guide pages, and which formats you allow.
>
> We are an early-stage site, so I will not quote audience figures until I can share a clean, dated report. Would you be open to a short introductory call, about 15-20 minutes, if that is useful?
>
> Kind regards,
>
> Samuel Ajose
> Founder, FreePDFScanner
> https://www.freepdfscanner.com

**Verified facts (official page, 2026-10-13)**
- Page: "affiliates@internxt.com" for questions; "Earn up to $300 per sale"; 30% on annual plans; 15% on lifetime sales; "30-days cookie duration period".
- You apply with a sign-up link to create an affiliate account; an affiliate manager responds in about 24 hours. The page does **not** explicitly say approval is required.
- Internxt says it works with "everyone who produces content" including bloggers and websites.

**Not verified / assumptions**
- Programme Terms and Conditions: the page tells readers to read them but gives **no link**; /legal showed Terms of Service, Privacy Policy and Cookie Policy only (part of that page was unread). **No affiliate terms document found.**
- Restrictions and prohibited promotion: **none stated** on the page; they may exist in documents I could not see.
- That commission figures are current for your situation, and whether they apply to a site like yours.
- Whether placement beside your tools is allowed. The email asks; it does not assume.

---

#### Draft 2 - SignWell: partnership enquiry

**Route:** web form at **https://www.signwell.com/partner-with-signwell-contact/**, headed "Partner with SignWell". The page says "Complete the form and an advisor will contact you". **No email address is published.** Form fields did not load for my fetcher, so they are **unverified**; check the live form and shorten the message if it has a limit. Verified 2026-10-13.

**Subject:** the form may not have a subject field. If it does: `Partnership enquiry from FreePDFScanner`

**Message:**

> Hello SignWell partnerships team,
>
> I run FreePDFScanner (https://www.freepdfscanner.com), a free online tool where people scan, convert, sign and compress documents in their browser. We have a simple PDF signing tool at /tools/sign-pdf, and some users may need a fuller e-signature service than a quick signature.
>
> I would like to ask about your partner programme before I join. Could you tell me:
>
> 1. Whether a small publisher like ours is eligible, and whether there is an approval step.
> 2. Whether your restrictions permit referrals or clearly labelled placements on our own website. I understand and will respect your rule against paid search ads; I am asking about our own pages, and I am not assuming the programme allows this.
> 3. How referrals are tracked, and where I can read the full programme terms.
>
> We are an early-stage site, so I will not quote audience figures until I can share a clean, dated report. Would you be open to a short introductory call, about 15-20 minutes?
>
> Kind regards,
>
> Samuel Ajose
> Founder, FreePDFScanner
> https://www.freepdfscanner.com

**Verified facts (official page, 2026-10-13)**
- "Earn 25% recurring commissions, up to one year, for each person you refer to SignWell that becomes a customer."
- "We don't allow Google Ads (or other search ad platforms like Bing, Yahoo, etc.) for any keywords", monitored using Marcode.
- The page lists no eligibility rules, no approval step, no payment mechanics, no FAQ and no email. It says you can "start earning commissions right away" after receiving a link, while the form page says "an advisor will contact you": the two are not fully consistent, so the email asks.

**Not verified / assumptions**
- Whether placements or referrals on a publisher's own website are permitted (the stated restriction is about paid search). **Unknown. The draft asks.**
- Full programme terms: **none found**.
- The form's fields and length limits.

---

#### Draft 3 - MyJobMag: exploratory editorial / cross-promotion partnership

**Route:** email **services@myjobmag.com**, or their contact form at https://www.myjobmag.com/contact (fields: Your Name*, Your Email*, Company Name, Subject, Message*). The page lists "advertise your product/service", "advertise your training programs" and "discuss an event or partnership" as reasons to get in touch. Phone 08121633133 is listed; I would not use it. Verified 2026-10-13.

**Subject:** `Exploratory partnership: document tools for your job seekers`

**Message:**

> Hello MyJobMag team,
>
> I run FreePDFScanner (https://www.freepdfscanner.com), a free online tool for scanning, converting, signing and compressing documents. Those are the tasks job seekers do when preparing applications, such as CVs and certificates.
>
> I would like to explore whether an editorial or cross-promotion partnership could be useful to both sides. For example, I could write a practical guide for your career-advice readers, or we could link to each other's relevant pages. I am not asking you to buy advertising, and I recognise your audience is far larger than ours.
>
> We are an early-stage site, so I will not quote audience figures until I can share a clean, dated report. Would you be open to a short introductory call, about 15-20 minutes, to see whether there is a fit?
>
> Kind regards,
>
> Samuel Ajose
> Founder, FreePDFScanner
> https://www.freepdfscanner.com

**Verified facts (official pages, 2026-10-13):** they sell display banners, email campaigns and partnerships ("Event & content collaborations"); their advertise page points to a media kit PDF with rates (not read; **no rates verified**); they state "1M+" subscribers and "10,000+" employers with **no date**, so I treat those as their unverified claims.

**Not verified / assumptions**
- That services@ reaches someone who handles partnerships (the page lists no separate partnerships contact).
- Their interest in editorial exchange. No free banner inventory is offered; that is discussed only if they say they want to advertise and you agree separately.

---

#### Deferred - no draft to send
- **Jobberman** (verified 2026-10-12) and **AbSApp** (verified 2026-10-12): deferred until you have cleaner analytics and stronger traffic evidence. Recheck their routes before any future contact.

### D3. Follow-up (after 5-7 working days, one only)

> **Subject:** Re: [original subject]
>
> Hello [name/team], a quick follow-up on my note about a placement on FreePDFScanner. If it is not relevant right now, no problem - just let me know and I will not follow up again. If it is, a 15-20 minute call would be enough to cover details.
>
> Kind regards, [Name]

### D4. LinkedIn message (only after you find and approve a named person)

> Hello [Name], I run FreePDFScanner, a free browser-based document tool. I am offering a few founding advertiser slots and thought [Company] might find it relevant. Open to a short intro call?

(300-character limit applies to connection notes; keep to one line.)

---

## E. Meeting conversion plan

**Call agenda (15-20 min):** 2 min who we are and the labelled, never-intrusive ad policy; 3 min their goals; 5 min walk through available slots and reporting; 5 min pilot terms; 2 min next step.

**Qualification questions**
1. Who is your target customer, and where are they (country, role)?
2. Do you run campaigns directly or through an agency?
3. What do you measure as success: clicks, sign-ups, sales?
4. Typical monthly budget range for small placements?
5. Can you supply image or video creative at the sizes I specify?
6. Preferred start date and campaign length? Who approves creative and pays?
7. Do you need geo or device targeting? (Answer honestly about current data limits.)

**Appointment tracker:** see [ad-sales-tracker.csv](ad-sales-tracker.csv). All rows start at "Ready for my approval" or "Research pending". No meeting has been requested, proposed, or booked. I will not propose times until you supply your availability.

---

## F. Approval queue (nothing sent)

| # | Recipient | Route | Verified | Draft | Status |
|---|---|---|---|---|---|
| 1 | Internxt | affiliates@internxt.com (and/or affiliate sign-up link) | 2026-10-13 | D2 Draft 1 | **Sent 2026-10-14 (Internxt, MyJobMag); SignWell form not submitted - answer drafted in signwell-form-answer.md, owner to complete and submit** |
| 2 | SignWell | Partner form (no email published); fields unverified | 2026-10-13 | D2 Draft 2 | **Sent 2026-10-14 (Internxt, MyJobMag); SignWell form not submitted - answer drafted in signwell-form-answer.md, owner to complete and submit** |
| 3 | MyJobMag | services@myjobmag.com or contact form | 2026-10-13 | D2 Draft 3 | **Sent 2026-10-14 (Internxt, MyJobMag); SignWell form not submitted - answer drafted in signwell-form-answer.md, owner to complete and submit** |
| - | Jobberman | sales@jobberman.com | 2026-10-12 | withdrawn | **Deferred** |
| - | AbSApp | partner form / WhatsApp | 2026-10-12 | withdrawn | **Deferred** |

**No email, form, message, booking, price or commitment has been sent, submitted, made or activated.** You will review and send these yourself. If you want any contact route rechecked again before you send, ask.

## G. Recommended immediate actions

1. **Approve, edit or drop Drafts 1-3** (names and sign-off are filled in).
2. **Before sending, look at the live SignWell form** for its fields and length limit.
3. **Look for Internxt's affiliate terms** (none linked on the page) and read SignWell's terms when they are given to you.
4. **Clean the analytics**: exclude `/admin`, localhost and the 2026-09-21 spike; find out why mobile reads 0% and why some views have no country.
5. **Decide how impressions are counted** for visitors who decline advertising consent, so the Founding Advertiser Pilot report can be described accurately if an advertiser ever asks.
6. **Write a one-page media kit** when the analytics are clean, then revisit Jobberman and AbSApp.

## Sources
- Your analytics and ad tables: Supabase project DocuScanner-web (aggregate queries, 2026-10-12).
- Code: `components/ads/AdSlot.tsx`, `components/layout/PageShell.tsx`, `utils/admin/ads.ts`.
- [Internxt affiliates](https://internxt.com/affiliates); [SignWell referral program](https://signwell.com/referral-program); [Jobberman contact](https://www.jobberman.com/contact-us); [Jobberman rate card (PDF)](https://static.jobberman.com/banner-rate-card-nigeria.pdf); [MyJobMag contact](https://www.myjobmag.com/contact); [MyJobMag advertise](https://www.myjobmag.com/advertise); [AbSApp partnership](https://www.abstechconnect.com/partnership); [Allschool advertise](https://allschool.ng/advertise/); [Paystack contact](https://paystack.com/contact); [Kuda FAQ](https://kuda.com/en-ng/legal/faq); [Resume.io via FlexOffers](https://www.flexoffers.com/affiliate-programs/resume-io-affiliate-program).
- Ad-network entry rules (third-party summaries, verify at source): [EthicalAds FAQ](https://www.ethicalads.io/publishers/faq/); [Carbon Ads FAQ](https://carbonads.net/faq); [Ezoic requirements](https://support.ezoic.com/kb/article/getting-started-ezoics-requirements); [Mediavine 2026 summary](https://www.jupiter.co/blog/mediavine-requirements-2026-how-to-qualify).
