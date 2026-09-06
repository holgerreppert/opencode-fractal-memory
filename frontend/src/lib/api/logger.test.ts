import { describe, it, expect } from 'vitest';
import { Logger, LogLevel } from './logger';

describe('Logger', () => {
	it('enables/disables and levels', () => {
		Logger.enable(); Logger.setLevel(LogLevel.DEBUG); expect(Logger).toBeDefined();
		Logger.disable(); Logger.enable();
	});
	it('logs without throw', () => {
		Logger.setLevel(LogLevel.DEBUG);
		Logger.info('info', { a: 1 });
		Logger.debug('debug');
		Logger.warn('warn');
		Logger.error('error');
		Logger.success('success');
		Logger.inspect('obj', { x: 1 });
	});
});
