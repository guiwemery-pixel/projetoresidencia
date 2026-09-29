import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Site sem internet (public/sw.js): no fim do build, lista em dist/offline-assets.json os
 * arquivos que o service worker guarda na instalação (JS/CSS do build, ícones, manifesto) e
 * grava a versão do build no sw.js — assim cada deploy instala a versão nova.
 */
function offlineAssets(): Plugin {
  let outDir = 'dist';
  return {
    name: 'offline-assets',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const full = path.join(dir, name);
          if (statSync(full).isDirectory()) walk(full);
          else files.push('/' + path.relative(outDir, full).split(path.sep).join('/'));
        }
      };
      walk(path.join(outDir, 'assets'));
      const extra = ['/manifest.webmanifest', '/cards.webmanifest', '/theme-init.js', '/favicon.ico', '/icons/mark-128.png', '/icons/icon-192.png', '/icons/apple-touch-icon.png', '/icons/favicon-32.png'];
      for (const f of extra) if (existsSync(path.join(outDir, f))) files.push(f);
      files.sort();
      const hash = createHash('sha256');
      for (const f of files) hash.update(f);
      hash.update(readFileSync(path.join(outDir, 'index.html')));
      const version = hash.digest('hex').slice(0, 12);
      writeFileSync(path.join(outDir, 'offline-assets.json'), JSON.stringify({ version, files }));
      const sw = path.join(outDir, 'sw.js');
      if (existsSync(sw)) writeFileSync(sw, readFileSync(sw, 'utf8').replace('__BUILD_VERSION__', version));
    },
  };
}

export default defineConfig({
  plugins: [react(), offlineAssets()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:3333', changeOrigin: false } },
  },
  build: {
    rollupOptions: {
      output: { manualChunks: { charts: ['recharts'], vendor: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'] } },
    },
  },
});
