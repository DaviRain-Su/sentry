export type TokenCheck =
  | { ok: true }
  | {
      ok: false;
      code: 'MISSING_TOKEN' | 'TOKEN_EXPIRED' | 'INVALID_TOKEN' | 'TOKEN_NOT_CONFIGURED';
    };

const encoder = new TextEncoder();

function tokenFromHeader(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null;
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function tokenFromRequest(req: Request): string | null {
  const headerToken = tokenFromHeader(req.headers.get('Authorization'));
  if (headerToken) return headerToken;
  const url = new URL(req.url);
  return url.searchParams.get('token')?.trim() || null;
}

export function randomToken(prefix: string): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const encoded = btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
  return `${prefix}_${encoded}`;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function checkToken({
  token,
  expectedHash,
  expiresAtMs,
  nowMs = Date.now(),
}: {
  token: string | null;
  expectedHash?: string | null;
  expiresAtMs?: number | null;
  nowMs?: number;
}): Promise<TokenCheck> {
  if (!expectedHash) return { ok: false, code: 'TOKEN_NOT_CONFIGURED' };
  if (!token) return { ok: false, code: 'MISSING_TOKEN' };
  if (expiresAtMs && nowMs > expiresAtMs) return { ok: false, code: 'TOKEN_EXPIRED' };
  const actualHash = await sha256Hex(token);
  if (actualHash !== expectedHash) return { ok: false, code: 'INVALID_TOKEN' };
  return { ok: true };
}

export function authErrorResponse(check: Exclude<TokenCheck, { ok: true }>): Response {
  const status = check.code === 'TOKEN_NOT_CONFIGURED' ? 500 : 401;
  return new Response(
    JSON.stringify({
      status: 'error',
      code: check.code,
      message:
        check.code === 'TOKEN_EXPIRED'
          ? 'Token expired.'
          : check.code === 'MISSING_TOKEN'
            ? 'Bearer token required.'
            : check.code === 'TOKEN_NOT_CONFIGURED'
              ? 'Token is not configured for this session.'
              : 'Invalid token.',
    }),
    { status, headers: { 'content-type': 'application/json' } }
  );
}

export function redactToken(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 10) return '***';
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
