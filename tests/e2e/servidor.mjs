// Servidor dos testes de tela: serve o app como está no repositório, trocando só
// os imports do Firebase (CDN) pelo firebase-simulado.js e desligando o service worker.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

export function iniciarServidor() {
  const srv = createServer(async (req, res) => {
    try {
      const caminho = decodeURIComponent(req.url.split('?')[0]);
      if (caminho === '/__e2e/firebase.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript' });
        return res.end(await readFile(join(RAIZ, 'tests/e2e/firebase-simulado.js')));
      }
      const arquivo = normalize(join(RAIZ, caminho === '/' ? 'index.html' : caminho));
      if (!arquivo.startsWith(normalize(RAIZ))) { res.writeHead(403); return res.end(); }
      let corpo = await readFile(arquivo);
      if (caminho === '/app.js') {
        corpo = corpo.toString()
          .replace(/https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-[a-z]+\.js/g, '/__e2e/firebase.js')
          .replace("if ('serviceWorker' in navigator) {", 'if (false) {');
      }
      res.writeHead(200, { 'Content-Type': TIPOS[extname(arquivo)] || 'application/octet-stream' });
      res.end(corpo);
    } catch {
      res.writeHead(404); res.end();
    }
  });
  return new Promise(ok => srv.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${srv.address().port}`, fechar: () => srv.close() })));
}
