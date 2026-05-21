import { createMDX } from "fumadocs-mdx/next";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const config = {
  assetPrefix:
    process.env.DOCS_ASSET_PREFIX ??
    (process.env.NODE_ENV === "production" ? "https://common-os-docs.vercel.app/docs" : undefined),
  basePath: "/docs",
  reactStrictMode: true,
  turbopack: {
    root: join(__dirname, "../.."),
  },
};

const withMDX = createMDX();

export default withMDX(config);
