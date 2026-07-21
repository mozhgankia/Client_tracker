// A detailed Downtown Dubai skyline scene: the Burj Khalifa rising at the
// centre, surrounded by Downtown towers, with a warm dusk glow and scattered
// gold window lights. Drawn as a self-contained SVG so it renders crisply at
// any size and needs no external image. Designed to sit at the bottom of an
// emerald panel (login hero / dashboard header): the towers are a translucent
// dark-emerald silhouette so the panel's gradient shows through for depth.

const BUILDINGS = [
  { x: 20, w: 56, h: 150 }, { x: 82, w: 44, h: 214 }, { x: 132, w: 72, h: 128 },
  { x: 210, w: 40, h: 252 }, { x: 256, w: 60, h: 182 }, { x: 322, w: 48, h: 300 },
  { x: 376, w: 66, h: 158 }, { x: 448, w: 38, h: 232 }, { x: 492, w: 76, h: 198 },
  { x: 664, w: 70, h: 208 }, { x: 740, w: 44, h: 284 }, { x: 790, w: 64, h: 168 },
  { x: 860, w: 40, h: 244 }, { x: 906, w: 74, h: 150 }, { x: 986, w: 46, h: 262 },
  { x: 1038, w: 66, h: 190 }, { x: 1110, w: 60, h: 150 },
];

const BASE = 420;
const BURJ =
  'M568,420 V300 H575 V210 H582 V140 H588 V90 H593 V55 H597 V20 H603 V55 H607 V90 H612 V140 H618 V210 H625 V300 H632 V420 Z';

// Deterministic scatter of window lights so the scene looks lit but never
// re-randomizes between renders (which would flicker in React).
function windows() {
  const cells = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (const b of BUILDINGS) {
    const cols = Math.max(1, Math.floor(b.w / 16));
    const rows = Math.max(2, Math.floor(b.h / 26));
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (rnd() > 0.42) continue; // only light ~some windows
        cells.push({
          x: b.x + 6 + c * ((b.w - 10) / cols),
          y: BASE - 14 - r * ((b.h - 18) / rows),
        });
      }
    }
  }
  return cells;
}

const WINDOWS = windows();

export default function DubaiSkyline({ className, style }) {
  return (
    <svg
      className={className}
      style={style}
      viewBox="0 0 1200 420"
      preserveAspectRatio="xMidYMax slice"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      role="presentation"
    >
      <defs>
        <radialGradient id="glow" cx="50%" cy="72%" r="42%">
          <stop offset="0" stopColor="#F2C876" stopOpacity="0.42" />
          <stop offset="1" stopColor="#F2C876" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="tower" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0B241B" stopOpacity="0.35" />
          <stop offset="1" stopColor="#04120D" stopOpacity="0.72" />
        </linearGradient>
      </defs>

      {/* warm dusk glow behind the Burj */}
      <rect x="300" y="20" width="600" height="400" fill="url(#glow)" />

      {/* Downtown towers */}
      <g fill="url(#tower)">
        {BUILDINGS.map((b, i) => (
          <rect key={i} x={b.x} y={BASE - b.h} width={b.w} height={b.h} rx="3" />
        ))}
      </g>

      {/* Burj Khalifa */}
      <path d={BURJ} fill="url(#tower)" />
      <path d={BURJ} fill="none" stroke="#F2C876" strokeOpacity="0.22" strokeWidth="1.5" />

      {/* window lights */}
      <g fill="#F6DE97">
        {WINDOWS.map((w, i) => (
          <rect key={i} x={w.x} y={w.y} width="3.2" height="4.6" opacity={0.55 + (i % 3) * 0.15} />
        ))}
      </g>
    </svg>
  );
}
