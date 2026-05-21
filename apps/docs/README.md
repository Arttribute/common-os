# CommonOS Docs

Fumadocs-powered documentation app for CommonOS.

## Local Development

```bash
pnpm --filter @common-os/docs dev
```

The docs app runs on `http://localhost:3002/docs`.

## Same-Domain Deployment

The production setup is a Next.js multi-zone:

- `apps/web` remains the public domain owner.
- `apps/docs` deploys as a separate Vercel project.
- `apps/docs` uses `basePath: "/docs"`.
- `apps/web` rewrites `/docs` and `/docs/:path*` to `DOCS_ORIGIN`.

### Vercel Project: Docs

Create a new Vercel project with:

```txt
Root Directory: apps/docs
Build Command: pnpm build
Install Command: pnpm install
```

Do not attach the main custom domain to this project. Use the generated Vercel URL as the docs origin, for example:

```txt
https://common-os-docs.vercel.app
```

### Vercel Project: Web

In the existing web project, set:

```txt
DOCS_ORIGIN=https://common-os-docs.vercel.app
```

Redeploy the web project. The public docs URL will be:

```txt
https://<main-domain>/docs
```

## Build

```bash
pnpm --filter @common-os/docs build
```
