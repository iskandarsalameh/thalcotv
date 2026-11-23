import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { execSync } from 'node:child_process';

function gitSha(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  // Relative base so the same build works from GitHub Pages (/thalcotv/),
  // from a custom domain, and from the bundle packaged inside the .vpkg.
  base: './',
  plugins: [preact()],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
    __APP_BUILD__: JSON.stringify(gitSha()),
    __APP_BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    // The Vega WebView is Chromium based, but keep the output conservative so
    // an older engine on the stick never chokes on syntax.
    target: ['chrome87'],
    cssTarget: ['chrome87'],
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
