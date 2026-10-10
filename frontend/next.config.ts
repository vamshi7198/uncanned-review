import type { NextConfig } from "next";

// In Docker, Caddy sends /api/* to the backend, so the browser sees one origin.
// For `npm run dev` outside Docker, set BACKEND_URL to proxy /api locally.
const backend = process.env.BACKEND_URL;

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async rewrites() {
    return backend
      ? [{ source: "/api/:path*", destination: `${backend}/api/:path*` }]
      : [];
  },
};

export default nextConfig;
