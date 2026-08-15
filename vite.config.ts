import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Deployed under a GitHub Pages project subpath:
//   https://<user>.github.io/nursing-workforce-planning/
// The base must match the repository name (with leading/trailing slashes).
// Locally (dev / preview / tests) we keep base "/".
const isGitHubPages = (globalThis as { process?: { env?: Record<string, string | undefined> } })
  .process?.env?.GITHUB_PAGES === 'true';
const base = isGitHubPages ? '/nursing-workforce-planning/' : '/';

// https://vitejs.dev/config/
export default defineConfig({
  base,
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
} as any);
