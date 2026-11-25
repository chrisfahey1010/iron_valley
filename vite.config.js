import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEVEL_FILE = resolve(__dirname, 'public/level.json');

function levelSavePlugin() {
  return {
    name: 'level-save',
    configureServer(server) {
      server.middlewares.use('/__level-save', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('POST only'); return; }
        let body = '';
        req.on('data', c => { body += c; if (body.length > 5e6) req.destroy(); });
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            fs.writeFileSync(LEVEL_FILE, JSON.stringify(parsed, null, 2) + '\n');
            res.setHeader('Content-Type', 'application/json');
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true }));
          } catch (err) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: String(err) }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [levelSavePlugin()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        editor: resolve(__dirname, 'editor.html'),
      },
    },
  },
});
