import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 200 }, // ramp up to 200 users
    { duration: '3m', target: 200 },  // steady state
    { duration: '30s', target: 0 },   // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests must complete below 500ms
    http_req_failed: ['rate<0.01'],   // error rate must be < 1%
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:3000';

export default function () {
  const res = http.get(`${BASE_URL}/health/live`);
  check(res, {
    'status is 200': (r) => r.status === 200,
  });
  sleep(1);
}
