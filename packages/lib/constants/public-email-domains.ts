/**
 * Shared mailbox providers, which identify no single organization.
 *
 * Two features key off an org's `allowedEmailDomains`, and both become dangerous
 * if a public provider is treated as a claimable corporate domain:
 *
 *   - member discovery would let an admin who typed `gmail.com` read back a
 *     directory of every Gmail account on the platform;
 *   - domain-claim signup blocking would let that same entry stop ALL Gmail
 *     users from signing up, platform-wide.
 *
 * `allowedEmailDomains` is unverified free text, so neither risk is hypothetical.
 * Anything in this set is ignored by both features.
 */
export const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'outlook.co.uk',
  'hotmail.com',
  'hotmail.co.uk',
  'live.com',
  'live.co.uk',
  'msn.com',
  'yahoo.com',
  'yahoo.co.uk',
  'yahoo.co.in',
  'ymail.com',
  'rocketmail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'gmx.com',
  'gmx.net',
  'gmx.de',
  'mail.com',
  'mail.ru',
  'zoho.com',
  'yandex.com',
  'yandex.ru',
  'qq.com',
  '163.com',
  '126.com',
  'hey.com',
  'fastmail.com',
  'fastmail.fm',
  'tutanota.com',
  'tuta.io',
  'hushmail.com',
  'inbox.com',
  'web.de',
  'comcast.net',
  'verizon.net',
  'att.net',
  'btinternet.com',
  'sky.com',
  'orange.fr',
  'free.fr',
  'libero.it',
  'naver.com',
  'daum.net',
]);

/**
 * An org's configured domains reduced to those it may legitimately claim users
 * on: trimmed, lowercased, `@` stripped, must look like a domain, and never a
 * shared provider.
 */
export const normalizeClaimableDomains = (raw: string[] | null | undefined): string[] => {
  const seen = new Set<string>();

  for (const entry of raw ?? []) {
    const domain = entry.trim().toLowerCase().replace(/^@/, '');

    if (domain && domain.includes('.') && !PUBLIC_EMAIL_DOMAINS.has(domain)) {
      seen.add(domain);
    }
  }

  return [...seen];
};

/** True when this domain is a shared provider and therefore unclaimable. */
export const isPublicEmailDomain = (domain: string): boolean =>
  PUBLIC_EMAIL_DOMAINS.has(domain.trim().toLowerCase().replace(/^@/, ''));
