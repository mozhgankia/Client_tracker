'use client';

// Layered Dubai backdrop for the login hero and the dashboard header:
//   1. a vector Downtown skyline (always present — the guaranteed fallback)
//   2. a real high-quality Burj Khalifa / Downtown Dubai photo from Unsplash,
//      loaded over the skyline; if it ever fails to load we hide it and the
//      skyline shows through, so the panel is never blank
//   3. an emerald gradient overlay that tints the photo on-brand and keeps
//      overlaid white text readable
import { useState } from 'react';
import DubaiSkyline from './DubaiSkyline';

// Free-to-use Unsplash photo (Unsplash License: free for commercial use, no
// attribution required). Burj Khalifa & Downtown Dubai skyline at dusk.
const PHOTO_URL =
  'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?auto=format&fit=crop&w=1600&q=80';

export default function DubaiBackdrop({ variant = 'login' }) {
  const [photoOk, setPhotoOk] = useState(true);
  return (
    <div className={`dubai-backdrop ${variant}`} aria-hidden="true">
      <DubaiSkyline className="dubai-backdrop-skyline" />
      {photoOk && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="dubai-backdrop-photo"
          src={PHOTO_URL}
          alt=""
          loading="lazy"
          onError={() => setPhotoOk(false)}
        />
      )}
      <div className="dubai-backdrop-overlay" />
    </div>
  );
}
