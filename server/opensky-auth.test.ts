import { describe, expect, it, vi } from 'vitest';
import { classifyOpenSkyTransportError, createOpenSkyAuthenticator, OpenSkyAuthError, OPENSKY_TOKEN_ENDPOINT } from './opensky-auth.js';

const tokenResponse = (accessToken: string, expiresIn = 3600) => new Response(
  JSON.stringify({ access_token: accessToken, expires_in: expiresIn, token_type: 'Bearer' }),
  { status: 200, headers: { 'Content-Type': 'application/json' } },
);

describe('OpenSky OAuth client credentials', () => {
  it.each([
    [Object.assign(new Error('dns'), { cause: Object.assign(new Error('lookup'), { code: 'ENOTFOUND' }) }), 'dns_resolution_failure'],
    [Object.assign(new Error('connect'), { cause: Object.assign(new Error('timeout'), { code: 'UND_ERR_CONNECT_TIMEOUT' }) }), 'tcp_connection_failure'],
    [Object.assign(new Error('tls'), { cause: Object.assign(new Error('handshake'), { code: 'ERR_TLS_HANDSHAKE_TIMEOUT' }) }), 'tls_handshake_failure'],
    [new DOMException('timed out', 'TimeoutError'), 'abort_timeout'],
  ])('classifies transport failures safely', (error, expected) => {
    expect(classifyOpenSkyTransportError(error)).toBe(expected);
    expect(classifyOpenSkyTransportError(error)).not.toContain('secret');
  });

  it('acquires a token with the official client_credentials form', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(tokenResponse('secret-token'));
    const diagnostics: Array<[string, Record<string, unknown>]> = [];
    const auth = createOpenSkyAuthenticator({
      fetchImpl,
      getCredentials: () => ({ clientId: 'client-id', clientSecret: 'client-secret' }),
      onDiagnostic: (event, details) => diagnostics.push([event, details]),
    });

    await expect(auth.getToken()).resolves.toBe('secret-token');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(OPENSKY_TOKEN_ENDPOINT);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/x-www-form-urlencoded' });
    expect(String(init?.body)).toContain('grant_type=client_credentials');
    expect(String(init?.body)).toContain('client_id=client-id');
    expect(String(init?.body)).toContain('client_secret=client-secret');
    expect(JSON.stringify(diagnostics)).not.toContain('secret-token');
    expect(JSON.stringify(diagnostics)).not.toContain('client-secret');
  });

  it('keeps credentials absent in anonymous mode without calling the token endpoint', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const auth = createOpenSkyAuthenticator({ fetchImpl, getCredentials: () => ({}) });
    expect(auth.mode()).toBe('anonymous');
    await expect(auth.getToken()).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects partially configured credentials without revealing which value is missing', async () => {
    const auth = createOpenSkyAuthenticator({ getCredentials: () => ({ clientId: 'client-id' }) });
    expect(auth.mode()).toBe('misconfigured');
    await expect(auth.getToken()).rejects.toMatchObject({ kind: 'credentials' });
  });

  it('caches until shortly before expiry, then refreshes', async () => {
    let now = 1_000;
    let sequence = 0;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => tokenResponse(`token-${++sequence}`, 100));
    const auth = createOpenSkyAuthenticator({
      fetchImpl,
      getCredentials: () => ({ clientId: 'id', clientSecret: 'secret' }),
      now: () => now,
    });

    await expect(auth.getToken()).resolves.toBe('token-1');
    now += 89_000;
    await expect(auth.getToken()).resolves.toBe('token-1');
    now += 1_000;
    await expect(auth.getToken()).resolves.toBe('token-2');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent token refreshes', async () => {
    let resolveResponse!: (response: Response) => void;
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise((resolve) => { resolveResponse = resolve; }));
    const auth = createOpenSkyAuthenticator({
      fetchImpl,
      getCredentials: () => ({ clientId: 'id', clientSecret: 'secret' }),
    });

    const first = auth.getToken();
    const second = auth.getToken();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    resolveResponse(tokenResponse('shared-token'));
    await expect(Promise.all([first, second])).resolves.toEqual(['shared-token', 'shared-token']);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('invalidates a 401 token and retries the states request with one refreshed token', async () => {
    let tokenSequence = 0;
    const stateHeaders: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      if (String(input) === OPENSKY_TOKEN_ENDPOINT) return tokenResponse(`token-${++tokenSequence}`);
      stateHeaders.push(new Headers(init?.headers).get('Authorization') || '');
      return new Response('{}', { status: stateHeaders.length === 1 ? 401 : 200 });
    });
    const auth = createOpenSkyAuthenticator({
      fetchImpl,
      getCredentials: () => ({ clientId: 'id', clientSecret: 'secret' }),
    });

    const response = await auth.fetchWithAuth('https://opensky-network.org/api/states/all');
    expect(response.status).toBe(200);
    expect(stateHeaders).toEqual(['Bearer token-1', 'Bearer token-2']);
    expect(tokenSequence).toBe(2);
  });

  it('does not retry indefinitely after a second 401', async () => {
    let tokenSequence = 0;
    let statesCalls = 0;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      if (String(input) === OPENSKY_TOKEN_ENDPOINT) return tokenResponse(`token-${++tokenSequence}`);
      statesCalls += 1;
      return new Response('{}', { status: 401 });
    });
    const auth = createOpenSkyAuthenticator({
      fetchImpl,
      getCredentials: () => ({ clientId: 'id', clientSecret: 'secret' }),
    });

    const response = await auth.fetchWithAuth('https://opensky-network.org/api/states/all');
    expect(response.status).toBe(401);
    expect(statesCalls).toBe(2);
    expect(tokenSequence).toBe(2);
  });

  it('distinguishes token endpoint HTTP failures and transport failures', async () => {
    const badStatus = createOpenSkyAuthenticator({
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 503 })),
      getCredentials: () => ({ clientId: 'id', clientSecret: 'secret' }),
    });
    await expect(badStatus.getToken()).rejects.toBeInstanceOf(OpenSkyAuthError);
    await expect(badStatus.getToken()).rejects.toMatchObject({ kind: 'token_http' });

    const transport = createOpenSkyAuthenticator({
      fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new Error('connection failed')),
      getCredentials: () => ({ clientId: 'id', clientSecret: 'secret' }),
    });
    await expect(transport.getToken()).rejects.toMatchObject({ kind: 'token_transport' });
  });

  it.each([[401, 'http_401'], [403, 'http_403'], [429, 'http_429']])('logs token HTTP %s without response content', async (status, category) => {
    const diagnostics: Array<[string, Record<string, unknown>]> = [];
    const auth = createOpenSkyAuthenticator({
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response('sensitive-response-body', { status })),
      getCredentials: () => ({ clientId: 'id', clientSecret: 'secret' }),
      onDiagnostic: (event, details) => diagnostics.push([event, details]),
    });
    await expect(auth.getToken()).rejects.toBeInstanceOf(OpenSkyAuthError);
    const log = JSON.stringify(diagnostics);
    expect(log).toContain(category);
    expect(log).not.toContain('sensitive-response-body');
    expect(log).not.toContain('secret');
  });
});
