import { retryAfterSeconds } from './resilience.js';

export const OPENSKY_TOKEN_ENDPOINT = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

export type OpenSkyCredentials = { clientId?: string; clientSecret?: string };
export type OpenSkyAuthErrorKind = 'credentials' | 'token_transport' | 'token_http' | 'token_response' | 'states_transport';

export class OpenSkyAuthError extends Error {
  constructor(
    readonly kind: OpenSkyAuthErrorKind,
    message: string,
    options?: ErrorOptions,
    readonly status?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message, options);
    this.name = 'OpenSkyAuthError';
  }
}

type AuthOptions = {
  fetchImpl?: typeof fetch;
  getCredentials?: () => OpenSkyCredentials;
  now?: () => number;
  onDiagnostic?: (event: string, details: Record<string, unknown>) => void;
};

type CachedToken = { value: string; refreshAt: number };

export function createOpenSkyAuthenticator(options: AuthOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const getCredentials = options.getCredentials ?? (() => ({
    clientId: process.env.OPENSKY_CLIENT_ID,
    clientSecret: process.env.OPENSKY_CLIENT_SECRET,
  }));
  const now = options.now ?? Date.now;
  const diagnostic = options.onDiagnostic ?? (() => undefined);
  let cachedToken: CachedToken | null = null;
  let tokenRefresh: Promise<string> | null = null;

  function credentials(): OpenSkyCredentials {
    const configured = getCredentials();
    const clientId = configured.clientId?.trim();
    const clientSecret = configured.clientSecret?.trim();
    if (!clientId && !clientSecret) return {};
    if (!clientId || !clientSecret) {
      throw new OpenSkyAuthError('credentials', 'OpenSky OAuth credentials are incomplete.');
    }
    return { clientId, clientSecret };
  }

  function mode(): 'oauth2' | 'anonymous' | 'misconfigured' {
    try {
      return credentials().clientId ? 'oauth2' : 'anonymous';
    } catch {
      return 'misconfigured';
    }
  }

  async function acquireToken(): Promise<string> {
    const configured = credentials();
    if (!configured.clientId || !configured.clientSecret) {
      throw new OpenSkyAuthError('credentials', 'OpenSky OAuth credentials are not configured.');
    }
    diagnostic('token_refresh_started', { mode: 'oauth2' });
    const form = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: configured.clientId,
      client_secret: configured.clientSecret,
    });
    let response: Response;
    try {
      response = await fetchImpl(OPENSKY_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
        signal: AbortSignal.timeout(8_000),
      });
    } catch (error) {
      const causeCode = error instanceof Error && 'cause' in error
        ? (error.cause as { code?: unknown } | undefined)?.code
        : undefined;
      diagnostic('token_transport_failure', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
        causeCode: typeof causeCode === 'string' ? causeCode : null,
      });
      const detail = typeof causeCode === 'string' ? ` (${causeCode})` : '';
      throw new OpenSkyAuthError('token_transport', `OpenSky OAuth token endpoint could not be reached${detail}.`, { cause: error });
    }
    if (!response.ok) {
      diagnostic('token_http_failure', { status: response.status });
      const limited = response.status === 429;
      const retry = limited
        ? retryAfterSeconds(response.headers.get('x-rate-limit-retry-after-seconds'), response.headers.get('retry-after'))
        : undefined;
      throw new OpenSkyAuthError(
        'token_http',
        `OpenSky OAuth token endpoint returned HTTP ${response.status}.`,
        undefined,
        limited ? 429 : undefined,
        retry,
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new OpenSkyAuthError('token_response', 'OpenSky OAuth token endpoint returned invalid JSON.', { cause: error });
    }
    const tokenBody = body as { access_token?: unknown; expires_in?: unknown };
    if (typeof tokenBody?.access_token !== 'string' || !tokenBody.access_token ||
        typeof tokenBody.expires_in !== 'number' || !Number.isFinite(tokenBody.expires_in) || tokenBody.expires_in <= 0) {
      throw new OpenSkyAuthError('token_response', 'OpenSky OAuth token response was missing a valid token or expiry.');
    }
    const lifetimeMs = tokenBody.expires_in * 1_000;
    const refreshSkewMs = Math.min(30_000, lifetimeMs * 0.1);
    cachedToken = { value: tokenBody.access_token, refreshAt: now() + lifetimeMs - refreshSkewMs };
    diagnostic('token_acquired', { mode: 'oauth2', expiresInSeconds: tokenBody.expires_in });
    return cachedToken.value;
  }

  async function getToken(): Promise<string | null> {
    const configured = credentials();
    if (!configured.clientId) {
      diagnostic('authentication_mode', { mode: 'anonymous' });
      return null;
    }
    if (cachedToken && cachedToken.refreshAt > now()) {
      diagnostic('token_cache_hit', { mode: 'oauth2' });
      return cachedToken.value;
    }
    if (!tokenRefresh) {
      const pending = acquireToken();
      tokenRefresh = pending;
      pending.finally(() => {
        if (tokenRefresh === pending) tokenRefresh = null;
      }).catch(() => undefined);
    } else {
      diagnostic('token_refresh_deduplicated', { mode: 'oauth2' });
    }
    return tokenRefresh;
  }

  function invalidateToken(value: string | null) {
    if (value && cachedToken?.value === value) {
      cachedToken = null;
      diagnostic('token_invalidated', { mode: 'oauth2', reason: 'upstream_401' });
    }
  }

  async function fetchWithAuth(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
    const token = await getToken();
    const send = (value: string | null) => {
      const headers = new Headers(init.headers);
      if (value) headers.set('Authorization', `Bearer ${value}`);
      else headers.delete('Authorization');
      return fetchImpl(input, { ...init, headers });
    };
    let response: Response;
    try {
      response = await send(token);
    } catch (error) {
      const causeCode = error instanceof Error && 'cause' in error
        ? (error.cause as { code?: unknown } | undefined)?.code
        : undefined;
      diagnostic('states_transport_failure', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
        causeCode: typeof causeCode === 'string' ? causeCode : null,
      });
      const detail = typeof causeCode === 'string' ? ` (${causeCode})` : '';
      throw new OpenSkyAuthError('states_transport', `OpenSky states request could not connect to the upstream service${detail}.`, { cause: error });
    }
    if (response.status !== 401 || !token) return response;

    invalidateToken(token);
    const refreshedToken = await getToken();
    try {
      return await send(refreshedToken);
    } catch (error) {
      const causeCode = error instanceof Error && 'cause' in error
        ? (error.cause as { code?: unknown } | undefined)?.code
        : undefined;
      diagnostic('states_transport_failure', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
        causeCode: typeof causeCode === 'string' ? causeCode : null,
      });
      const detail = typeof causeCode === 'string' ? ` (${causeCode})` : '';
      throw new OpenSkyAuthError('states_transport', `OpenSky states retry could not connect to the upstream service${detail}.`, { cause: error });
    }
  }

  return { mode, getToken, invalidateToken, fetchWithAuth };
}
