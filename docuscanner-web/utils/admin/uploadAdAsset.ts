"use client";

// Uploads an ad-banner media file (image/video) directly to the public
// ad-assets Storage bucket, with real byte-level upload progress.
// supabase-js's storage.upload() wraps fetch and exposes no progress events
// at all, so this goes straight to the Storage REST endpoint via
// XMLHttpRequest instead -- the only way to get xhr.upload.onprogress. The
// request shape (POST, multipart/form-data with the file under an empty
// field name, x-upsert header, apikey + Authorization headers) mirrors
// exactly what @supabase/storage-js's own upload() sends for a Blob body,
// so this stays compatible with the same server behavior.
//
// Write access is enforced entirely by the ad-assets bucket's RLS policies
// (active admin/super_admin only, see the create_ad_assets_storage_and_media_
// columns migration) -- this file only prepares and sends the request; it
// grants nothing on its own.

import { createClient } from "@/utils/supabase/client";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

export type AdMediaType = "image" | "video";

export const AD_ASSET_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm";

const ALLOWED_TYPES: Record<string, AdMediaType> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
  "video/mp4": "video",
  "video/webm": "video",
};
const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
};
// Image covers animated GIF too, which can be much larger than a static
// JPG/PNG/WebP once it has real motion in it -- 20MB gives that room without
// opening the door to arbitrarily large unoptimized files.
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 60 * 1024 * 1024;

export class AdAssetError extends Error {}

// Validated by extension match too, not just the browser-reported MIME type
// alone, since that's client-supplied and easy to spoof -- this is a fast
// first check for a good error message; the real backstop is server-side
// (Storage RLS for who may write at all, admin-ads for asset_url shape).
export function validateAdAssetFile(file: File): AdMediaType {
  const mediaType = ALLOWED_TYPES[file.type];
  if (!mediaType) throw new AdAssetError("Unsupported file type. Use JPG, PNG, WebP, GIF, MP4 or WebM.");
  const ext = file.name.split(".").pop()?.toLowerCase();
  const expectedExt = EXT_BY_TYPE[file.type];
  const extOk = ext === expectedExt || (expectedExt === "jpg" && ext === "jpeg");
  if (!extOk) throw new AdAssetError("The file extension doesn't match its type.");
  const maxBytes = mediaType === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (file.size > maxBytes) {
    throw new AdAssetError(`File is too large. ${mediaType === "image" ? "Images" : "Videos"} must be under ${Math.round(maxBytes / (1024 * 1024))}MB.`);
  }
  return mediaType;
}

export interface UploadedAdAsset {
  publicUrl: string;
  storagePath: string;
  mimeType: string;
  fileSizeBytes: number;
  mediaType: AdMediaType;
  width: number | null;
  height: number | null;
}

function readMediaDimensions(file: File, mediaType: AdMediaType): Promise<{ width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const done = (width: number | null, height: number | null) => {
      URL.revokeObjectURL(url);
      resolve({ width, height });
    };
    if (mediaType === "image") {
      const img = new Image();
      img.onload = () => done(img.naturalWidth || null, img.naturalHeight || null);
      img.onerror = () => done(null, null);
      img.src = url;
    } else {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => done(video.videoWidth || null, video.videoHeight || null);
      video.onerror = () => done(null, null);
      video.src = url;
    }
  });
}

// `pathPrefix` identifies the creative slot being uploaded to (e.g.
// "<campaign-id-or-draft-id>/<creative-index>") -- the extension is derived
// from the file's own type so replacing an image with a different format
// doesn't collide with the old object's path.
export async function uploadAdAsset(file: File, pathPrefix: string, onProgress?: (fraction: number) => void): Promise<UploadedAdAsset> {
  const mediaType = validateAdAssetFile(file);
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new AdAssetError("Your session has expired. Please sign in again.");

  const storagePath = `${pathPrefix}.${EXT_BY_TYPE[file.type]}`;
  const dimensions = await readMediaDimensions(file, mediaType);

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${SUPABASE_URL}/storage/v1/object/ad-assets/${storagePath}`, true);
    xhr.setRequestHeader("apikey", SUPABASE_ANON_KEY);
    xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
    xhr.setRequestHeader("x-upsert", "true");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new AdAssetError(xhr.status === 403 ? "You don't have permission to upload ad assets." : `Upload failed (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new AdAssetError("Upload failed. Check your connection and try again."));
    const form = new FormData();
    form.append("cacheControl", "3600");
    form.append("", file);
    xhr.send(form);
  });

  const { data: publicUrlData } = supabase.storage.from("ad-assets").getPublicUrl(storagePath);

  return {
    publicUrl: publicUrlData.publicUrl,
    storagePath,
    mimeType: file.type,
    fileSizeBytes: file.size,
    mediaType,
    width: dimensions.width,
    height: dimensions.height,
  };
}

export async function deleteAdAsset(storagePath: string): Promise<void> {
  const supabase = createClient();
  await supabase.storage.from("ad-assets").remove([storagePath]);
}
