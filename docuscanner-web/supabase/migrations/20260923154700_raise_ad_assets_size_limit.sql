-- Raised from 40MB to 60MB to match utils/admin/uploadAdAsset.ts's
-- MAX_VIDEO_BYTES (the largest allowed type) -- images allow up to 20MB
-- (animated GIFs can be much larger than a static image once they have real
-- motion), enforced client-side only since it's well under this bucket cap.
update storage.buckets set file_size_limit = 62914560 where id = 'ad-assets';
