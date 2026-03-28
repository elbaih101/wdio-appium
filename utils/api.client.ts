import { request, APIRequestContext, APIResponse } from 'playwright';

// ═════════════════════════════════════════════════════════════════════════════
// Core Types
// ═════════════════════════════════════════════════════════════════════════════

/** Supported HTTP methods */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

/** Supported authentication strategies */
export type AuthStrategy =
  | { type: 'none' }
  | { type: 'bearer';  token: string }
  | { type: 'basic';   username: string; password: string }
  | { type: 'apiKey';  header: string; value: string }
  | { type: 'oauth2';  tokenEndpoint: string; clientId: string; clientSecret: string; username: string; password: string };

/** Request-level options that can override client defaults per call */
export interface RequestOptions {
  /** Additional / override headers for this request only */
  headers?: Record<string, string>;
  /** Query-string parameters — values are coerced to string */
  params?: Record<string, string | number | boolean>;
  /** Request body (object → JSON, string → raw) */
  data?: unknown;
  /** Send as application/x-www-form-urlencoded */
  form?: Record<string, string>;
  /** Multipart form data */
  multipart?: Record<string, string | { name: string; mimeType: string; buffer: Buffer }>;
  /** Override the auth strategy for this one request only */
  auth?: AuthStrategy;
  /** Timeout in milliseconds for this request */
  timeout?: number;
  /**
   * When true, a non-2xx status will NOT throw ApiError.
   * Use this when you intentionally test error responses.
   */
  allowAnyStatus?: boolean;
}

/** Normalised response returned by every HTTP method */
export interface ApiResponse<T = unknown> {
  status: number;
  ok: boolean;
  body: T;
  headers: Record<string, string>;
  /** Elapsed wall-clock time in milliseconds */
  duration: number;
  /** The raw Playwright APIResponse for advanced assertions */
  raw: APIResponse;
}

/** Hook executed before every request. Return the (modified) options. */
export type RequestInterceptor = (
  method: HttpMethod,
  path: string,
  options: RequestOptions
) => RequestOptions | Promise<RequestOptions>;

/** Hook executed after every response. Return the (modified) response. */
export type ResponseInterceptor = (
  response: ApiResponse
) => ApiResponse | Promise<ApiResponse>;

export interface RetryConfig {
  /** Maximum retry attempts (default: 0 = no retries) */
  attempts: number;
  /** Base delay in ms; doubles on each attempt (default: 500) */
  delay: number;
  /** Status codes that trigger a retry (default: [429, 502, 503, 504]) */
  retryOn: number[];
}

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface ApiClientConfig {
  /** Base URL, e.g. "https://api.example.com". Trailing slash is stripped. */
  baseURL: string;
  /** Default auth applied to every request (default: none) */
  auth?: AuthStrategy;
  /** Headers merged into every request */
  defaultHeaders?: Record<string, string>;
  /** Default timeout in ms (default: 30 000) */
  timeout?: number;
  /** Retry policy */
  retry?: Partial<RetryConfig>;
  /** Ignore TLS errors — useful for self-signed certs (default: false) */
  ignoreHTTPSErrors?: boolean;
  /**
   * Logger implementation.
   * Pass `null` to silence all output.
   * Omit to use the built-in console logger.
   */
  logger?: Logger | null;
}

// ═════════════════════════════════════════════════════════════════════════════
// Built-in console logger
// ═════════════════════════════════════════════════════════════════════════════

const consoleLogger: Logger = {
  info:  (msg) => console.log(`  [ApiClient] ℹ  ${msg}`),
  warn:  (msg) => console.warn(`  [ApiClient] ⚠  ${msg}`),
  error: (msg) => console.error(`  [ApiClient] ✖  ${msg}`),
};

// ═════════════════════════════════════════════════════════════════════════════
// ApiClient
// ═════════════════════════════════════════════════════════════════════════════

/**
 * General-purpose, framework-agnostic HTTP client built on Playwright's
 * APIRequestContext.
 *
 * Key features
 * ────────────
 * ✦ Zero domain coupling  — no app-specific logic lives here
 * ✦ Pluggable auth        — bearer / basic / API-key / OAuth2 / none
 * ✦ Request interceptors  — mutate headers, params, body globally
 * ✦ Response interceptors — log, transform, or validate every response
 * ✦ Auto-retry            — exponential back-off on transient errors
 * ✦ Child clients         — `extend()` creates an inherited scoped instance
 * ✦ Fluent builder        — `request()` chains headers, params, body cleanly
 * ✦ Typed responses       — every method is generic over the body type
 * ✦ ApiError              — carries the full response for test assertions
 *
 * Quick-start
 * ───────────
 * ```ts
 * const client = new ApiClient({ baseURL: 'https://api.example.com' });
 * await client.init();
 *
 * // Simple calls
 * const list  = await client.get<User[]>('/users');
 * const user  = await client.post<User>('/users', { name: 'Alice' });
 *
 * // Fluent builder
 * const page2 = await client
 *   .request('GET', '/users')
 *   .param('page', 2)
 *   .header('X-Trace-ID', crypto.randomUUID())
 *   .send<User[]>();
 *
 * // Scoped child for an admin sub-domain
 * const admin = client.extend({ defaultHeaders: { 'X-Admin-Key': 'secret' } });
 * await admin.get('/restricted');
 *
 * await client.dispose();
 * ```
 */
export class ApiClient {

  protected readonly config: Required<ApiClientConfig>;
  protected context!: APIRequestContext;

  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;

  private readonly requestInterceptors:  RequestInterceptor[]  = [];
  private readonly responseInterceptors: ResponseInterceptor[] = [];

  constructor(config: ApiClientConfig) {
    
    this.config = {
      baseURL:           config.baseURL.replace(/\/$/, ''),
      auth:              config.auth              ?? { type: 'none' },
      defaultHeaders:    config.defaultHeaders    ?? {},
      timeout:           config.timeout           ?? 30_000,
      ignoreHTTPSErrors: config.ignoreHTTPSErrors ?? false,
      logger:
        config.logger === null
          ? null
          : (config.logger ?? consoleLogger),
      retry: {
        attempts: config.retry?.attempts ?? 0,
        delay:    config.retry?.delay    ?? 500,
        retryOn:  config.retry?.retryOn  ?? [429, 502, 503, 504],
      },
    };
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Initialise the underlying Playwright HTTP context.
   * Call once — typically in a `before()` hook.
   * Returns `this` for chaining: `await client.init()`.
   */
  async init(): Promise<this> {
    this.context = await request.newContext({
      baseURL:           this.config.baseURL,
      extraHTTPHeaders:  this.config.defaultHeaders,
      timeout:           this.config.timeout,
      ignoreHTTPSErrors: this.config.ignoreHTTPSErrors,
    });
    this.log('info', `Initialised — ${this.config.baseURL}`);
    return this;
  }

  /** Tear down the HTTP context. Call in an `after()` hook. */
  async dispose(): Promise<void> {
    if (this.context) {
      await this.context.dispose();
      this.log('info', 'Context disposed');
    }
  }

  // ── Child / scoped client ──────────────────────────────────────────────────

  /**
   * Create a child client that inherits this client's context and config
   * but allows selective overrides.
   *
   * - The child shares the parent's already-initialised Playwright context.
   * - Headers are deep-merged (child wins on collisions).
   * - Interceptors are NOT inherited; register them separately on the child.
   *
   * @example
   * const v2 = client.extend({ baseURL: 'https://api.example.com/v2' });
   * const anon = client.extend({ auth: { type: 'none' } });
   */
  extend(overrides: Partial<ApiClientConfig>): this {
    const Child = this.constructor as new (cfg: ApiClientConfig) => this;
    const child = new Child({
      ...this.config,
      defaultHeaders: {
        ...this.config.defaultHeaders,
        ...(overrides.defaultHeaders ?? {}),
      },
      ...overrides,
    });
    child.context        = this.context;
    child.cachedToken    = this.cachedToken;
    child.tokenExpiresAt = this.tokenExpiresAt;
    return child;
  }

  // ── Interceptors ───────────────────────────────────────────────────────────

  /**
   * Register a request interceptor.
   * Interceptors run in registration order and can mutate options.
   *
   * @example
   * client.addRequestInterceptor((method, path, opts) => ({
   *   ...opts,
   *   headers: { ...opts.headers, 'X-Request-ID': crypto.randomUUID() },
   * }));
   */
  addRequestInterceptor(fn: RequestInterceptor): this {
    this.requestInterceptors.push(fn);
    return this;
  }

  /**
   * Register a response interceptor.
   *
   * @example
   * client.addResponseInterceptor((res) => {
   *   if (res.duration > 3000) console.warn('Slow:', res.duration);
   *   return res;
   * });
   */
  addResponseInterceptor(fn: ResponseInterceptor): this {
    this.responseInterceptors.push(fn);
    return this;
  }

  // ── Auth management ────────────────────────────────────────────────────────

  /**
   * Manually inject a Bearer token (e.g. obtained via a browser UI login).
   * @param expiresInSeconds - cache duration in seconds (default: 3600)
   */
  setBearerToken(token: string, expiresInSeconds = 3600): this {
    this.cachedToken    = token;
    this.tokenExpiresAt = Date.now() + expiresInSeconds * 1000;
    return this;
  }

  /** Clear the cached OAuth2 / Bearer token, forcing re-authentication. */
  clearToken(): this {
    this.cachedToken    = null;
    this.tokenExpiresAt = 0;
    return this;
  }

  /** Expose the current token (null if not yet obtained). */
  getToken(): string | null {
    return this.cachedToken;
  }

  // ── Fluent builder ─────────────────────────────────────────────────────────

  /**
   * Start a fluent request for the given method + path.
   *
   * @example
   * const res = await client
   *   .request('POST', '/users')
   *   .header('Idempotency-Key', uuid())
   *   .param('notify', true)
   *   .body({ name: 'Bob' })
   *   .allowAnyStatus()
   *   .send<User>();
   */
  request(method: HttpMethod, path: string): RequestBuilder {
    return new RequestBuilder(this, method, path);
  }

  // ── HTTP convenience methods ───────────────────────────────────────────────

  async get<T = unknown>(
    path: string,
    options?: Omit<RequestOptions, 'data'>
  ): Promise<ApiResponse<T>> {
    return this.send<T>('GET', path, options);
  }

  async post<T = unknown>(
    path: string,
    data?: unknown,
    options?: RequestOptions
  ): Promise<ApiResponse<T>> {
    return this.send<T>('POST', path, { ...options, data });
  }

  async put<T = unknown>(
    path: string,
    data?: unknown,
    options?: RequestOptions
  ): Promise<ApiResponse<T>> {
    return this.send<T>('PUT', path, { ...options, data });
  }

  async patch<T = unknown>(
    path: string,
    data?: unknown,
    options?: RequestOptions
  ): Promise<ApiResponse<T>> {
    return this.send<T>('PATCH', path, { ...options, data });
  }

  /**
   * DELETE with an optional body (needed for bulk-delete patterns like OrangeHRM).
   */
  async delete<T = unknown>(
    path: string,
    data?: unknown,
    options?: RequestOptions
  ): Promise<ApiResponse<T>> {
    return this.send<T>('DELETE', path, { ...options, data });
  }

  async head(
    path: string,
    options?: Omit<RequestOptions, 'data'>
  ): Promise<ApiResponse<null>> {
    return this.send<null>('HEAD', path, options);
  }

  // ── Assertion helpers (chainable) ──────────────────────────────────────────

  /**
   * Assert that a response has an expected HTTP status code.
   * Returns the response for further chaining.
   *
   * @example
   * const res = client.assertStatus(await client.post('/login', creds), 200);
   * client.assertStatus(res, [200, 201]);
   */
  assertStatus<T>(
    response: ApiResponse<T>,
    expected: number | number[],
    message?: string
  ): ApiResponse<T> {
    const allowed = Array.isArray(expected) ? expected : [expected];
    if (!allowed.includes(response.status)) {
      throw new Error(
        message ??
          `Expected status [${allowed.join(', ')}], got ${response.status}.\n` +
          `Body: ${JSON.stringify(response.body, null, 2)}`
      );
    }
    return response;
  }

  /**
   * Assert that the response body satisfies a predicate.
   * Returns the response for further chaining.
   *
   * @example
   * client.assertBody(res, (b) => Array.isArray(b) && b.length > 0, 'Expected non-empty list');
   */
  assertBody<T>(
    response: ApiResponse<T>,
    predicate: (body: T) => boolean,
    message = 'Response body assertion failed'
  ): ApiResponse<T> {
    if (!predicate(response.body)) {
      throw new Error(
        `${message}\nBody: ${JSON.stringify(response.body, null, 2)}`
      );
    }
    return response;
  }

  /**
   * Assert that the response completed within a given duration.
   *
   * @example
   * client.assertResponseTime(res, 2000); // must complete in under 2s
   */
  assertResponseTime<T>(
    response: ApiResponse<T>,
    maxMs: number
  ): ApiResponse<T> {
    if (response.duration > maxMs) {
      throw new Error(
        `Response took ${response.duration}ms — exceeded limit of ${maxMs}ms`
      );
    }
    return response;
  }

  // ── Core send ──────────────────────────────────────────────────────────────

  /**
   * Central dispatch. All convenience methods funnel through here.
   *
   * Flow: interceptors → auth → build request → retry loop → parse → interceptors
   */
  async send<T = unknown>(
    method: HttpMethod,
    path: string,
    options: RequestOptions = {}
  ): Promise<ApiResponse<T>> {
    this.assertContextReady();

    // ① Run request interceptors
    let opts = { ...options };
    for (const fn of this.requestInterceptors) {
      opts = await fn(method, path, opts);
    }

    // ② Resolve authentication headers
    const authStrategy = opts.auth ?? this.config.auth;
    const authHeaders  = await this.resolveAuthHeaders(authStrategy);

    // ③ Build query string
    const qs = opts.params
      ? '?' + new URLSearchParams(
          Object.fromEntries(
            Object.entries(opts.params).map(([k, v]) => [k, String(v)])
          )
        ).toString()
      : '';

    const url = `${path}${qs}`;

    // ④ Merge headers (priority: per-request > auth > defaults)
    const headers: Record<string, string> = {
      Accept:           'application/json',
      'Content-Type':   'application/json',
      ...this.config.defaultHeaders,
      ...authHeaders,
      ...(opts.headers ?? {}),
    };

    // ⑤ Retry loop
    const { attempts = 0,
        delay = 0,
        retryOn = [] } = this.config.retry;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= attempts; attempt++) {
      if (attempt > 0) {
        const backoff = delay * 2 ** (attempt - 1);
        this.log('warn', `Retry ${attempt}/${attempts} — waiting ${backoff}ms`);
        await sleep(backoff);
      }

      const t0 = Date.now();
      let raw: APIResponse;

      try {
        raw = await this.dispatch(method, url, headers, opts);
      } catch (err) {
        lastError = err as Error;
        if (attempt < attempts) continue;
        throw lastError;
      }

      const duration = Date.now() - t0;
      this.log('info', `${method} ${url} → ${raw.status()} (${duration}ms)`);

      // Retry on transient status codes
      if (attempt < attempts && retryOn.includes(raw.status())) {
        lastError = new Error(`Retryable status ${raw.status()}`);
        continue;
      }

      // ⑥ Parse response
      let response = await this.parse<T>(raw, duration);

      // ⑦ Run response interceptors
      for (const fn of this.responseInterceptors) {
        response = (await fn(response)) as ApiResponse<T>;
      }

      // ⑧ Throw on non-2xx (unless caller suppressed it)
      if (!response.ok && !opts.allowAnyStatus) {
        throw new ApiError<T>(method, url, response);
      }

      return response;
    }

    throw lastError ?? new Error('Request failed after exhausting retries');
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async resolveAuthHeaders(strategy: AuthStrategy): Promise<Record<string, string>> {
    switch (strategy.type) {
      case 'none':
        return {};

      case 'bearer':
        return { Authorization: `Bearer ${strategy.token}` };

      case 'basic': {
        const b64 = Buffer.from(`${strategy.username}:${strategy.password}`).toString('base64');
        return { Authorization: `Basic ${b64}` };
      }

      case 'apiKey':
        return { [strategy.header]: strategy.value };

      case 'oauth2':
        if (!this.cachedToken || Date.now() >= this.tokenExpiresAt) {
          await this.fetchOAuth2Token(strategy);
        }
        return { Authorization: `Bearer ${this.cachedToken!}` };
    }
  }

  private async fetchOAuth2Token(
    strategy: Extract<AuthStrategy, { type: 'oauth2' }>
  ): Promise<void> {
    this.log('info', `Fetching OAuth2 token from ${strategy.tokenEndpoint}`);
    const res = await this.context.post(strategy.tokenEndpoint, {
      data: {
        grant_type:    'password',
        client_id:     strategy.clientId,
        client_secret: strategy.clientSecret,
        username:      strategy.username,
        password:      strategy.password,
      },
      headers: { 'Content-Type': 'application/json' },
    });

    if (!res.ok()) {
      throw new Error(`OAuth2 token request failed (${res.status()}): ${await res.text()}`);
    }

    const json = await res.json();
    this.cachedToken    = json.access_token;
    this.tokenExpiresAt = Date.now() + (json.expires_in ?? 3600) * 1000;
    this.log('info', `Token cached, expires in ${json.expires_in ?? 3600}s`);
  }

  private async dispatch(
    method: HttpMethod,
    url: string,
    headers: Record<string, string>,
    opts: RequestOptions
  ): Promise<APIResponse> {
    const base = {
      headers,
      timeout: opts.timeout ?? this.config.timeout,
    };
    const body =
      opts.data      !== undefined ? { data:      opts.data      } :
      opts.form      !== undefined ? { form:      opts.form      } :
      opts.multipart !== undefined ? { multipart: opts.multipart } :
      {};
    const merged = { ...base, ...body };

    switch (method) {
      case 'GET':     return this.context.get(url,     merged);
      case 'POST':    return this.context.post(url,    merged);
      case 'PUT':     return this.context.put(url,     merged);
      case 'PATCH':   return this.context.patch(url,   merged);
      case 'DELETE':  return this.context.delete(url,  merged);
      case 'HEAD':    return this.context.head(url,    merged);
      case 'OPTIONS': return this.context.fetch(url, { method: 'OPTIONS', ...merged });
    }
  }

  private async parse<T>(raw: APIResponse, duration: number): Promise<ApiResponse<T>> {
    const ct = raw.headers()['content-type'] ?? '';
    let body: T;
    try {
      body = ct.includes('application/json')
        ? await raw.json()
        : (await raw.text()) as unknown as T;
    } catch {
      body = null as unknown as T;
    }
    return {
      status:   raw.status(),
      ok:       raw.ok(),
      body,
      headers:  raw.headers() as Record<string, string>,
      duration,
      raw,
    };
  }

  private assertContextReady(): void {
    if (!this.context) {
      throw new Error(
        'ApiClient has no context. Did you call `await client.init()`?'
      );
    }
  }

  protected log(level: 'info' | 'warn' | 'error', message: string): void {
    this.config.logger?.[level](message);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// RequestBuilder  (fluent interface)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Fluent builder for constructing a single HTTP request.
 * Obtain via `client.request(method, path)`.
 */
export class RequestBuilder {
  private readonly _client: ApiClient;
  private readonly _method: HttpMethod;
  private readonly _path: string;
  private _opts: RequestOptions = {};

  constructor(client: ApiClient, method: HttpMethod, path: string) {
    this._client = client;
    this._method = method;
    this._path   = path;
  }

  header(name: string, value: string): this {
    this._opts.headers = { ...this._opts.headers, [name]: value };
    return this;
  }

  headers(headers: Record<string, string>): this {
    this._opts.headers = { ...this._opts.headers, ...headers };
    return this;
  }

  param(name: string, value: string | number | boolean): this {
    this._opts.params = { ...this._opts.params, [name]: value };
    return this;
  }

  params(params: Record<string, string | number | boolean>): this {
    this._opts.params = { ...this._opts.params, ...params };
    return this;
  }

  body(data: unknown): this {
    this._opts.data = data;
    return this;
  }

  form(fields: Record<string, string>): this {
    this._opts.form = fields;
    return this;
  }

  auth(strategy: AuthStrategy): this {
    this._opts.auth = strategy;
    return this;
  }

  /** Do not throw on non-2xx responses */
  allowAnyStatus(): this {
    this._opts.allowAnyStatus = true;
    return this;
  }

  timeout(ms: number): this {
    this._opts.timeout = ms;
    return this;
  }

  /** Dispatch the request */
  async send<T = unknown>(): Promise<ApiResponse<T>> {
    return this._client.send<T>(this._method, this._path, this._opts);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// ApiError
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Thrown when the server returns a non-2xx status and `allowAnyStatus` is
 * not set.  Carries the full ApiResponse so tests can inspect body / headers.
 *
 * @example
 * try {
 *   await client.delete('/users/1');
 * } catch (e) {
 *   if (e instanceof ApiError) {
 *     expect(e.response.status).to.equal(404);
 *   }
 * }
 */
export class ApiError<T = unknown> extends Error {
  readonly method: HttpMethod;
  readonly url: string;
  readonly response: ApiResponse<T>;

  constructor(method: HttpMethod, url: string, response: ApiResponse<T>) {
    super(
      `${method} ${url} → ${response.status}\n` +
      `Body: ${JSON.stringify(response.body, null, 2)}`
    );
    this.name     = 'ApiError';
    this.method   = method;
    this.url      = url;
    this.response = response;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Helpers
// ═════════════════════════════════════════════════════════════════════════════

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}