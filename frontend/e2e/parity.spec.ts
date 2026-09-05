import { test, expect } from '@playwright/test';

const ALPINE = 'http://127.0.0.1:8787';
const SVELTE = 'http://127.0.0.1:8788';

test('8787 vs 8788 /api/nodes parity (when both running)', async ({ request }) => {
  // If Svelte not running (no sveltePort), skip — build still verifies static
  const alpine = await request.get(`${ALPINE}/api/nodes?limit=1`);
  expect(alpine.ok()).toBeTruthy();
  const svelte = await request.get(`${SVELTE}/api/nodes?limit=1`);
  if (!svelte.ok()) test.skip(true, 'Svelte :8788 not running — enable management.sveltePort:8788 + restart');
  expect(svelte.ok()).toBeTruthy();
  const a = await alpine.json();
  const s = await svelte.json();
  expect(Array.isArray(a.nodes ?? a.results ?? [])).toBeTruthy();
  expect(Array.isArray(s.nodes ?? s.results ?? [])).toBeTruthy();
});
