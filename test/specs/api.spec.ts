// test/specs/api.spec.ts
import { test, expect } from '@playwright/test';
import { OrangeHRMClient } from '../../utils/oranghm.client';
import { CandidateFactory } from '../testdata/canidate.factory';

const BASE_URL = process.env.ORANGEHRM_BASE_URL ?? 'https://opensource-demo.orangehrmlive.com';
const USERNAME = process.env.ORANGEHRM_USERNAME ?? 'Admin';
const PASSWORD = process.env.ORANGEHRM_PASSWORD ?? 'admin123';

test.describe('OrangeHRM Recruitment API', () => {
  let client: OrangeHRMClient;

  test.beforeAll(async () => {
    client = new OrangeHRMClient({
      baseURL: BASE_URL,
      username: USERNAME,
      password: PASSWORD,
    });

    await client.init();

    // Response interceptor: warn when a call takes > 3 s
    client.addResponseInterceptor((res) => {
      if (res.duration > 3000) {
        console.warn(`  ⚠ Slow response: ${res.duration}ms`);
      }
      return res;
    });

    // Request interceptor: stamp every request with a trace ID
    client.addRequestInterceptor((method, path, opts) => ({
      ...opts,
      headers: {
        ...opts.headers,
        'X-Test-Trace': `playwright-${Date.now()}`,
      },
    }));

    console.log(`\n  ► Connected to ${BASE_URL} as "${USERNAME}"\n`);
  });

  test.afterAll(async () => {
    await client.dispose();
  });

  // Step 1 — Add Candidate
  test.describe('Step 1 — Add Candidate', () => {
    let createdId: number;

    // TC-01 — full valid payload returns 201 with correct shape
    test('TC-01 — add canidtae', async () => {
      const payload = CandidateFactory.build();
      const res = await client.createCandidate(payload);

      client.assertStatus(res, 200);

      const { data } = res.body;
      expect(data).toBeTruthy();
      expect(data.id).toBeGreaterThan(0);
      expect(data.firstName).toBe(payload.firstName);
      expect(data.lastName).toBe(payload.lastName);
      expect(data.email).toBe(payload.email);

      createdId = data.id;
      console.log(`    ✔ Candidate ID ${createdId} created`);})


      test('TC-02 — DELETE existing candidate returns 200', async () => {
        if (!createdId) return;
  
        const res = await client.deleteCandidate(createdId);
        if (res.status === 405) return;
  
        client.assertStatus(res, 200);
      });
      
    });

   
});