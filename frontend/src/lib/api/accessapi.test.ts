import { describe, it, expect } from 'vitest';
import { api } from './accessapi';

describe('accessapi', () => {
  it('exposes health/listNodes/search', () => {
    expect(typeof api.health).toBe('function');
    expect(typeof api.listNodes).toBe('function');
    expect(typeof api.search).toBe('function');
  });
});
