export type DaemonAuthResult =
  | { ok: true; token: string }
  | { ok: false; status: 401 | 500; body: { status: 'error'; code: string; message: string } };

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

export function validateDaemonAuth({
  req,
  expectedToken,
}: {
  req: Request;
  expectedToken?: string;
}): DaemonAuthResult {
  if (!expectedToken) {
    return {
      ok: false,
      status: 500,
      body: {
        status: 'error',
        code: 'DAEMON_AUTH_NOT_CONFIGURED',
        message: 'DAEMON_AUTH_TOKEN is not configured.',
      },
    };
  }

  const token = tokenFromRequest(req);
  if (!token || token !== expectedToken) {
    return {
      ok: false,
      status: 401,
      body: {
        status: 'error',
        code: 'INVALID_DAEMON_TOKEN',
        message: 'Invalid daemon token.',
      },
    };
  }

  return { ok: true, token };
}

export function redactToken(value: string): string {
  if (value.length <= 10) return '***';
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
