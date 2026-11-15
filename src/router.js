// Minimal hash router: "#/" = home, "#/deck/<id>" = editor, "#/present/<id>?s=3" = presenter, "#/presenter-view/<id>" = presenter view.
export function parseHash(hash) {
  const raw = (hash || '').replace(/^#\/?/, '');
  const [path, qs = ''] = raw.split('?');
  const [name, id] = path.split('/');
  const query = Object.fromEntries(new URLSearchParams(qs));
  const safeId = id ? decodeURIComponent(id).replace(/[^\w-]/g, '') : null;
  if (name === 'deck' && safeId) return { name: 'editor', id: safeId, query };
  if (name === 'present' && safeId) return { name: 'present', id: safeId, query };
  if (name === 'presenter-view' && safeId) return { name: 'presenterView', id: safeId, query };
  return { name: 'home', query };
}
export function hrefFor(route, id) {
  switch (route) {
    case 'editor': return '#/deck/' + id;
    case 'present': return '#/present/' + id;
    case 'presenterView': return '#/presenter-view/' + id;
    default: return '#/';
  }
}
export function navigate(route, id) { window.location.hash = hrefFor(route, id); }
