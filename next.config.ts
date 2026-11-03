import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  // Workspace packages ship TypeScript source (no build step), so Next compiles them like app code.
  transpilePackages: ["@retro/core"],
  images: { unoptimized: true },
  trailingSlash: false,
};

export default nextConfig;
