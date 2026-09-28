var CACHE_NAME = "rotaia-cache-v4";
var CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png"
];

self.addEventListener("install", function(e){
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.addAll(CORE_ASSETS).catch(function(){ /* uno degli asset potrebbe mancare: non bloccare l'installazione */ });
    })
  );
});

self.addEventListener("activate", function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k !== CACHE_NAME; }).map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function(e){
  if(e.request.method !== "GET") return;
  var url = new URL(e.request.url);

  // Pagina dell'app (navigazione): network-first, così le modifiche si vedono
  // subito quando c'è rete; la cache serve solo come rete di sicurezza offline.
  var isPage = e.request.mode === "navigate"
    || (url.origin === self.location.origin && (url.pathname.endsWith("/") || url.pathname.endsWith("index.html")));
  if(isPage){
    e.respondWith(
      fetch(e.request).then(function(networkResp){
        if(networkResp && networkResp.ok){
          var copy = networkResp.clone();
          caches.open(CACHE_NAME).then(function(cache){ cache.put(e.request, copy); });
        }
        return networkResp;
      }).catch(function(){
        return caches.match(e.request).then(function(cached){
          return cached || caches.match("./index.html");
        });
      })
    );
    return;
  }

  // Altre risorse stesse origine (icone, manifest): cache-first, aggiorna in background
  if(url.origin === self.location.origin){
    e.respondWith(
      caches.match(e.request).then(function(cached){
        var fetchPromise = fetch(e.request).then(function(networkResp){
          if(networkResp && networkResp.ok){
            var copy = networkResp.clone();
            caches.open(CACHE_NAME).then(function(cache){ cache.put(e.request, copy); });
          }
          return networkResp;
        }).catch(function(){ return cached; });
        return cached || fetchPromise;
      })
    );
    return;
  }

  // Risorse esterne (font Google, ecc.): stale-while-revalidate
  e.respondWith(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.match(e.request).then(function(cached){
        var fetchPromise = fetch(e.request).then(function(networkResp){
          if(networkResp && networkResp.ok) cache.put(e.request, networkResp.clone());
          return networkResp;
        }).catch(function(){ return cached; });
        return cached || fetchPromise;
      });
    })
  );
});
