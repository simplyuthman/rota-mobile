import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';

describe('API Server Health', () => {
  it('GET /health/live returns 200 and status ok', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/health/live',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();
    await app.close();
  });

  it('GET /health/ready returns status matching dependency availability', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/health/ready',
    });

    const body = JSON.parse(response.body);
    if (response.statusCode === 200) {
      expect(body.status).toBe('ok');
      expect(body.db.controlPlane).toBe(true);
      expect(body.db.shard0).toBe(true);
      expect(body.db.shard1).toBe(true);
      expect(body.redis.cache).toBe(true);
      expect(body.redis.queue).toBe(true);
    } else {
      expect(response.statusCode).toBe(503);
      expect(body.status).toBe('degraded');
      expect(body.db).toBeDefined();
      expect(body.redis).toBeDefined();
    }
    await app.close();
  });
});
