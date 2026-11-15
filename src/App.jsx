import React, { useEffect, useState } from 'react';
import { parseHash } from './router.js';
import Home, { UnlockDialog } from './components/Home.jsx';
import Editor from './components/Editor.jsx';
import { loadDeck, storageMode } from './storage/deckStore.js';
import { navigate } from './router.js';

const Presenter = React.lazy(() => import('./present/Presenter.jsx'));
const PresenterView = React.lazy(() => import('./present/PresenterView.jsx'));

function DeckLoader({ id, children }) {
  const [state, setState] = useState({ status: 'loading' });
  useEffect(() => {
    let dead = false; setState({ status: 'loading' });
    loadDeck(id).then((r) => { if (dead) return; if (!r) setState({ status: 'missing' }); else if (r.needsPassword) setState({ status: 'locked', meta: r.meta }); else setState({ status: 'ready', deck: r.deck, locked: r.locked }); })
      .catch((e) => !dead && setState({ status: 'error', message: e.message }));
    return () => { dead = true; };
  }, [id]);
  if (state.status === 'loading') return <div className="center-msg" role="status">Loading…</div>;
  if (state.status === 'missing') return <div className="center-msg"><h1>Presentation not found</h1><p>It may have been deleted, or it lives in a different browser profile.</p><a className="btn primary" href="#/">All presentations</a></div>;
  if (state.status === 'error') return <div className="center-msg"><h1>Could not open this presentation</h1><p role="alert">{state.message}</p><a className="btn primary" href="#/">All presentations</a></div>;
  if (state.status === 'locked') return <UnlockDialog meta={state.meta} onClose={() => navigate('home')} onUnlocked={() => loadDeck(id).then((r) => setState({ status: 'ready', deck: r.deck, locked: true })).catch((e) => setState({ status: 'error', message: e.message }))} />;
  return children(state.deck, state.locked);
}

export default function App() {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  const [mode, setMode] = useState('indexeddb');
  useEffect(() => { const on = () => setRoute(parseHash(window.location.hash)); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, []);
  useEffect(() => { storageMode().then(setMode); }, []);
  const fallback = <div className="center-msg" role="status">Loading…</div>;
  if (route.name === 'editor') return <DeckLoader key={route.id} id={route.id}>{(deck, locked) => <Editor key={deck.id} initialDeck={deck} locked={locked} />}</DeckLoader>;
  if (route.name === 'present') return <React.Suspense fallback={fallback}><DeckLoader key={route.id} id={route.id}>{(deck) => <Presenter deck={deck} />}</DeckLoader></React.Suspense>;
  if (route.name === 'presenterView') return <React.Suspense fallback={fallback}><PresenterView id={route.id} /></React.Suspense>;
  return <Home mode={mode} />;
}
