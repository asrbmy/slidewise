// Image cache keyed by asset id + data length. Images decode asynchronously; renderers draw what is ready and are called again on load.
const cache = new Map();
export function getImage(id, asset, onLoad) {
  if (!asset) return null;
  const key = id + ':' + asset.data.length;
  let e = cache.get(key);
  if (!e) {
    const img = new Image();
    e = { img, ready: false, failed: false, cbs: new Set() };
    img.onload = () => { e.ready = true; e.cbs.forEach((f) => f()); e.cbs.clear(); };
    img.onerror = () => { e.failed = true; e.cbs.forEach((f) => f()); e.cbs.clear(); };
    img.decoding = 'async';
    img.src = asset.data; // validated data: URL of an allow-listed raster type
    cache.set(key, e);
    if (cache.size > 400) cache.delete(cache.keys().next().value);
  }
  if (e.ready) return e.img;
  if (onLoad && !e.failed) e.cbs.add(onLoad);
  return null;
}
export function preloadImages(deck) {
  const ids = Object.keys(deck.assets || {});
  return Promise.all(ids.map((id) => new Promise((resolve) => { const img = getImage(id, deck.assets[id], resolve); if (img) resolve(); setTimeout(resolve, 8000); })));
}
