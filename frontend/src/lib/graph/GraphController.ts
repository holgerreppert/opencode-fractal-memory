import { Logger } from '$lib/api/logger';
export class GraphController {
  constructor(private container: HTMLElement) { Logger.debug('[graph] init OOP', container.id); }
  build(data: any) { Logger.debug('[graph] build', data?.nodes?.length ?? 0); this.container.innerHTML = `<div class="card p-4"><pre class="text-xs overflow-auto">${JSON.stringify(data, null, 2).slice(0, 2000)}</pre></div>`; }
  dispose() { this.container.innerHTML = ''; }
}
