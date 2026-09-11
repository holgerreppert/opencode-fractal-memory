export function hubSubgraph(all: any[]): any[] {
	const hub =
		all.find((n: any) => n.label === 'fact:opencode-fractal-memory-hub') ||
		all.find((n: any) => n.label?.includes('fractal-memory-hub'));
	if (!hub) return all;
	const children = all.filter((n: any) => {
		const pids: string[] = n.parentIds ?? (n as any).parent_ids ?? [];
		return pids.includes(hub.id) || pids.includes(hub.label);
	});
	const childIds = new Set(children.map((c: any) => c.id));
	const childLabels = new Set(children.map((c: any) => c.label));
	const leaves = all.filter((n: any) => {
		if (n.id === hub.id || childIds.has(n.id)) return false;
		const pids: string[] = n.parentIds ?? (n as any).parent_ids ?? [];
		return pids.some((pid: string) => childIds.has(pid) || childLabels.has(pid));
	});
	return [hub, ...children, ...leaves];
}
