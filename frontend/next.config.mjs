/** @type {import('next').NextConfig} */
const nextConfig = {
  // Deployed statically/serverless on Vercel per the platform's cost design —
  // this app only ever talks to the separately-deployed backend API
  // (NEXT_PUBLIC_API_BASE_URL), it never needs a Node server of its own.
  reactStrictMode: true,
};

export default nextConfig;
