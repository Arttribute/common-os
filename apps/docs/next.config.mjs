import { createMDX } from "fumadocs-mdx/next";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const config = {
  basePath: "/docs",
  reactStrictMode: true,
  turbopack: {
    root: join(__dirname, "../.."),
  },
};

const withMDX = createMDX();

export default withMDX(config);
