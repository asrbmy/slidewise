// Generates dist/sw.js with a precache list of every emitted file. No third-party service worker tooling.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export function swPlugin() {
  const here = dirname(fileURLToPath(import.meta.url));
  return {
    name: 'slidewise-sw',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const extra = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon.svg'];
      const list = Array.from(new Set([...extra, ...files]));
      const hash = createHash('sha256');
      for (const f of files) {
        const item = bundle[f];
        hash.update(f);
        hash.update(item.type === 'chunk' ? item.code : item.source);
      }
      const version = hash.digest('hex').slice(0, 12);
      const tpl = readFileSync(resolve(here, 'sw-template.js'), 'utf8');
      const src = tpl.replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(list));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src });
    },
  };
}
