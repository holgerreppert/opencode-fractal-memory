export enum LogLevel {
	ERROR = 0,
	WARN = 1,
	INFO = 2,
	SUCCESS = 2,
	DEBUG = 3
}
type LogMethod = 'info' | 'warn' | 'error' | 'debug' | 'success' | 'inspect';

interface LoggerConfig {
	enabled: boolean;
	minLevel: LogLevel;
	colors: Record<LogMethod, string>;
	timestampFormatter: () => string;
}

export class Logger {
	private static _config: LoggerConfig = {
		enabled: true,
		minLevel: import.meta.env.VITE_LOG_LEVEL
			? parseInt(import.meta.env.VITE_LOG_LEVEL as string)
			: import.meta.env.DEV
				? LogLevel.DEBUG
				: LogLevel.WARN,
		colors: {
			info: '#2f86eb',
			warn: '#e3a008',
			error: '#e02424',
			debug: '#6b7280',
			success: '#22c55e',
			inspect: '#8b5cf6'
		},
		timestampFormatter: () => new Date().toLocaleString()
	};

	static configure(opts: Partial<LoggerConfig>) {
		this._config = { ...this._config, ...opts, colors: { ...this._config.colors, ...(opts.colors ?? {}) } };
	}
	static enable() {
		this._config.enabled = true;
	}
	static disable() {
		this._config.enabled = false;
	}
	static setLevel(level: LogLevel) {
		this._config.minLevel = level;
	}
	static setColor(method: LogMethod, colour: string) {
		this._config.colors[method] = colour;
	}
	static setTimestampFormatter(fn: () => string) {
		this._config.timestampFormatter = fn;
	}

	private static shouldLog(lvl: LogLevel) {
		return this._config.enabled && lvl <= this._config.minLevel;
	}
	private static sanitize(args: unknown[]): unknown[] {
		return args.map((a) => {
			try {
				// handle Svelte 5 $state proxies if available
				const snap = (globalThis as any).$state?.snapshot?.(a);
				if (snap !== undefined) return snap;
				if (a && typeof a === 'object') return JSON.parse(JSON.stringify(a));
				return a;
			} catch {
				return '[Unserializable]';
			}
		});
	}
	private static format(label: string, colour: string) {
		return [`%c[${this._config.timestampFormatter()}] ${label}`, `color:${colour};font-weight:bold`];
	}

	static info(...args: unknown[]) {
		if (!this.shouldLog(LogLevel.INFO)) return;
		console.info(...this.format('ℹ️ Info', this._config.colors.info), ...this.sanitize(args));
	}
	static warn(...args: unknown[]) {
		if (!this.shouldLog(LogLevel.WARN)) return;
		console.warn(...this.format('⚠️ Warning', this._config.colors.warn), ...this.sanitize(args));
	}
	static error(...args: unknown[]) {
		if (!this.shouldLog(LogLevel.ERROR)) return;
		console.error(...this.format('❌ Error', this._config.colors.error), ...this.sanitize(args));
	}
	static debug(...args: unknown[]) {
		if (!this.shouldLog(LogLevel.DEBUG)) return;
		console.debug(...this.format('🐞 Debug', this._config.colors.debug), ...this.sanitize(args));
	}
	static success(...args: unknown[]) {
		if (!this.shouldLog(LogLevel.SUCCESS)) return;
		// eslint-disable-next-line no-console
		console.log(...this.format('✅ Success', this._config.colors.success), ...this.sanitize(args));
	}
	static inspect(label: string, value: unknown) {
		if (!this.shouldLog(LogLevel.DEBUG)) return;
		const ts = this._config.timestampFormatter();
		console.groupCollapsed(`%c[🔍 Inspect] ${label} — ${ts}`, `color:${this._config.colors.inspect};font-weight:bold`);
		console.dir(this.sanitize([value])[0], { depth: null } as any);
		console.groupEnd();
	}
}

export function logApi(method: string, path: string, status: number, durationMs: number): void {
	// keep backward compat for accessapi centralized logger
	if (status >= 400) Logger.warn(`[api] ${method} ${path} → ${status} ${durationMs}ms`);
	else Logger.debug(`[api] ${method} ${path} → ${status} ${durationMs}ms`);
}
