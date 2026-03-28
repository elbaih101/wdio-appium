import { CandidatePayload } from '../../utils/oranghm.client';

// ─────────────────────────────────────────────────────────────────────────────
// Test data factory
// ─────────────────────────────────────────────────────────────────────────────
export const CandidateFactory = {
  /**
   * Returns a valid candidate payload.  Individual fields can be overridden
   * to cover negative test scenarios.
   */
  build(overrides: Partial<CandidatePayload> = {}): CandidatePayload {
    const suffix = Date.now(); // keeps email unique across runs
    return {
      firstName: 'John',
      middleName: 'API',
      lastName: `Doe_${suffix}`,
      email: `john.doe.${suffix}@testmail.com`,
      contactNumber: '01123456789',
      dateOfApplication: new Date().toISOString().split('T')[0], // today
      vacancyId: 1,       // vacancy that exists on the demo instance
      keywords: 'Playwright, TypeScript, QA',
      comment: 'Created by automated Playwright API test',
      consentToKeepData: true,
      ...overrides,
    };
  },

  /** Minimal payload — only required fields */
  buildMinimal(overrides: Partial<CandidatePayload> = {}): CandidatePayload {
    const suffix = Date.now();
    return {
      firstName: 'Min',
      lastName: `Candidate_${suffix}`,
      email: `min.candidate.${suffix}@testmail.com`,
      dateOfApplication: new Date().toISOString().split('T')[0],
      vacancyId: 1,
      consentToKeepData: true,
      ...overrides,
    };
  },
};