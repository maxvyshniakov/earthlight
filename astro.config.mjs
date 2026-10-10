import {defineConfig} from 'astro/config';
import {terrainMiddleware} from './server/terrain-middleware.mjs';

export default defineConfig({
  ...(process.env.SITE_URL ? {site: process.env.SITE_URL} : {}),
  output: 'static',
  vite: {plugins: [{name: 'terrain-source', configureServer: server => {
    server.middlewares.use(terrainMiddleware);
  }}]},
});
