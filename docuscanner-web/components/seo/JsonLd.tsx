// Renders structured data as a JSON-LD script. "<" is escaped so no value can ever close
// the script tag early.

export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}
