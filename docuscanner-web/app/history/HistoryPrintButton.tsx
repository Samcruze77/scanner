"use client";

// Print for a document saved to the account. The file is fetched from the
// account's own private storage (the signed link already used for Download),
// then printed on this device. Nothing is sent anywhere for printing.

import { PrintButton } from "@/components/print/PrintButton";
import { PrintError } from "@/utils/print/printPages";
import { pdfToPrintPages } from "@/utils/print/sources";

export function HistoryPrintButton({ url, title }: { url: string; title: string }) {
  return (
    <PrintButton
      source="history"
      title={title}
      className="btn btn-secondary"
      getPages={async () => {
        let response: Response;
        try {
          response = await fetch(url);
        } catch {
          throw new PrintError("render_failed");
        }
        if (!response.ok) throw new PrintError("render_failed");
        return pdfToPrintPages(await response.blob());
      }}
    />
  );
}
