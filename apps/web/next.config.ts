import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@commonos/sdk", "@commonos/events"],
};

export default nextConfig;
