/**
 * Builds an RFC 822 message (UTF-8 text body plus attachments) for creating an email draft. Runs in
 * the browser, so attachments go from the device straight to the user's mailbox.
 */
export interface MimeAttachment {
  filename: string;
  mime: string;
  bytes: Uint8Array;
}

export interface MimeMessage {
  to: string | null;
  subject: string;
  body: string;
  attachments: MimeAttachment[];
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const utf8 = (s: string) => new TextEncoder().encode(s);

/** RFC 2047 encoded-word, so Hebrew survives in headers. */
const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${base64(utf8(s))}?=`);

/** Base64 wrapped at 76 characters, as MIME requires. */
const wrapped = (bytes: Uint8Array) => base64(bytes).replace(/.{76}/g, "$&\r\n");

export function buildMime(msg: MimeMessage): string {
  const boundary = `insuragent-${Math.random().toString(36).slice(2)}`;
  const headers = [
    ...(msg.to ? [`To: ${msg.to}`] : []),
    `Subject: ${encodeHeader(msg.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  const parts = [
    ["Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrapped(utf8(msg.body))].join("\r\n"),
    ...msg.attachments.map((a) => {
      const name = encodeHeader(a.filename);
      return [
        `Content-Type: ${a.mime}; name="${name}"`,
        `Content-Disposition: attachment; filename="${name}"`,
        "Content-Transfer-Encoding: base64",
        "",
        wrapped(a.bytes),
      ].join("\r\n");
    }),
  ];
  return [...headers, "", ...parts.map((p) => `--${boundary}\r\n${p}`), `--${boundary}--`, ""].join("\r\n");
}
