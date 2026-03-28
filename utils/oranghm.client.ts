// utils/oranghm.client.ts
import { ApiClient, ApiClientConfig, ApiResponse, HttpMethod } from './api.client';

export interface CandidatePayload {
  firstName: string;
  middleName?: string;
  lastName: string;
  email: string;
  contactNumber?: string;
  dateOfApplication: string;
  vacancyId: number;
  keywords?: string;
  comment?: string;
  consentToKeepData: boolean;
}

export interface CandidateData {
  id: number;
  firstName: string;
  middleName?: string;
  lastName: string;
  email: string;
  contactNumber?: string;
  consentToKeepData: boolean;
  keywords?: string;
  comment?: string;
  dateOfApplication: { year: number; month: string; day: string };
  vacancy?: { id: number; name: string };
}

export interface OrangeHRMEnvelope<T> {
  data: T;
  meta: Record<string, unknown>;
  rels: unknown[];
}

export interface OrangeHRMClientConfig
  extends Omit<ApiClientConfig, 'auth'> {
  username: string;
  password: string;
}

export class OrangeHRMClient extends ApiClient {
  private username: string;
  private password: string;
  private csrfToken: string | null = null;
  private sessionCookie: string | null = null;
  private vueToken: string | null = null;
  private isAuthenticated = false;

  constructor(config: OrangeHRMClientConfig) {
    super({
      ...config,
      auth: { type: 'none' },
      defaultHeaders: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(config.defaultHeaders ?? {}),
      },
      ignoreHTTPSErrors: config.ignoreHTTPSErrors ?? true,
    });
    
    this.username = config.username;
    this.password = config.password;
  }

  async init(): Promise<this> {
    await super.init();
    await this.authenticate();
    return this;
  }

  /**
   * Authenticate with OrangeHRM using API-based authentication
   * OrangeHRM 5.8+ uses token-based authentication via /auth/login endpoint
   */
  private async authenticate(): Promise<void> {
    this.log('info', `🔐 Authenticating as ${this.username}...`);

    try {
      // Step 1: Get CSRF token from login page
      const loginPageResponse = await this.get('/web/index.php/auth/login', {
        allowAnyStatus: true,
      });

      if (loginPageResponse.status !== 200) {
        throw new Error(`Failed to load login page: ${loginPageResponse.status}`);
      }

      const html = loginPageResponse.body as string;
      
      // Extract the token from the Vue component prop
      const tokenMatch = html.match(/:token="&quot;([^&]+)&quot;"/);
      
      if (!tokenMatch) {
        throw new Error('Could not extract authentication token from login page');
      }
      
      // The token is URL-encoded, decode it
      this.vueToken = decodeURIComponent(tokenMatch[1]);
      this.log('info', `✅ Vue token extracted successfully`);

      // Step 2: Perform login using the API endpoint with token
      const validateResponse = await this.post(
        '/web/index.php/auth/validate',
        {
          username: this.username,
          password: this.password,
          _token: this.vueToken, // Include the token from the page
        },
        {
          allowAnyStatus: true,
        }
      );

      if (validateResponse.status !== 200 && validateResponse.status !== 201) {
        throw new Error(
          `Authentication failed with status: ${validateResponse.status}\n` +
          `Response: ${JSON.stringify(validateResponse.body, null, 2)}`
        );
      }

      // Extract session cookie from response headers
      const setCookieHeader = validateResponse.headers['set-cookie'];
      if (setCookieHeader) {
        const cookieMatch = setCookieHeader.match(/orangehrm=([^;]+)/);
        if (cookieMatch) {
          this.sessionCookie = cookieMatch[1];
          this.log('info', `✅ Session cookie captured: ${this.sessionCookie.substring(0, 20)}...`);
        }
      }

      // Extract CSRF token from login response if present
      if (validateResponse.body && 
        typeof validateResponse.body === 'object' &&
        'data' in validateResponse.body &&
        validateResponse.body.data &&
        typeof validateResponse.body.data === 'object' &&
        'token' in validateResponse.body.data) {
      
        this.csrfToken = (validateResponse.body.data as { token: string }).token;
        this.log('info', `✅ CSRF token obtained from login response`);
      }

      // Step 3: Verify authentication by accessing a protected endpoint
      const verifyResponse = await this.get('/web/index.php/dashboard/index', {
        allowAnyStatus: true,
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        }
      });

      if (verifyResponse.status === 200) {
        this.isAuthenticated = true;
        this.log('info', '✅ Authentication successful');
      } else {
        throw new Error(`Authentication verification failed with status: ${verifyResponse.status}`);
      }
      
      // Small delay to ensure session is fully established
      await this.sleep(500);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log('error', `❌ Authentication failed: ${errorMessage}`);
      throw error;
    }
  }

  async send<T = unknown>(
    method: HttpMethod,
    path: string,
    options: any = {}
  ): Promise<ApiResponse<T>> {
    // Prepare headers
    const headers: Record<string, string> = {
      ...(options.headers || {}),
    };

    // Add session cookie if available (for all requests)
    if (this.sessionCookie) {
      headers['Cookie'] = `orangehrm=${this.sessionCookie}`;
    }

    // Add Vue token as X-Auth-Token for API requests
    if (this.vueToken && path.includes('/api/v2/')) {
      headers['X-Auth-Token'] = this.vueToken;
    }

    // Add CSRF token for state-changing requests if available
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && this.csrfToken) {
      if (options.data && typeof options.data === 'object') {
        options.data = { ...options.data, _token: this.csrfToken };
      } else if (options.form && typeof options.form === 'object') {
        options.form = { ...options.form, _token: this.csrfToken };
      } else if (!options.data && !options.form) {
        options.data = { _token: this.csrfToken };
      }
    }

    // Merge headers into options
    options.headers = headers;

    this.log('info', `📤 ${method} ${path} (cookie: ${this.sessionCookie ? 'yes' : 'no'}, token: ${this.vueToken ? 'yes' : 'no'})`);

    const response = await super.send<T>(method, path, options);
    
    // If we get a 401, try to re-authenticate
    if (response.status === 401 && this.isAuthenticated) {
      this.log('warn', `⚠️ Session expired, re-authenticating...`);
      await this.authenticate();
      
      // Update headers with new session data
      if (this.sessionCookie) {
        options.headers = { ...options.headers, 'Cookie': `orangehrm=${this.sessionCookie}` };
      }
      if (this.vueToken) {
        options.headers = { ...options.headers, 'X-Auth-Token': this.vueToken };
      }
      
      // Retry the request
      return super.send<T>(method, path, options);
    }
    
    return response;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ── Recruitment: Candidates ────────────────────────────────────────────────

  async createCandidate(
    payload: CandidatePayload
  ): Promise<ApiResponse<OrangeHRMEnvelope<CandidateData>>> {
    return this.post('/web/index.php/api/v2/recruitment/candidates', payload);
  }

  async listCandidates(params?: {
    limit?: number;
    offset?: number;
    sortField?: string;
    sortOrder?: 'ASC' | 'DESC';
    keywords?: string;
    vacancyId?: number;
  }): Promise<ApiResponse<OrangeHRMEnvelope<CandidateData[]> & { meta: any }>> {
    return this.request('GET', '/web/index.php/api/v2/recruitment/candidates')
      .params(params as Record<string, string | number | boolean> ?? {})
      .send();
  }

  async getCandidateById(
    id: number
  ): Promise<ApiResponse<OrangeHRMEnvelope<CandidateData>>> {
    return this.get(`/web/index.php/api/v2/recruitment/candidates/${id}`);
  }

  async deleteCandidates(
    ids: number[]
  ): Promise<ApiResponse<unknown>> {
    return this.delete(
      '/web/index.php/api/v2/recruitment/candidates',
      { ids },
      { allowAnyStatus: true }
    );
  }

  async deleteCandidate(id: number): Promise<ApiResponse<unknown>> {
    return this.deleteCandidates([id]);
  }

  isAuthenticatedFlag(): boolean {
    return this.isAuthenticated;
  }
}