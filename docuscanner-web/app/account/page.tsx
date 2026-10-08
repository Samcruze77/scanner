import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { DeleteAccountPanel } from "@/components/account/DeleteAccountPanel";
import { privateMetadata } from "@/utils/seo/metadata";

export const metadata: Metadata = privateMetadata("Account - FreePDFScanner");

export default function AccountPage() {
  return (
    <PageShell width="narrow" ads="content" maskRecordings>
      <PageHeader title="Your account">Manage your PDFScanner account.</PageHeader>
      <DeleteAccountPanel />
    </PageShell>
  );
}
