"use client";

// Saves a generated PDF for a signed-in user, following exactly the flow
// the existing migrations were designed for (see their comments): upload
// the PDF to the private `documents` Storage bucket at
// "<user-id>/<document-id>/document.pdf", then insert the metadata row.
// Both operations run under the user's own session -- RLS on the bucket and
// the `documents` table (auth.uid() = user_id) is what authorizes this, no
// service-role key needed or used.

import { createClient } from "@/utils/supabase/client";

export interface SaveDocumentInput {
  userId: string;
  title: string;
  blob: Blob;
  pageCount: number;
}

export async function saveDocumentToAccount(input: SaveDocumentInput): Promise<void> {
  const supabase = createClient();
  const documentId = crypto.randomUUID();
  const storagePath = `${input.userId}/${documentId}/document.pdf`;

  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(storagePath, input.blob, { contentType: "application/pdf", upsert: false });
  if (uploadError) throw uploadError;

  const { error: insertError } = await supabase.from("documents").insert({
    id: documentId,
    user_id: input.userId,
    title: input.title,
    storage_path: storagePath,
    mime_type: "application/pdf",
    file_size: input.blob.size,
    page_count: input.pageCount,
  });
  if (insertError) {
    // Best-effort cleanup so a failed insert doesn't leave an orphaned file.
    await supabase.storage.from("documents").remove([storagePath]).catch(() => {});
    throw insertError;
  }
}
