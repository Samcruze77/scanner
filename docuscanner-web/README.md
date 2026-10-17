This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Ask FreePDFScanner (help assistant)

The floating "Ask me anything" button (`components/assistant/`) answers "how do I..." questions and can point at
the real button on the page. All it knows about the product is in one file, `utils/assistant/knowledge.ts`. The tool
list is read from the real registries, and `npm run test:assistant` fails if a route, a control id
(`data-assistant-id` in the source) or a suggested question no longer exists. **When you add a tool or change a button the
assistant describes, update that file.**

It has two modes and says which one is in use:

- **AI helper** (needs a key): `POST /api/assistant` asks an Anthropic model, giving it only the matching knowledge entries,
  the visitor's question, a few earlier turns and the page *path*. Never a document, filename, password or token.
- **Built-in guide** (no key, or the AI is down or rate-limited): plain keyword matching over the same knowledge,
  labelled "not AI" in the panel.

Environment variables (server only; nothing here is `NEXT_PUBLIC_`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | unset | Turns the AI helper on. Without it the built-in guide is used. |
| `ASSISTANT_MODEL` | `claude-haiku-5-5` | Model id. A small, cheap model is plenty. |
| `ASSISTANT_ENABLED` | on | Set `false` to switch the AI helper off without removing the key. |
| `ASSISTANT_IP_PER_MINUTE` / `ASSISTANT_IP_PER_DAY` | 6 / 60 | Per-visitor limits. |
| `ASSISTANT_DAILY_REQUESTS` | 1500 | One site-wide cap on model calls per UTC day. |
| `ASSISTANT_MAX_OUTPUT_TOKENS` | 450 | Reply length cap. |

Cost: each question sends roughly 2-3k input tokens (instructions plus 3-5 knowledge entries) and receives at most
`ASSISTANT_MAX_OUTPUT_TOKENS`. Multiply by `ASSISTANT_DAILY_REQUESTS` and the model's current per-token price for the
worst case per day. The in-app limits live in each server instance's memory, so they are a brake, not a hard ceiling:
also set a monthly spend limit on the Anthropic account.

## Adding pictures to a document

"Add image" (`/tools/add-image`, and the Add image button in every editor) places JPG, PNG or WebP pictures on a page as
movable, resizable marks (`image` annotations in `utils/scanner/annotations.ts`), drawn by the same renderer that flattens
the page into the exported PDF. Word and Excel files are converted to PDF first, so the picture lands on that PDF; the
original file is not changed. Pictures never leave the browser. Tests: `npm run test:images` (geometry and file checks) and
`node tests/images/e2e.mjs <baseUrl>` (real browser, real PDF export; needs `npm run start`).

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
