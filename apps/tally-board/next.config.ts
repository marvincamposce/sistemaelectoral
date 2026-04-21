import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/v1/:path*',
        destination: `${process.env.NEXT_PUBLIC_EVIDENCE_API_URL}/v1/:path*`,
      },
    ]
  },
};

export default nextConfig;
