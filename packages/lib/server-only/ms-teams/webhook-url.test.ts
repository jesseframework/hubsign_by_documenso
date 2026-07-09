import { describe, expect, it } from 'vitest';

import { assertSafeWebhookUrl, maskWebhookUrl } from './webhook-url';

const POWER_AUTOMATE_URL =
  'https://prod-12.westus.logic.azure.com/workflows/abc123/triggers/manual/paths/invoke?api-version=2016-06-01&sig=SECRETSIG9xyz';

describe('assertSafeWebhookUrl', () => {
  it('accepts a real Power Automate flow URL', () => {
    expect(() => assertSafeWebhookUrl(POWER_AUTOMATE_URL)).not.toThrow();
  });

  it('rejects loopback and internal hostnames', () => {
    const hosts = [
      'https://localhost/hook',
      'https://foo.localhost/hook',
      'https://db.internal/hook',
      'https://printer.local/hook',
      'https://router.home.arpa/hook',
    ];

    for (const url of hosts) {
      expect(() => assertSafeWebhookUrl(url), url).toThrow(/internal host/);
    }
  });

  it('rejects the cloud metadata service', () => {
    expect(() => assertSafeWebhookUrl('https://169.254.169.254/latest/meta-data/')).toThrow(
      /private address/,
    );
  });

  it('rejects private IPv4 ranges', () => {
    const hosts = [
      'https://127.0.0.1/',
      'https://10.1.2.3/',
      'https://172.16.0.1/',
      'https://172.31.255.254/',
      'https://192.168.1.1/',
      'https://100.64.0.1/', // CGNAT
      'https://0.0.0.0/',
    ];

    for (const url of hosts) {
      expect(() => assertSafeWebhookUrl(url), url).toThrow(/private address/);
    }
  });

  it('allows 172.32.x (outside the private /12) to fall through to the IP-literal rule', () => {
    // Not private, but still an IP literal — a flow URL is never an IP.
    expect(() => assertSafeWebhookUrl('https://172.32.0.1/')).toThrow(/not an IP address/);
  });

  it('rejects IPv6 literals', () => {
    expect(() => assertSafeWebhookUrl('https://[::1]/hook')).toThrow(/IP address/);
    expect(() => assertSafeWebhookUrl('https://[fd00::1]/hook')).toThrow(/IP address/);
  });

  it('rejects non-https', () => {
    expect(() => assertSafeWebhookUrl('http://prod-12.westus.logic.azure.com/x')).toThrow(
      /must use https/,
    );
  });

  it('rejects embedded credentials', () => {
    expect(() => assertSafeWebhookUrl('https://u:p@prod-12.westus.logic.azure.com/x')).toThrow(
      /credentials/,
    );
  });

  it('rejects malformed input', () => {
    expect(() => assertSafeWebhookUrl('nonsense')).toThrow(/valid URL/);
  });
});

describe('maskWebhookUrl', () => {
  it('never leaks the sig query parameter', () => {
    const masked = maskWebhookUrl(POWER_AUTOMATE_URL);

    expect(masked).not.toContain('SECRETSIG9xyz');
    expect(masked).not.toContain('sig=');
    expect(masked).toContain('prod-12.westus.logic.azure.com');
  });

  it('keeps a short tail so admins can tell two URLs apart', () => {
    expect(maskWebhookUrl(POWER_AUTOMATE_URL)).toContain('9xyz');
  });

  it('degrades safely on garbage input', () => {
    expect(maskWebhookUrl('not a url')).toBe('…');
  });
});
