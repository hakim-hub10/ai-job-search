import type { NextConfig } from "next";
import { resolve } from "node:path";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.10.200"],
  serverExternalPackages: ["pdf-parse"],
  experimental: {
    serverActions: {
      // Keep the 5 MiB file limit, with 16 KiB for multipart fields and headers.
      bodySizeLimit: 5 * 1024 * 1024 + 16 * 1024,
    },
  },
  turbopack: {
    root: resolve(__dirname, ".."),
  },
};

export default nextConfig;
