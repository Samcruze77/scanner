// Guide text with in-sentence links. Guide copy (utils/seo/guides.ts) is plain strings; a
// link is written [descriptive anchor text](/site/path) and rendered as a normal <Link>.
// Only site-relative paths are linked, so a typo can never send readers off-site.

import Link from "next/link";
import { Fragment } from "react";

const LINK = /\[([^\]]+)\]\((\/[^)\s]*)\)/g;

export function InlineText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(
      <Link key={at} href={match[2]} className="underline hover:no-underline">
        {match[1]}
      </Link>,
    );
    last = at + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <Fragment>{parts}</Fragment>;
}
