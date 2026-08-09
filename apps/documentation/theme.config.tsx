import type { DocsThemeConfig } from 'nextra-theme-docs';
import { useConfig } from 'nextra-theme-docs';

/**
 * HubSign documentation portal theme.
 *
 * Deliberately carries no links to an upstream project: no GitHub icon, no chat
 * icon, no "edit this page" or "report an issue" link. Nextra renders those the
 * moment `project`, `chat` or `docsRepositoryBase` are set, and each one pointed
 * readers at somebody else's repository and community.
 */
const themeConfig: DocsThemeConfig = {
  /**
   * The official wordmark from hubsign.io.
   *
   * Its "HubSign" text is near-black, which disappears against Nextra's dark
   * background. Rather than invert or recolour it — which would also shift the
   * purple mark off-brand — dark mode sets it on a white chip, so the artwork
   * renders in its exact brand colours in both themes.
   */
  logo: (
    <span className="hubsign-logo flex items-center">
      <img src="/hubsign-logo.png" alt="HubSign" />
      <span className="sr-only">HubSign Documentation</span>
    </span>
  ),

  logoLink: '/',

  head: function useHead() {
    const config = useConfig<{ title?: string; description?: string }>();

    const pageTitle = config.frontMatter.title;
    const title = pageTitle ? `${pageTitle} | HubSign Docs` : 'HubSign Docs';
    const description =
      config.frontMatter.description ||
      'HubSign documentation — electronic signature, organization administration and integration.';

    return (
      <>
        <meta httpEquiv="Content-Language" content="en" />
        <meta name="title" content={title} />
        <meta name="description" content={description} />
        <meta name="application-name" content="HubSign Docs" />
        <meta name="apple-mobile-web-app-title" content="HubSign Docs" />
        <meta name="og:site_name" content="HubSign" />
        <meta name="og:title" content={title} />
        <meta name="og:description" content={description} />
        <meta name="og:image" content="/opengraph-image.jpg" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        {/* The same icon mark hubsign.io serves, so the browser tab matches. */}
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" type="image/png" sizes="96x96" href="/hubsign-mark.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
      </>
    );
  },

  // Nextra shows a "Question? Give us feedback" link and an "Edit this page"
  // link whenever these are set, both of which resolved to an upstream
  // repository. Disabled rather than repointed.
  feedback: { content: null },
  editLink: { component: null },

  navigation: { prev: true, next: true },

  sidebar: {
    defaultMenuCollapseLevel: 1,
    toggleButton: true,
  },

  toc: {
    backToTop: true,
    title: 'On this page',
  },

  /**
   * Mirrors the hubsign.io site footer: brand column with the tagline and the
   * Future Edge attribution, then Product / Company / Contact link columns, then
   * a rule and the copyright line.
   *
   * Nextra centres and size-limits whatever it is given here, so the content is
   * wrapped to take the full width itself.
   */
  footer: {
    text: (
      <div className="hubsign-footer w-full">
        {/* No max-width or horizontal padding here — Nextra's footer container
            already applies both, and repeating them double-indents the columns. */}
        <div className="w-full">
          <div className="grid grid-cols-1 gap-10 md:grid-cols-2 lg:grid-cols-4">
            {/* Brand */}
            <div className="lg:col-span-2 lg:max-w-sm">
              <span className="hubsign-logo inline-flex">
                <img src="/hubsign-logo.png" alt="HubSign" />
              </span>

              <p className="text-foreground/60 mt-4 text-sm leading-relaxed">
                Enterprise-grade e-signatures made simple.
              </p>

              <div className="border-border/60 mt-6 flex items-center gap-3 border-t pt-5">
                <span className="text-foreground/50 text-xs">Powered by</span>
                <span className="futureedge-logo inline-flex">
                  <img src="/futureedge-logo.png" alt="Future Edge Technology" />
                </span>
              </div>
            </div>

            {/* Product */}
            <div>
              <p className="text-foreground text-[11px] font-bold uppercase tracking-[0.1em]">
                Product
              </p>
              <ul className="mt-4 space-y-2.5 text-sm">
                <li>
                  <a className="text-foreground/60 hover:text-primary transition" href="/organization">
                    Organization
                  </a>
                </li>
                <li>
                  <a className="text-foreground/60 hover:text-primary transition" href="/dms">
                    Doc Manager
                  </a>
                </li>
                <li>
                  <a className="text-foreground/60 hover:text-primary transition" href="/users">
                    Signing
                  </a>
                </li>
                <li>
                  <a className="text-foreground/60 hover:text-primary transition" href="/integrations">
                    ERP & Accounting
                  </a>
                </li>
                <li>
                  <a className="text-foreground/60 hover:text-primary transition" href="/manual">
                    Full Manual
                  </a>
                </li>
              </ul>
            </div>

            {/* Company */}
            <div>
              <p className="text-foreground text-[11px] font-bold uppercase tracking-[0.1em]">
                Company
              </p>
              <ul className="mt-4 space-y-2.5 text-sm">
                <li>
                  <a
                    className="text-foreground/60 hover:text-primary transition"
                    href="https://hubsign.io"
                    target="_blank"
                    rel="noreferrer"
                  >
                    hubsign.io
                  </a>
                </li>
                <li>
                  <a
                    className="text-foreground/60 hover:text-primary transition"
                    href="https://hubsign.io/privacy"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Privacy
                  </a>
                </li>
                <li>
                  <a
                    className="text-foreground/60 hover:text-primary transition"
                    href="https://hubsign.io/terms"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Terms
                  </a>
                </li>
              </ul>
            </div>

            {/* Contact */}
            <div>
              <p className="text-foreground text-[11px] font-bold uppercase tracking-[0.1em]">
                Contact
              </p>
              <ul className="mt-4 space-y-2.5 text-sm">
                <li className="flex items-center gap-2">
                  <svg
                    className="text-foreground/40 h-4 w-4 flex-none"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                  <a className="text-foreground/60 hover:text-primary transition" href="tel:+18106263343">
                    +1-810-626-EDGE
                  </a>
                </li>
                <li className="flex items-center gap-2">
                  <svg
                    className="text-foreground/40 h-4 w-4 flex-none"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <path d="m22 7-10 6L2 7" />
                  </svg>
                  <a
                    className="text-foreground/60 hover:text-primary transition"
                    href="mailto:support@hubsign.io"
                  >
                    support@hubsign.io
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="border-border/60 text-foreground/50 mt-10 flex flex-col gap-2 border-t pt-6 text-xs sm:flex-row sm:items-center sm:justify-between">
            <span>© {new Date().getFullYear()} HubSign. All rights reserved.</span>
            <span>A product of Future Edge Technology Inc.</span>
          </div>
        </div>
      </div>
    ),
  },

  // HubSign brand purple.
  primaryHue: 268,
  primarySaturation: 84,

  useNextSeoProps() {
    return {
      titleTemplate: '%s | HubSign Docs',
    };
  },
};

export default themeConfig;
