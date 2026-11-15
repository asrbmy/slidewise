import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles/app.css';
import { registerSW } from './sw-register.js';

createRoot(document.getElementById('root')).render(<App />);
registerSW();

// Ask the browser not to evict our IndexedDB data under storage pressure. Best-effort: browsers may
// decline silently (Chrome decides from engagement/installation; Firefox may prompt).
try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch { /* ignore */ }
