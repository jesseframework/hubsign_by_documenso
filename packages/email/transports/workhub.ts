import type { SentMessageInfo, Transport } from 'nodemailer';
import type { Address, Attachment } from 'nodemailer/lib/mailer';
import type MailMessage from 'nodemailer/lib/mailer/mail-message';

const VERSION = '1.0.0';

type NodeMailerAddress = string | Address | Array<string | Address> | undefined;

interface WorkHubAttachment {
  fileName: string;
  contentBase64: string;
  mimeType?: string;
  isInline?: boolean;
  contentId?: string;
}

interface WorkHubTransportOptions {
  username: string;
  password: string;
  endpoint: string;
}

interface WorkHubSuccessResponse {
  ok: true;
  sentAt: string;
  exchangeItemId?: string;
  bulkSendEventId?: string;
  monthlyUsed?: number;
  monthlySendLimit?: number;
}

interface WorkHubErrorResponse {
  ok?: false;
  error?: string;
  detail?: unknown;
  message?: string;
}

/**
 * Transport for sending email through the WorkHub BulkSender HTTP API.
 *
 * Authenticates with HTTP Basic using a BulkSender credential issued from the
 * WorkHub portal (Email -> Bulk Senders -> {sender} -> Credentials). The sender
 * mailbox is bound to the credential server-side, so the `from` address on the
 * nodemailer message is ignored by the API.
 *
 * @see https://api.workhubplatform.io/v1/bulk-send
 */
export class WorkHubTransport implements Transport<SentMessageInfo> {
  public name = 'WorkHubBulkSenderTransport';
  public version = VERSION;

  private _options: WorkHubTransportOptions;

  public static makeTransport(options: Partial<WorkHubTransportOptions>) {
    return new WorkHubTransport(options);
  }

  constructor(options: Partial<WorkHubTransportOptions>) {
    const {
      username = '',
      password = '',
      endpoint = 'https://api.workhubplatform.io/v1/bulk-send',
    } = options;

    this._options = { username, password, endpoint };
  }

  public send(mail: MailMessage, callback: (_err: Error | null, _info: SentMessageInfo) => void) {
    if (!mail.data.to) {
      return callback(new Error('Missing required field "to"'), null);
    }

    if (!this._options.username || !this._options.password) {
      return callback(new Error('WorkHub transport requires username and password'), null);
    }

    const to = this.toEmailList(mail.data.to);
    const cc = this.toEmailList(mail.data.cc);
    const bcc = this.toEmailList(mail.data.bcc);
    const replyTo = this.toEmailList(mail.data.replyTo);

    if (to.length === 0) {
      return callback(new Error('At least one "to" recipient is required'), null);
    }

    const body: Record<string, unknown> = {
      to,
      subject: mail.data.subject ?? '',
    };

    if (cc.length > 0) body.cc = cc;
    if (bcc.length > 0) body.bcc = bcc;
    if (replyTo.length > 0) body.replyTo = replyTo;

    const htmlBody = mail.data.html?.toString('utf-8');
    const textBody = mail.data.text?.toString('utf-8');
    if (htmlBody) body.htmlBody = htmlBody;
    if (textBody) body.textBody = textBody;

    const importance = this.toImportance(mail.data.priority);
    if (importance) body.importance = importance;

    const attachments = this.toWorkHubAttachments(mail.data.attachments);
    if (attachments.length > 0) body.attachments = attachments;

    const basic = Buffer.from(`${this._options.username}:${this._options.password}`).toString(
      'base64',
    );

    fetch(this._options.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${basic}`,
      },
      body: JSON.stringify(body),
    })
      .then(async (res) => {
        if (res.status >= 200 && res.status <= 299) {
          const data = (await res.json().catch(() => ({}))) as Partial<WorkHubSuccessResponse>;

          return callback(null, {
            messageId: data.bulkSendEventId ?? data.exchangeItemId ?? '',
            envelope: {
              from: mail.data.from,
              to: mail.data.to,
            },
            accepted: mail.data.to,
            rejected: [],
            pending: [],
            response: JSON.stringify(data),
          });
        }

        const data = (await res.json().catch(() => ({}))) as WorkHubErrorResponse;
        const code = data.error ?? `http_${res.status}`;
        const detail = data.message ?? (data.detail ? JSON.stringify(data.detail) : '');
        const retryAfter = res.headers.get('retry-after');
        const suffix = retryAfter ? ` (retry-after: ${retryAfter}s)` : '';

        return callback(
          new Error(`WorkHub BulkSender error [${code}]${detail ? `: ${detail}` : ''}${suffix}`),
          null,
        );
      })
      .catch((err) => callback(err instanceof Error ? err : new Error(String(err)), null));
  }

  private toEmailList(address: NodeMailerAddress): string[] {
    if (!address) return [];

    if (typeof address === 'string') return [address];

    if (Array.isArray(address)) {
      return address.map((a) => (typeof a === 'string' ? a : a.address));
    }

    return [address.address];
  }

  private toImportance(priority: MailMessage['data']['priority']): 'Low' | 'Normal' | 'High' | null {
    if (priority === 'high') return 'High';
    if (priority === 'low') return 'Low';
    if (priority === 'normal') return 'Normal';
    return null;
  }

  private toWorkHubAttachments(attachments: Attachment[] | undefined): WorkHubAttachment[] {
    if (!attachments || attachments.length === 0) return [];

    const result: WorkHubAttachment[] = [];

    for (const att of attachments) {
      if (!att.content) continue;

      let contentBase64: string;

      if (Buffer.isBuffer(att.content)) {
        contentBase64 = att.content.toString('base64');
      } else if (typeof att.content === 'string') {
        contentBase64 =
          att.encoding === 'base64'
            ? att.content
            : Buffer.from(att.content, (att.encoding as BufferEncoding) ?? 'utf-8').toString(
                'base64',
              );
      } else {
        continue;
      }

      result.push({
        fileName: att.filename || 'attachment',
        contentBase64,
        mimeType: att.contentType,
        isInline: att.cid ? true : undefined,
        contentId: att.cid,
      });
    }

    return result;
  }
}
