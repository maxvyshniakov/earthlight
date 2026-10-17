import {defineConfig} from 'astro/config';
import {terrainMiddleware} from './server/terrain-middleware.mjs';

export default defineConfig({
  site: process.env.SITE_URL || 'https://earthlight.maxvyshniakov.com',
  output: 'static',
  // The explorer's instruments occupy the bottom centre.
  devToolbar: {placement: 'bottom-left'},
  vite: {
    plugins: [{name: 'terrain-source', configureServer: server => {
      server.middlewares.use(terrainMiddleware);
    }}],
    // Agent worktrees live under .claude/; their builds and configs restarted
    // this checkout's dev server and reloaded its pages. Tailnet devices reach
    // the dev server through `tailscale serve`, under a *.ts.net host name.
    server: {watch: {ignored: ['**/.claude/**']}, allowedHosts: ['.ts.net']},
  },
});
