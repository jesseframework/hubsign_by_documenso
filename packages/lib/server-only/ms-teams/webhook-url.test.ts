import { describe, expect, it } from 'vitest';

import { assertSafeWebhookUrl, maskWebhookUrl } from './webhook-url';

const POWER_AUTOMATE_URL =
  'https://prod-12.westus.logic.azure.com/workflows/abc123/triggers/manual/paths/invoke?api-version=2016-06-01&sig=SECRETSIG9xyz';

/** The shape Teams "Copy webhook link" produces on a current tenant. */
const POWER_PLATFORM_URL =
  'https://default1111.ca.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/19/workflows/abc123/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=SECRETSIG9xyz';

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

  it('rejects a "copy link to channel" URL with the correction, not a generic error', () => {
    // The real-world failure: this passes every SSRF check, saves fine, then
    // answers the first card with 405 Method Not Allowed.
    const channelLink =
      'https://teams.microsoft.com/l/channel/19%3aabc123%40thread.tacv2/Hubsign?groupId=1111-2222&tenantId=3333-a9ca';

    expect(() => assertSafeWebhookUrl(channelLink)).toThrow(/link to the channel itself/);
    expect(() => assertSafeWebhookUrl(channelLink)).toThrow(/Post to a channel when a webhook/);
  });

  it('rejects other Microsoft surfaces that are not webhook endpoints', () => {
    expect(() => assertSafeWebhookUrl('https://contoso.sharepoint.com/sites/x')).toThrow(
      /not a webhook endpoint/,
    );
    expect(() => assertSafeWebhookUrl('https://outlook.office.com/mail/')).toThrow(
      /not a webhook endpoint/,
    );
  });

  it('rejects an arbitrary public host, naming the expected one', () => {
    expect(() => assertSafeWebhookUrl('https://example.com/hook')).toThrow(
      /is not a Microsoft Teams webhook host/,
    );
    expect(() => assertSafeWebhookUrl('https://example.com/hook')).toThrow(/logic\.azure\.com/);
  });

  it('accepts the regional and legacy connector hosts', () => {
    const accepted = [
      'https://prod-12.westus.logic.azure.com/workflows/a/triggers/manual/paths/invoke?sig=x',
      'https://prod-03.usgovvirginia.logic.azure.us/workflows/a/triggers/manual/paths/invoke?sig=x',
      'https://contoso.webhook.office.com/webhookb2/abc@def/IncomingWebhook/ghi/jkl',
    ];

    for (const url of accepted) {
      expect(() => assertSafeWebhookUrl(url), url).not.toThrow();
    }
  });

  it('accepts the current Power Platform host, including its explicit :443', () => {
    // What "Copy webhook link" produces in Teams today. The port is spelled out
    // in the URL Teams hands over, and `logic.azure.com` never appears.
    expect(() => assertSafeWebhookUrl(POWER_PLATFORM_URL)).not.toThrow();
  });

  it('does not let a powerplatform lookalike slip past the suffix check', () => {
    expect(() =>
      assertSafeWebhookUrl('https://environment.api.powerplatform.com.evil.test/x'),
    ).toThrow(/is not a Microsoft Teams webhook host/);
  });

  it('does not let a lookalike host slip past the suffix check', () => {
    // Suffix matching must not accept an attacker-registered lookalike.
    expect(() => assertSafeWebhookUrl('https://logic.azure.com.evil.test/x')).toThrow(
      /is not a Microsoft Teams webhook host/,
    );
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
