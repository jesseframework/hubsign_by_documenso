/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Static export, enabled only for the container build.
   *
   * Every page here is prerendered, so production serves plain files from nginx
   * with no Node process. But `output: 'export'` is incompatible with
   * `next start`, which is how the site is previewed locally — so it is gated on
   * an env var that the Dockerfile sets, leaving `npm run dev` and `npm start`
   * working as before.
   */
  ...(process.env.DOCS_STATIC_EXPORT ? { output: 'export', images: { unoptimized: true } } : {}),

  transpilePackages: [
    '@documenso/assets',
    '@documenso/lib',
    '@documenso/tailwind-config',
    '@documenso/trpc',
    '@documenso/ui',
  ],
};

const withNextra = require('nextra')({
  theme: 'nextra-theme-docs',
  themeConfig: './theme.config.tsx',
});

module.exports = withNextra(nextConfig);
