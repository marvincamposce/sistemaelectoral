import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
