import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const mockPath = (name) => fileURLToPath(new URL(`./tests/mocks/${name}.js`, import.meta.url));
const runtimePath = fileURLToPath(new URL('./js/amalgam.jsx', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'amalgam/editor': runtimePath,
      amalgam: runtimePath,
      '@wordpress/blocks': mockPath('blocks'),
      '@wordpress/block-editor': mockPath('block-editor'),
      '@wordpress/components': mockPath('components'),
      '@wordpress/compose': mockPath('compose'),
      '@wordpress/element': mockPath('element'),
      '@wordpress/server-side-render': mockPath('server-side-render'),
    },
  },
  test: {
    environment: 'jsdom',
    clearMocks: true,
  },
});
