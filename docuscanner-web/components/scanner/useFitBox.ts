"use client";

// Measures the room a stage has and returns the largest box of a given shape (width / height) that fits
// in it. Used instead of magic "viewport height minus N pixels" numbers, so the page and the picture
// being cropped use all the room that is really there, whatever toolbars happen to be around them.

import { useEffect, useRef, useState } from "react";

export function useFitBox(aspect: number, pad = 0) {
  const ref = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setRoom({ w: el.clientWidth, h: el.clientHeight });
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  let box: { w: number; h: number } | null = null;
  if (room && room.w > 0 && room.h > 0 && aspect > 0) {
    const w = Math.max(40, Math.min(room.w - pad * 2, (room.h - pad * 2) * aspect));
    box = { w: Math.floor(w), h: Math.floor(w / aspect) };
  }
  return { ref, box, room };
}
