import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * =============================================================================
 * Rota Load Test — Activity Feed Cached Run (Cache On)
 * =============================================================================
 * Requirements (AGENTS.md §3.5 D-07, rota-load-test skill):
 * - Pass criteria: 200 Virtual Users, 30s ramp, 3 min steady state
 * - Pass threshold: p95 <= 500 ms and error rate < 1%
 * - Exercises the Redis feed first-page cache (50 newest raw events, 30s TTL)
 * - Verifies role isolation and response validity
 * =============================================================================
 */

const data = JSON.parse(open('./tokens.json'));
const tokens = data.tokens;
const teamId = data.mainTeamId;
const BASE_URL = __ENV.API_URL || 'http://localhost:3000';

const duration = __ENV.QUICK === '1' ? '15s' : '3m';
const rampDuration = __ENV.QUICK === '1' ? '5s' : '30s';

export const options = {
  stages: [
    { duration: rampDuration, target: 200 }, // 30s ramp up to 200 users
    { duration: duration, target: 200 },     // 3 min steady state
    { duration: rampDuration, target: 0 },   // 30s ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // PASS CRITERIA: p95 <= 500ms
    http_req_failed: ['rate<0.01'],   // PASS CRITERIA: error rate < 1%
  },
};

export default function () {
  // Distribute requests evenly across the 200 pre-created users
  const userIndex = __VU % tokens.length;
  const token = tokens[userIndex];

  const params = {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };

  const res = http.get(`${BASE_URL}/v1/teams/${teamId}/activity?limit=20`, params);

  check(res, {
    'status is 200': (r) => r.status === 200,
    'has items array': (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body.items) && body.items.length > 0;
      } catch {
        return false;
      }
    },
    'no notes leaked': (r) => {
      // Rule A-07 / D-03: Ensure no draft notes leak in feed items
      return !r.body.includes('"notes":');
    },
  });

  sleep(0.5);
}
