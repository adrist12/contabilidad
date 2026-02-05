const CACHE_VERSION = 'pedidos-cache-v1';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    'https://unpkg.com/alpinejs@3.x.x/dist/cdn.min.js' // Agrega tus CDNs si usas
];

// Instalar y cachear recursos estáticos
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_VERSION).then((cache) => cache.addAll(STATIC_ASSETS))
    );
    self.skipWaiting();
});

// Limpiar caches antiguos
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) => Promise.all(
            keys.map((k) => k !== CACHE_VERSION && caches.delete(k))
        ))
    );
    self.clients.claim();
});

// Estrategia de Fetch
self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);

    // 1. Si es una API (GET), intentar RED primero, si falla usar CACHÉ
    if (url.pathname.startsWith('/api/') && e.request.method === 'GET') {
        e.respondWith(
            fetch(e.request)
                .then((res) => {
                    const clone = res.clone();
                    caches.open(CACHE_VERSION).then((cache) => cache.put(e.request, clone));
                    return res;
                })
                .catch(() => caches.match(e.request))
        );
    } 
    // 2. Si es un archivo estático, CACHÉ primero, luego RED
    else if (e.request.method === 'GET') {
        e.respondWith(
            caches.match(e.request).then((res) => res || fetch(e.request))
        );
    }
});

// --- MANEJO DE COLA OFFLINE ---

const openDB = () => {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('offline-db', 1);
        req.onupgradeneeded = (e) => e.target.result.createObjectStore('queue', { autoIncrement: true });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
};

// Escuchar mensajes del app.js para guardar acciones cuando no hay internet
self.addEventListener('message', async (e) => {
    if (e.data.type === 'QUEUE_ACTION') {
        const db = await openDB();
        const tx = db.transaction('queue', 'readwrite');
        tx.objectStore('queue').add(e.data.action);
        console.log('Acción guardada en cola offline');
    }
});