import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    const evidenceApiUrl = process.env.NEXT_PUBLIC_EVIDENCE_API_URL || "http://localhost:3020";
    const mrdApiUrl = process.env.NEXT_PUBLIC_MRD_API_URL || "http://localhost:8002";
    
    return [
      {
        source: '/v1/elections:path*',
        destination: `${evidenceApiUrl}/v1/elections:path*`,
      },
      {
        source: '/v1/hn:path*',
        destination: `${evidenceApiUrl}/v1/hn:path*`,
      },
      {
        source: '/v1/mrd:path*',
        destination: `${mrdApiUrl}/v1/mrd:path*`,
      },
    ]
  },
};

export default nextConfig;
