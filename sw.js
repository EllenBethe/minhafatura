// Versão: NÃO edite à mão — rode `npm run versao` (o deploy automático faz isso sozinho).
// O ?v= nos arquivos garante que um HTML só carregue JS/CSS da mesma versão.
const VERSION = 8;
const CACHE = 'minhafatura-v' + VERSION;
// Recursos externos com URL versionada/imutável: cache-first
const CDN_PREFIXES = [
  'https://www.gstatic.com/firebasejs/',
  'https://fonts.googleapis.com/',
  'https://fonts.gstatic.com/',
];
const ASSETS = [
  './',
  './index.html',
  './style.css?v=' + VERSION,
  './app.js?v=' + VERSION,
  './js/fatura.js?v=' + VERSION,
  './js/importar.js?v=' + VERSION,
  './js/exportar.js?v=' + VERSION,
  './js/grafico.js?v=' + VERSION,
  './js/icones.js?v=' + VERSION,
  './js/metas.js?v=' + VERSION,
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    // Um arquivo por vez: uma falha isolada não impede a instalação (addAll é tudo-ou-nada)
    caches.open(CACHE)
      // cache: 'reload' ignora o cache HTTP do navegador e busca direto do servidor
      .then(c => Promise.all(ASSETS.map(u =>
        c.add(new Request(u, { cache: 'reload' })).catch(e => console.warn('SW: não cacheou', u, e)))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;

  // SDK do Firebase e fontes: cache-first (o app precisa deles para abrir offline)
  if (CDN_PREFIXES.some(p => url.startsWith(p))) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      }))
    );
    return;
  }

  // Demais domínios (APIs do Firebase) passam direto
  if (!url.startsWith(self.location.origin)) return;

  // Arquivos do app: network-first, sempre tenta a versão mais nova e usa o cache só offline
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
