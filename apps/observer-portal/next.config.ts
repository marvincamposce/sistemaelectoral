import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Research reference portal.

  // Avoid dev-only cross-origin blocks for Next.js resources when alternating
  // between localhost and 127.0.0.1.
  allowedDevOrigins: ["localhost", "127.0.0.1"],

  async rewrites() {
    const evidenceApiUrl = process.env.NEXT_PUBLIC_EVIDENCE_API_URL || "http://localhost:3020";
    return [
      {
        source: '/v1/:path*',
        destination: `${evidenceApiUrl}/v1/:path*`,
      },
    ]
  },
};

export default nextConfig;
