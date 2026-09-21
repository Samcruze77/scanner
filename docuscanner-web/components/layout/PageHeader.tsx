// The title block every page starts with: one h1 (the page's name) and one short line
// saying what it's for. Keeping this in one place keeps every page's heading, size and
// spacing identical.
export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="mb-6">
      <h1 className="page-title">{title}</h1>
      {children && <p className="muted mt-1 max-w-2xl text-sm">{children}</p>}
    </header>
  );
}
