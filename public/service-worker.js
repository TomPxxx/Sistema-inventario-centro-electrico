const CACHE_NAME = 'inventario-ce-v3';
const API_CACHE_NAME = 'inventario-api-v2';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/styles.css',
  '/js/app.js',
  '/images/logo-background.png',
  'https://cdn.tailwindcss.com',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700;800&display=swap',
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200'
];

// --- IndexedDB para Cola Offline ---
const DB_NAME = 'inventory-offline-db';
const STORE_NAME = 'offline-actions';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveOfflineAction(action) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.add(action);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getOfflineActions() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deleteOfflineAction(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Eventos del Service Worker ---

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== API_CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const isApi = event.request.url.includes('/api/');
  const method = event.request.method;

  if (isApi) {
    if (method === 'GET') {
      // API GET: Network-First con Fallback a Caché
      event.respondWith(
        fetch(event.request)
          .then((response) => {
            if (!response || response.status !== 200) return response;
            const resClone = response.clone();
            caches.open(API_CACHE_NAME).then(cache => cache.put(event.request, resClone));
            return response;
          })
          .catch(() => caches.match(event.request))
      );
    } else {
      // API POST/PUT/DELETE: Cola Offline
      if (!navigator.onLine) {
        event.respondWith(
          (async () => {
            const reqClone = event.request.clone();
            const body = await reqClone.json().catch(() => null);
            const headers = {};
            for (let [key, val] of reqClone.headers.entries()) {
              headers[key] = val;
            }
            await saveOfflineAction({
              url: reqClone.url,
              method: reqClone.method,
              headers,
              body,
              timestamp: new Date().toISOString()
            });
            if ('sync' in self.registration) {
              await self.registration.sync.register('sync-offline-actions').catch(console.error);
            }
            return new Response(JSON.stringify({ success: true, offline: true, message: 'Acción encolada para sincronizar luego.' }), {
              headers: { 'Content-Type': 'application/json' }
            });
          })()
        );
      } else {
        event.respondWith(
          fetch(event.request).catch(async (error) => {
            // Falla de red estando "online"
            const reqClone = event.request.clone();
            const body = await reqClone.json().catch(() => null);
            const headers = {};
            for (let [key, val] of reqClone.headers.entries()) {
              headers[key] = val;
            }
            await saveOfflineAction({
              url: reqClone.url,
              method: reqClone.method,
              headers,
              body,
              timestamp: new Date().toISOString()
            });
            if ('sync' in self.registration) {
              await self.registration.sync.register('sync-offline-actions').catch(console.error);
            }
            return new Response(JSON.stringify({ success: true, offline: true, message: 'Error de red. Acción encolada.' }), {
              headers: { 'Content-Type': 'application/json' }
            });
          })
        );
      }
    }
  } else {
    // Activos estáticos: Cache-First
    if (method !== 'GET') return;
    event.respondWith(
      caches.match(event.request).then((response) => {
        if (response) return response;
        return fetch(event.request).then((response) => {
          if (!response || response.status !== 200 || response.type !== 'basic') return response;
          return response;
        });
      })
    );
  }
});

// --- Background Sync ---
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-offline-actions') {
    event.waitUntil(processOfflineQueue());
  }
});

async function processOfflineQueue() {
  const actions = await getOfflineActions();
  for (const action of actions) {
    try {
      const headers = { ...action.headers, 'X-Offline-Sync': 'true' };
      // Limpiar headers que puedan causar problemas de cross-origin o auth si están duplicados, 
      // aunque fetch respetará cookies (si credentials: 'include').
      const response = await fetch(action.url, {
        method: action.method,
        headers: headers,
        body: action.body ? JSON.stringify(action.body) : null
      });
      
      // Si la respuesta es exitosa o es un conflicto controlado (ej. 409, 400),
      // eliminamos la acción. El servidor se encarga de guardar las de estado 409 para revisión.
      if (response.ok || response.status >= 400 && response.status < 500) {
        await deleteOfflineAction(action.id);
      }
    } catch (err) {
      console.error('Error sincronizando acción offline:', err);
      throw err; // Mantiene la tarea de sync activa para futuros reintentos
    }
  }
}

