// @vitest-environment node
import { expect, it } from 'vitest';
import { normalizeDecision, COMPATIBILITY_FALLBACK, CLIENT_CHECKOUT_VERSION } from '../lib/serverCheckoutRollout';

it('an unreadable or unknown decision falls back to the existing compatibility route', () => {
  expect(normalizeDecision(null)).toEqual(COMPATIBILITY_FALLBACK);
  expect(normalizeDecision({ route: 'something-new', eligible: true }).route).toBe('compatibility');
});

it('eligibility always resolves to the server route; ineligible keeps the server decision route', () => {
  expect(normalizeDecision({ eligible: true, route: 'compatibility', reason: 'ALLOWLISTED' }).route).toBe('server');
  expect(normalizeDecision({ eligible: false, route: 'blocked', reason: 'CLIENT_VERSION_TOO_OLD' })).toMatchObject({
    route: 'blocked',
    eligible: false,
  });
  expect(normalizeDecision({ eligible: 'true' as unknown as boolean, route: 'existing', reason: 'x' }).eligible).toBe(false);
});

it('reports a numeric client version the server can compare', () => {
  expect(CLIENT_CHECKOUT_VERSION).toMatch(/^\d+(\.\d+)*$/);
});
