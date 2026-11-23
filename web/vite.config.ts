import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
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

const build = gitSha();
const version = process.env.npm_package_version ?? '0.0.0';
const builtAt = new Date().toISOString();

/** Emits version.json next to index.html; running copies poll it to notice a new release. */
function versionFile(): Plugin {
  return {
    name: 'thalco-version-file',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build, version, builtAt }) });
    },
  };
}

/**
 * The copy packaged inside the .vpkg is opened from file://, where module
 * scripts and CORS-mode links are refused, so it is built as one classic script.
 */
function classicScriptHtml(): Plugin {
  return {
    name: 'thalco-classic-script',
    enforce: 'post',
    transformIndexHtml(html) {
      return html.replace(/<script type="module" crossorigin/g, '<script defer').replace(/ crossorigin(?=[ >])/g, '');
    },
  };
}

export default defineConfig(({ mode }) => ({
  // Relative base so the same build works from GitHub Pages (/thalcotv/),
  // from a custom domain, and from the bundle packaged inside the .vpkg.
  base: './',
  plugins: mode === 'embedded' ? [preact(), versionFile(), classicScriptHtml()] : [preact(), versionFile()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_BUILD__: JSON.stringify(build),
    __APP_BUILT_AT__: JSON.stringify(builtAt),
  },
  build: {
    // The Vega WebView is Chromium based, but keep the output conservative so
    // an older engine on the stick never chokes on syntax.
    target: ['chrome87'],
    cssTarget: ['chrome87'],
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    ...(mode === 'embedded'
      ? {
          outDir: '../vega/assets/web',
          emptyOutDir: true,
          rollupOptions: { output: { format: 'iife' as const, inlineDynamicImports: true } },
        }
      : {}),
  },
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
}));
