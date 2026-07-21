// iOS home-screen icon (PNG, rendered by Next's ImageResponse/satori). Mirrors
// public/icon.svg: a gold banknote with an emerald seal on an emerald
// gradient. Built entirely from positioned <div>s (no inline SVG / no custom
// fonts) so satori renders it identically and reliably at build time.
import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  const goldBar = { position: 'absolute', background: '#F6DE97', borderRadius: 4 };
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #12805B 0%, #083A2A 100%)',
        }}
      >
        {/* banknote */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 132,
            height: 62,
            borderRadius: 15,
            background: 'linear-gradient(135deg, #F6DE97 0%, #C0912F 100%)',
            transform: 'rotate(-9deg)',
          }}
        >
          {/* emerald seal */}
          <div
            style={{
              position: 'relative',
              display: 'flex',
              width: 44,
              height: 44,
              borderRadius: 22,
              background: '#0E6A4A',
              border: '3px solid #F6DE97',
            }}
          >
            {/* currency mark: vertical spine + two crossbars */}
            <div style={{ ...goldBar, left: 19, top: 8, width: 6, height: 28 }} />
            <div style={{ ...goldBar, left: 9, top: 15, width: 26, height: 5 }} />
            <div style={{ ...goldBar, left: 9, top: 24, width: 26, height: 5 }} />
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
