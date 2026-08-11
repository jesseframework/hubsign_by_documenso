import { describe, expect, it } from 'vitest';

import { shouldIncludeSigningCertificate } from './signing-certificate';

describe('shouldIncludeSigningCertificate', () => {
  it('defaults to on when nothing is configured', () => {
    // The certificate is the audit trail — absence of a setting must not read as
    // an opt-out, or an upgrade would silently stop producing it.
    expect(shouldIncludeSigningCertificate({})).toBe(true);
    expect(
      shouldIncludeSigningCertificate({ teamSetting: null, organizationSetting: null }),
    ).toBe(true);
    expect(
      shouldIncludeSigningCertificate({ teamSetting: undefined, organizationSetting: undefined }),
    ).toBe(true);
  });

  it('honours the organization setting when there is no team', () => {
    // The case that motivated this: documents here have no teamId, so before the
    // org fallback existed the setting was unreachable and always resolved true.
    expect(shouldIncludeSigningCertificate({ organizationSetting: false })).toBe(false);
    expect(shouldIncludeSigningCertificate({ organizationSetting: true })).toBe(true);
  });

  it('lets the team setting win as the narrower scope', () => {
    expect(
      shouldIncludeSigningCertificate({ teamSetting: false, organizationSetting: true }),
    ).toBe(false);
    expect(
      shouldIncludeSigningCertificate({ teamSetting: true, organizationSetting: false }),
    ).toBe(true);
  });

  it('falls through an unconfigured team to the organization', () => {
    // A team that has never opened its settings must not override the org.
    expect(
      shouldIncludeSigningCertificate({ teamSetting: null, organizationSetting: false }),
    ).toBe(false);
    expect(
      shouldIncludeSigningCertificate({ teamSetting: undefined, organizationSetting: false }),
    ).toBe(false);
  });
});
