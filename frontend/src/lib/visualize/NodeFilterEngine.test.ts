import { describe, it, expect } from 'vitest';
import { NodeFilterEngine } from './NodeFilterEngine';

describe('NodeFilterEngine', () => {
	it('matches level/type and text search', () => {
		const e = new NodeFilterEngine();
		e.initFromStats({ nodesPerLevel: { 0: 1, 1: 2 }, nodesPerType: { fact: 1, lesson: 1 }, nodesPerCustomType: {}, nodesPerShape: {} });
		// toggle off then on
		e.clearAll(); expect(e.matches({ id: '1', level: 0, type: 'fact', label: 'hello', content: '' })).toBe(false);
		e.selectAll(); expect(e.matches({ id: '1', level: 0, type: 'fact', label: 'hello', content: '' })).toBe(true);
		e.setSearchQuery('hello'); expect(e.matches({ id: '1', level: 0, type: 'fact', label: 'hello world', content: '' })).toBe(true);
		e.setSearchQuery('nomatch'); expect(e.matches({ id: '1', level: 0, type: 'fact', label: 'hello', content: '' })).toBe(false);
	});
});
