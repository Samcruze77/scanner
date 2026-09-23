"use client";

import { useRef, useState } from "react";
import { FileDropzone } from "@/components/convert/FileDropzone";
import type { AdCreative, AdMediaType } from "@/utils/admin/ads";
import { AD_ASSET_ACCEPT, AdAssetError, deleteAdAsset, uploadAdAsset } from "@/utils/admin/uploadAdAsset";

// Upload-or-external-URL control for one creative's banner media. Uploads go
// straight to the ad-assets Storage bucket (see utils/admin/uploadAdAsset.ts)
// with a real progress bar; "external URL" keeps working for advertiser-
// hosted assets exactly as before. destination_type (link vs. YouTube/Vimeo
// embed) is a separate, unrelated concern still handled by CampaignForm
// itself -- this only ever sets asset_url/media_type/storage_path/etc.
export function AdAssetUploader({
  creative,
  pathPrefix,
  onChange,
}: {
  creative: AdCreative;
  pathPrefix: string;
  onChange: (patch: Partial<AdCreative>) => void;
}) {
  const [mode, setMode] = useState<"upload" | "url">(creative.storage_path || !creative.asset_url ? "upload" : "url");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // Guards against a slow earlier upload's progress/result landing after a
  // newer one was started (user picked a different file mid-upload).
  const sequenceRef = useRef(0);

  async function handleFile(file: File) {
    setError(null);
    const localUrl = URL.createObjectURL(file);
    setPreviewUrl(localUrl);
    setUploading(true);
    setProgress(0);
    const sequence = ++sequenceRef.current;
    const previousPath = creative.storage_path;
    try {
      const uploaded = await uploadAdAsset(file, `${pathPrefix}-${Date.now()}`, (fraction) => {
        if (sequence === sequenceRef.current) setProgress(fraction);
      });
      if (sequence !== sequenceRef.current) return;
      if (previousPath) await deleteAdAsset(previousPath).catch(() => {});
      onChange({
        asset_url: uploaded.publicUrl,
        storage_path: uploaded.storagePath,
        mime_type: uploaded.mimeType,
        file_size_bytes: uploaded.fileSizeBytes,
        media_type: uploaded.mediaType,
        width: uploaded.width,
        height: uploaded.height,
      });
    } catch (err) {
      if (sequence === sequenceRef.current) {
        setError(err instanceof AdAssetError ? err.message : "Upload failed. Please try again.");
      }
    } finally {
      if (sequence === sequenceRef.current) setUploading(false);
      URL.revokeObjectURL(localUrl);
      setPreviewUrl(null);
    }
  }

  async function handleRemove() {
    const path = creative.storage_path;
    onChange({ asset_url: "", storage_path: null, mime_type: null, file_size_bytes: null, width: null, height: null });
    if (path) await deleteAdAsset(path).catch(() => {});
  }

  const displayUrl = previewUrl ?? (mode === "upload" ? creative.asset_url || null : null);

  return (
    <div className="space-y-2">
      <span className="mb-1 block text-xs text-zinc-500">Banner media (image or video, required)</span>
      <div className="flex gap-3 text-xs">
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={mode === "upload"} onChange={() => setMode("upload")} />
          Upload a file
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={mode === "url"} onChange={() => setMode("url")} />
          Use an external URL
        </label>
      </div>

      {mode === "upload" ? (
        <div className="space-y-2">
          {displayUrl &&
            (creative.media_type === "video" ? (
              <video src={displayUrl} controls className="max-w-xs rounded-md border border-zinc-200 dark:border-zinc-800" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- previewing an uploaded/blob asset, not a static site image
              <img src={displayUrl} alt="" className="max-w-xs rounded-md border border-zinc-200 dark:border-zinc-800" />
            ))}

          {uploading ? (
            <div className="space-y-1">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900">
                <div className="h-full bg-blue-600 transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Uploading… {Math.round(progress * 100)}%</p>
            </div>
          ) : (
            <FileDropzone
              accept={AD_ASSET_ACCEPT}
              title={creative.asset_url ? "Replace file" : "Choose a file"}
              hint="JPG, PNG, WebP or GIF up to 8MB; MP4 or WebM up to 40MB"
              onFile={(file) => void handleFile(file)}
            />
          )}

          {creative.asset_url && !uploading && creative.storage_path && (
            <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
              <span>
                {creative.media_type}
                {creative.mime_type ? ` · ${creative.mime_type}` : ""}
                {creative.file_size_bytes ? ` · ${(creative.file_size_bytes / 1024).toFixed(0)} KB` : ""}
                {creative.width && creative.height ? ` · ${creative.width}×${creative.height}` : ""}
              </span>
              <button type="button" onClick={() => void handleRemove()} className="text-red-600 hover:underline dark:text-red-400">
                Remove
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <input
            value={creative.storage_path ? "" : creative.asset_url}
            onChange={(e) => onChange({ asset_url: e.target.value, storage_path: null, mime_type: null, file_size_bytes: null })}
            placeholder="https://…"
            className="w-full rounded-md border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-800 dark:bg-black"
          />
          <label className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <input
              type="checkbox"
              checked={creative.media_type === "video"}
              onChange={(e) => onChange({ media_type: (e.target.checked ? "video" : "image") as AdMediaType })}
            />
            This URL is a video file (MP4/WebM), not an image
          </label>
        </div>
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
