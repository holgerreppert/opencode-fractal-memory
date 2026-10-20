import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		// `vite dev` runs on its own origin — proxy API + assets to the management server
		proxy: {
			'/api': 'http://127.0.0.1:8788',
			'/brain-atlas.glb': 'http://127.0.0.1:8788',
			'/models': 'http://127.0.0.1:8788'
		}
	}
});
