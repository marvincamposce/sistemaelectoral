import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/v1/elections:path*',
        destination: `${process.env.NEXT_PUBLIC_EVIDENCE_API_URL}/v1/elections:path*`,
      },
      {
        source: '/v1/hn:path*',
        destination: `${process.env.NEXT_PUBLIC_EVIDENCE_API_URL}/v1/hn:path*`,
      },
      {
        source: '/v1/mrd:path*',
        destination: `${process.env.NEXT_PUBLIC_MRD_API_URL}/v1/mrd:path*`,
      },
    ]
  },
};

export default nextConfig;
