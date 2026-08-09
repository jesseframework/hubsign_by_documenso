import type { DocsThemeConfig } from 'nextra-theme-docs';
import { useConfig } from 'nextra-theme-docs';

import { SITE_URL, SUPPORT_EMAIL } from './site';

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
  /**
   * Mirrors the hubsign.io site footer.
   *
   * Styled with plain classes against the `--hs-*` custom properties in
   * styles.css, NOT with `text-foreground` / `border-border` / `text-primary`
   * utilities. Those are the main application's design tokens; this docs app does
   * not define them, so every one of those utilities compiled to nothing and the
   * footer rendered with no text or border colours at all.
   */
  footer: {
    text: (
      <div className="hs-foot">
        <div className="hs-foot-grid">
          <div className="hs-foot-brand">
            <span className="hubsign-logo inline-flex">
              <img src="/hubsign-logo.png" alt="HubSign" />
            </span>

            <p className="hs-foot-tag">Enterprise-grade e-signatures made simple.</p>

            <div className="hs-foot-powered">
              <span>Powered by</span>
              <span className="futureedge-logo inline-flex">
                <img src="/futureedge-logo.png" alt="Future Edge Technology" />
              </span>
            </div>
          </div>

          <div className="hs-foot-col">
            <p className="hs-foot-h">Documentation</p>
            <ul className="hs-foot-list">
              <li><a href="/organization">Organization</a></li>
              <li><a href="/dms">Doc Manager</a></li>
              <li><a href="/users">Signing</a></li>
              <li><a href="/integrations">ERP &amp; Accounting</a></li>
              <li><a href="/manual">Full Manual</a></li>
            </ul>
          </div>

          <div className="hs-foot-col">
            <p className="hs-foot-h">Company</p>
            <ul className="hs-foot-list">
              <li><a href={SITE_URL} target="_blank" rel="noreferrer">hubsign.io</a></li>
              <li><a href={`${SITE_URL}/privacy`} target="_blank" rel="noreferrer">Privacy</a></li>
              <li><a href={`${SITE_URL}/terms`} target="_blank" rel="noreferrer">Terms</a></li>
            </ul>
          </div>

          <div className="hs-foot-col">
            <p className="hs-foot-h">Contact</p>
            <ul className="hs-foot-list">
              <li>
                <a href="tel:+18106263343">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                  +1-810-626-EDGE
                </a>
              </li>
              <li>
                <a href={`mailto:${SUPPORT_EMAIL}`}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <path d="m22 7-10 6L2 7" />
                  </svg>
                  {SUPPORT_EMAIL}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="hs-foot-bottom">
          <span>© {new Date().getFullYear()} HubSign. All rights reserved.</span>
          <span>A product of Future Edge Technology Inc.</span>
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
