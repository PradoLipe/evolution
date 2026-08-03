// ============================================================
// EVOLUTION SERVICE WORKER
// Para forçar atualização nos usuários: incremente APP_VERSION
// ============================================================
const APP_VERSION = '5.54';
const CACHE_NAME = `evolution-v${APP_VERSION}`;

const LOCAL_ASSETS = [
  './',
  './index.html',
  './estilos.css',
  './js/config.js',
  './js/main.js',
  './js/auth.js',
  './js/firebase-sync.js',
  './js/ui.js',
  './js/entries.js',
  './js/admin.js',
  './js/utils.js',
  './js/turtle.js',
  './js/init.js',
  './NAVIO.jpg',
];

// INSTALL: pré-cacheia todos os assets locais e ativa imediatamente
self.addEventListener('install', event => {
  self.skipWaiting(); // Não espera fechar abas — ativa na hora
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(LOCAL_ASSETS))
      .catch(err => console.warn('[SW] Precache parcial:', err))
  );
});

// ACTIVATE: limpa caches antigos e assume controle de todas as abas
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key.startsWith('evolution-v') && key !== CACHE_NAME)
            .map(key => {
              console.log('[SW] Removendo cache antigo:', key);
              return caches.delete(key);
            })
        )
      )
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => {
        // Avisa todas as janelas abertas que o SW foi atualizado
        clients.forEach(client =>
          client.postMessage({ type: 'SW_UPDATED', version: APP_VERSION })
        );
      })
  );
});

// FETCH: network-first para assets locais (sempre pega a versão mais nova)
//        cache-first para CDNs externos (Firebase, jsPDF, etc.)
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const isLocal = url.origin === self.location.origin;

  if (isLocal) {
    // Network-first: tenta buscar do servidor; usa cache como fallback offline
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone)).catch(err => console.warn('[SW] cache.put falhou:', err));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  } else {
    // Cache-first para CDN: evita re-baixar libs externas a cada acesso
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone)).catch(err => console.warn('[SW] cache.put CDN falhou:', err));
          }
          return response;
        });
      })
    );
  }
});
