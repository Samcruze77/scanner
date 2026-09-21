import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

export const metadata: Metadata = {
  title: "Choose a new password - PDFScanner",
  // A private, one-time page: keep it out of search results.
  robots: { index: false, follow: false },
};

// No ads and no page chrome beyond the app header: this is a focused, sensitive
// step. The form itself is a client component because it works with the session
// the emailed link creates in the browser.
export default function ResetPasswordPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-md flex-1 px-4 py-10">
      <ResetPasswordForm />
    </main>
  );
}
