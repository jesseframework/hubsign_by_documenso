/**
 * Validation and masking for user-supplied Teams webhook URLs.
 *
 * An org admin pastes a Power Automate flow URL and the server then POSTs to it.
 * That is SSRF by design — but it should not become a tool for probing the
 * deployment's private network, so obviously-internal targets are refused.
 *
 * HONEST LIMITATION: this is a hostname/IP-literal check, not a resolve-and-pin.
 * An attacker-controlled public hostname can still resolve to a private address
 * (DNS rebinding). Closing that requires resolving at request time and pinning
 * the socket to the resolved public IP. The existing generic `Webhook` model has
 * the same exposure and no check at all, so this is strictly an improvement, not
 * a complete defence.
 */

/** Power Automate flow URLs are always hostnames, never IP literals. */
const IPV4_LITERAL = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

const isPrivateIpv4 = (host: string): boolean => {
  const parts = host.split('.').map(Number);

  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return true; // malformed dotted-quad — refuse rather than guess
  }

  const [a, b] = parts;

  return (
    a === 0 || // 0.0.0.0/8
    a === 10 || // 10.0.0.0/8
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
    (a === 169 && b === 254) || // link-local, incl. 169.254.169.254 metadata
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) || // 192.168.0.0/16
    a >= 224 // multicast + reserved
  );
};

const INTERNAL_HOST_SUFFIXES = ['.local', '.internal', '.localhost', '.home.arpa'];

export class MsTeamsWebhookUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MsTeamsWebhookUrlError';
  }
}

/**
 * @throws {MsTeamsWebhookUrlError} when the URL is unusable or points somewhere
 * the server has no business POSTing to.
 */
export const assertSafeWebhookUrl = (raw: string): URL => {
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new MsTeamsWebhookUrlError('That does not look like a valid URL.');
  }

  if (url.protocol !== 'https:') {
    throw new MsTeamsWebhookUrlError('The webhook URL must use https.');
  }

  if (url.username || url.password) {
    throw new MsTeamsWebhookUrlError('The webhook URL must not contain credentials.');
  }

  const host = url.hostname.toLowerCase();

  if (host === 'localhost' || INTERNAL_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new MsTeamsWebhookUrlError('The webhook URL must not point at an internal host.');
  }

  // Bracketed IPv6 literals arrive as `[::1]` → hostname `[::1]`.
  if (host.startsWith('[')) {
    throw new MsTeamsWebhookUrlError('The webhook URL must not use an IP address.');
  }

  if (IPV4_LITERAL.test(host)) {
    if (isPrivateIpv4(host)) {
      throw new MsTeamsWebhookUrlError('The webhook URL must not point at a private address.');
    }

    throw new MsTeamsWebhookUrlError('The webhook URL must use a hostname, not an IP address.');
  }

  return url;
};

/**
 * A Power Automate flow URL carries its authorisation in the `?sig=` query
 * parameter — anyone holding the full URL can post into the channel. It is a
 * bearer credential, so it is never returned to the client in full.
 */
export const maskWebhookUrl = (raw: string): string => {
  try {
    const url = new URL(raw);
    const tail = raw.slice(-4);

    return `https://${url.host}/…${tail}`;
  } catch {
    return '…';
  }
};
