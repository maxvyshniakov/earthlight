import {defineConfig} from 'astro/config';
import {terrainMiddleware} from './server/terrain-middleware.mjs';

export default defineConfig({
  site: process.env.SITE_URL || 'https://earthlight.maxvyshniakov.com',
  output: 'static',
  // The explorer's instruments occupy the bottom centre.
  devToolbar: {placement: 'bottom-left'},
  vite: {plugins: [{name: 'terrain-source', configureServer: server => {
    server.middlewares.use(terrainMiddleware);
  }}]},
});
