import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * =============================================================================
 * Rota Load Test — Activity Feed Baseline Run (Cache Off)
 * =============================================================================
 * Requirements (AGENTS.md §3.5 D-07, rota-load-test skill):
 * - 200 Virtual Users (VUs)
 * - 30s ramp-up, 3 min steady state, 30s ramp-down
 * - 10,000 pre-seeded activity events
 * - Tests feed query latency without Redis caching
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
    { duration: rampDuration, target: 200 }, // ramp up to 200 users
    { duration: duration, target: 200 },     // steady state
    { duration: rampDuration, target: 0 },   // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'], // Baseline raw DB query threshold
    http_req_failed: ['rate<0.05'],
  },
};

export default function (dataObj) {
  // Distribute requests evenly across the 200 pre-created users
  const userIndex = __VU % tokens.length;
  const token = tokens[userIndex];

  const params = {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Bypass-Cache': 'true', // Exercise raw database queries for baseline
    },
  };

  const res = http.get(`${BASE_URL}/v1/teams/${teamId}/activity?limit=20`, params);

  check(res, {
    'status is 200': (r) => r.status === 200,
    'has items array': (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body.items);
      } catch {
        return false;
      }
    },
  });

  sleep(0.5);
}
