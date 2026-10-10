import {defineConfig} from 'astro/config';
import {terrainMiddleware} from './server/terrain-middleware.mjs';

export default defineConfig({
  site: process.env.SITE_URL || 'https://earthlight.maxvyshniakov.com',
  output: 'static',
  vite: {plugins: [{name: 'terrain-source', configureServer: server => {
    server.middlewares.use(terrainMiddleware);
  }}]},
});
