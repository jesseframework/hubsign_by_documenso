import { describe, expect, it } from 'vitest';

import { assertAllowedServiceUrl } from './bot-connector';

/**
 * `assertAllowedServiceUrl` is the SSRF guard standing between a forged
 * `serviceUrl` and an outbound request carrying our bot's bearer token. If these
 * tests are ever relaxed, read the comment in constants/ms-teams.ts first.
 */
describe('assertAllowedServiceUrl', () => {
  it('accepts the real Bot Connector hosts', () => {
    const valid = [
      'https://smba.trafficmanager.net/amer/',
      'https://smba.trafficmanager.net/emea/',
      'https://smba.trafficmanager.net/apac/',
      'https://europe.botframework.com/',
      'https://api.botframework.com',
      'https://apis.skype.com/v3/conversations',
      'https://smba.infra.gov.teams.microsoft.us/',
    ];

    for (const url of valid) {
      expect(() => assertAllowedServiceUrl(url), url).not.toThrow();
    }
  });

  it('rejects an attacker-registrable trafficmanager.net subdomain', () => {
    // Azure Traffic Manager hands `*.trafficmanager.net` profiles to any
    // customer, so this must NOT be treated as a trusted suffix.
    expect(() => assertAllowedServiceUrl('https://evil.trafficmanager.net/')).toThrow(
      /host not allowed/,
    );
  });

  it('rejects lookalike and suffix-confusion hosts', () => {
    const invalid = [
      'https://botframework.com.evil.com/',
      'https://evilbotframework.com/',
      'https://notskype.com/',
      'https://evil.com/',
      'https://localhost/',
      'https://127.0.0.1/',
      'https://169.254.169.254/latest/meta-data/', // cloud metadata service
    ];

    for (const url of invalid) {
      expect(() => assertAllowedServiceUrl(url), url).toThrow(/host not allowed/);
    }
  });

  it('rejects non-https schemes', () => {
    expect(() => assertAllowedServiceUrl('http://smba.trafficmanager.net/')).toThrow(/must be https/);
    expect(() => assertAllowedServiceUrl('file:///etc/passwd')).toThrow(/must be https/);
  });

  it('rejects embedded credentials', () => {
    expect(() => assertAllowedServiceUrl('https://user:pass@smba.trafficmanager.net/')).toThrow(
      /must not carry credentials/,
    );
  });

  it('resolves userinfo tricks to the true host and rejects them', () => {
    // Hostname here is evil.com, not smba.trafficmanager.net.
    expect(() => assertAllowedServiceUrl('https://smba.trafficmanager.net@evil.com/')).toThrow();
  });

  it('rejects malformed input', () => {
    expect(() => assertAllowedServiceUrl('not a url')).toThrow(/Invalid Bot Connector serviceUrl/);
    expect(() => assertAllowedServiceUrl('')).toThrow(/Invalid Bot Connector serviceUrl/);
  });

  it('is case-insensitive on the host', () => {
    expect(() => assertAllowedServiceUrl('https://SMBA.TrafficManager.NET/amer/')).not.toThrow();
  });
});
