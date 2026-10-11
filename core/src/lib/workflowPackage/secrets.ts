/* The secret scan run before anything is packaged. The pattern list moved here
 * from prompd-cli's detectSecrets so the CLI and the app refuse the same text. */

export interface SecretHit {
  path: string
  /** 1-based line number. */
  line: number
  type: string
  /** The first 8 characters and "...", or "***" for a short match. */
  match: string
}

const SECRET_PATTERNS: ReadonlyArray<{ type: string; regex: RegExp }> = [
  { type: 'OpenAI API Key', regex: /sk-[a-zA-Z0-9]{20,}/g },
  { type: 'Anthropic API Key', regex: /sk-ant-[a-zA-Z0-9-_]{32,}/g },
  { type: 'Prompd Registry Token', regex: /prompd_[a-zA-Z0-9-_]{32,}/g },
  { type: 'Generic API Key', regex: /api[_-]?key["\s:=]+[a-zA-Z0-9-_]{20,}/gi },
  { type: 'Generic Secret', regex: /secret["\s:=]+[a-zA-Z0-9-_]{20,}/gi },
  { type: 'Generic Password', regex: /password["\s:=]+[^\s"',]{8,}/gi },
  { type: 'Private Key Header', regex: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g },
  { type: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/g },
  { type: 'AWS Secret Key', regex: /(?:aws_secret_access_key|AWS_SECRET)["\s:=]+[A-Za-z0-9/+=]{40}/gi },
  { type: 'GitHub Token', regex: /gh[pousr]_[a-zA-Z0-9]{36,}/g },
  { type: 'Slack Token', regex: /xox[bporas]-[a-zA-Z0-9-]{10,}/g },
  { type: 'Google API Key', regex: /AIza[0-9A-Za-z_-]{35}/g },
  { type: 'Stripe Key', regex: /[sr]k_(test|live)_[a-zA-Z0-9]{20,}/g },
  { type: 'URL-Embedded Credentials', regex: /https?:\/\/[^:@\s]+:[^:@\s]+@[^\s]+/g },
  { type: 'Bearer Token', regex: /bearer\s+[a-zA-Z0-9._\-]{20,}/gi },
  { type: 'JWT Token', regex: /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g },
]

/** Every likely secret in `text`, by line then pattern, as prompd-cli reported them. */
export function scanForSecrets(path: string, text: string): SecretHit[] {
  const hits: SecretHit[] = []
  const lines = text.split('\n')
  lines.forEach((line, index) => {
    for (const { type, regex } of SECRET_PATTERNS) {
      const matches = line.match(regex)
      if (!matches) continue
      for (const match of matches) {
        hits.push({ path, line: index + 1, type, match: match.length > 8 ? `${match.slice(0, 8)}...` : '***' })
      }
    }
  })
  return hits
}
