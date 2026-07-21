// A refined Downtown Dubai skyline: the Burj Khalifa rising at the centre with
// its finely-tiered spire, flanked by Downtown towers with varied crowns
// (tapered, stepped, antenna, domed), a warm dusk glow, a low haze, and
// scattered gold window lights. Drawn as a self-contained SVG so it renders
// crisply at any size with no external image — used as the polished fallback
// behind the real Unsplash photo (and on its own if the photo can't load).

const BASE = 420;

// Downtown towers around the Burj. `type` sets the crown shape.
const TOWERS = [
  { x: 24, w: 52, h: 172, type: 'antenna' },
  { x: 84, w: 46, h: 232, type: 'taper' },
  { x: 136, w: 74, h: 138, type: 'flat' },
  { x: 216, w: 40, h: 268, type: 'antenna' },
  { x: 262, w: 62, h: 196, type: 'step' },
  { x: 330, w: 50, h: 316, type: 'taper' },
  { x: 386, w: 68, h: 168, type: 'dome' },
  { x: 460, w: 40, h: 246, type: 'antenna' },
  { x: 506, w: 74, h: 210, type: 'step' },
  { x: 668, w: 72, h: 220, type: 'step' },
  { x: 748, w: 44, h: 300, type: 'antenna' },
  { x: 800, w: 66, h: 178, type: 'dome' },
  { x: 872, w: 40, h: 258, type: 'taper' },
  { x: 918, w: 76, h: 158, type: 'flat' },
  { x: 1000, w: 46, h: 276, type: 'antenna' },
  { x: 1052, w: 66, h: 200, type: 'step' },
  { x: 1124, w: 58, h: 164, type: 'taper' },
];

// Burj Khalifa: a wide buttressed base tapering through many small setbacks to
// a long central spire (centre x = 600, base y = 420).
const BURJ =
  'M560,420 V300 H568 V250 H574 V210 H580 V176 H585 V146 H589 V120 H593 V96 H596 V72 H598.5 ' +
  'V44 H600.6 V20 L601,10 L601.4,20 V44 H603.5 V72 H606 V96 H609 V120 H613 V146 H617 V176 H622 ' +
  'V210 H628 V250 H634 V300 H642 V420 Z';

function crown(b) {
  const topY = BASE - b.h;
  const cx = b.x + b.w / 2;
  switch (b.type) {
    case 'taper':
      return <polygon points={`${b.x},${topY + 14} ${b.x + b.w},${topY + 14} ${cx + b.w * 0.28},${topY - 16} ${cx - b.w * 0.28},${topY - 16}`} />;
    case 'step':
      return <rect x={b.x + b.w * 0.24} y={topY - 20} width={b.w * 0.52} height="24" rx="2" />;
    case 'dome':
      return <ellipse cx={cx} cy={topY + 2} rx={b.w * 0.42} ry={b.w * 0.34} />;
    case 'antenna':
      return <rect x={cx - 1.4} y={topY - 30} width="2.8" height="34" rx="1.4" />;
    default:
      return null;
  }
}

// Deterministic window lights (no re-randomising between renders).
function windows() {
  const cells = [];
  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (const b of TOWERS) {
    const cols = Math.max(1, Math.floor(b.w / 15));
    const rows = Math.max(2, Math.floor(b.h / 24));
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (rnd() > 0.4) continue;
        cells.push({ x: b.x + 5 + c * ((b.w - 9) / cols), y: BASE - 14 - r * ((b.h - 20) / rows) });
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
        <radialGradient id="sky-glow" cx="50%" cy="76%" r="46%">
          <stop offset="0" stopColor="#F5C978" stopOpacity="0.5" />
          <stop offset="0.5" stopColor="#E0A55A" stopOpacity="0.18" />
          <stop offset="1" stopColor="#E0A55A" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="tower-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#123227" stopOpacity="0.34" />
          <stop offset="1" stopColor="#04120D" stopOpacity="0.78" />
        </linearGradient>
        <linearGradient id="burj-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1C4335" stopOpacity="0.5" />
          <stop offset="1" stopColor="#05130E" stopOpacity="0.9" />
        </linearGradient>
        <linearGradient id="haze" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F5C978" stopOpacity="0" />
          <stop offset="1" stopColor="#C98F45" stopOpacity="0.16" />
        </linearGradient>
      </defs>

      {/* dusk glow behind the Burj */}
      <rect x="240" y="0" width="720" height="420" fill="url(#sky-glow)" />

      {/* Downtown towers + their crowns */}
      <g fill="url(#tower-fill)">
        {TOWERS.map((b, i) => (
          <g key={i}>
            <rect x={b.x} y={BASE - b.h} width={b.w} height={b.h} rx="2.5" />
            {crown(b)}
          </g>
        ))}
      </g>

      {/* Burj Khalifa */}
      <path d={BURJ} fill="url(#burj-fill)" />
      <path d={BURJ} fill="none" stroke="#F4CE84" strokeOpacity="0.3" strokeWidth="1.4" />

      {/* window lights */}
      <g fill="#F7E2A0">
        {WINDOWS.map((w, i) => (
          <rect key={i} x={w.x} y={w.y} width="2.8" height="4.4" opacity={0.5 + (i % 3) * 0.17} />
        ))}
      </g>

      {/* low haze at street level */}
      <rect x="0" y="330" width="1200" height="90" fill="url(#haze)" />
    </svg>
  );
}
