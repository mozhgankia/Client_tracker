/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Same-origin API proxy. The browser calls /api/* on the Vercel origin
  // (so it is a same-origin request — no CORS involved at all), and Vercel
  // forwards each one, server-to-server, to the Render backend. This removes
  // the entire class of cross-origin/CORS problems: the browser never talks
  // to Render directly.
  //
  // The backend URL defaults to the deployed Render service; override it by
  // setting a BACKEND_URL env var in Vercel (a plain server-side var — NOT
  // NEXT_PUBLIC_, since the browser never needs it). Trailing slashes are
  // trimmed so the joined path never doubles up.
  async rewrites() {
    const backend = (process.env.BACKEND_URL || 'https://maskanyar-backend.onrender.com').replace(/\/+$/, '');
    return [
      {
        source: '/api/:path*',
        destination: `${backend}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
