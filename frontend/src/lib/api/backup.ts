import { fetchJson } from './accessapi';

export interface BackupSourceInfo {
	key: string;
	label: string;
	exists: boolean;
	isDir: boolean;
}

export interface BackupEntry {
	name: string;
	date: string;
	label?: string;
	totalSize: number;
	sources: Record<string, { label: string; fileCount: number; totalSize: number }>;
}

export interface CreateBackupResult {
	name: string;
	date: string;
	label?: string;
	sources: string[];
}

export interface BackupResult<T> {
	success: boolean;
	error?: string;
	backup?: T;
	preRestoreBackup?: string;
}

export const backupApi = {
	/** Available whole-dir sources (config / cache / opencode-home). */
	sources: () => fetchJson<BackupSourceInfo[]>('/api/backup-sources'),

	/** List existing backups (newest first). */
	list: () => fetchJson<{ backups: BackupEntry[] }>('/api/backups'),

	/** Create a backup from the given source keys. */
	create: (sources: string[], label?: string) =>
		fetchJson<BackupResult<CreateBackupResult>>('/api/backup', {
			method: 'POST',
			body: JSON.stringify({ sources, label }),
		}),

	/** Restore selected source keys from a named backup. */
	restore: (backup: string, sources: string[]) =>
		fetchJson<BackupResult<unknown>>('/api/restore', {
			method: 'POST',
			body: JSON.stringify({ backup, sources }),
		}),

	/** Delete a backup by name. */
	delete: (name: string) =>
		fetchJson<BackupResult<unknown>>(`/api/backups/${encodeURIComponent(name)}`, {
			method: 'DELETE',
		}),
};

export function formatSize(bytes: number): string {
	if (!bytes) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
	return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
