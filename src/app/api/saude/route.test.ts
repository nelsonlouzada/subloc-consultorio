import { describe, expect, it } from 'vitest';
import { pool } from '@/db';
import { GET } from './route';

describe('GET /api/saude', () => {
  it('responde 200 sem cache quando o banco responde, sem expor detalhes', async () => {
    const r = await GET();
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toEqual({ ok: true });
  });

  it('responde 503 quando o banco não responde', async () => {
    await pool.end();
    const r = await GET();
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ ok: false });
  });
});
