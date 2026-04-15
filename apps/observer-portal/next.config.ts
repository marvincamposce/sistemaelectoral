import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Research reference portal.

  // Avoid dev-only cross-origin blocks for Next.js resources when alternating
  // between localhost and 127.0.0.1.
  allowedDevOrigins: ["localhost", "127.0.0.1"],
};

export default nextConfig;
