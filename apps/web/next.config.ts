import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	transpilePackages: ["@common-os/sdk", "@common-os/events"],
	async rewrites() {
		const docsOrigin =
			process.env.DOCS_ORIGIN ??
			(process.env.NODE_ENV === "development" ? "http://localhost:3002" : null);

		if (!docsOrigin) return [];

		return [
			{
				source: "/docs",
				destination: `${docsOrigin}/docs`,
			},
			{
				source: "/docs/:path*",
				destination: `${docsOrigin}/docs/:path*`,
			},
		];
	},
};

export default nextConfig;
