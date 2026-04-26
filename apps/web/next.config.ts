import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	transpilePackages: ["@common-os/sdk", "@common-os/events"],
};

export default nextConfig;
