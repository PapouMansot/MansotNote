import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/** PDF.js needs its fonts, character maps and image decoders at their original file names. */
export function pdfAssets(root: string): Plugin {
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version as string;
  const assets = new Map<string, { path: string; type: string }>();
  for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
    for (const name of readdirSync(join(root, folder))) {
      if (!/\.(bcmap|ttf|pfb|wasm)$/.test(name)) continue;
      assets.set(`/pdfjs/${version}/${folder}/${name}`, {
        path: join(root, folder, name), type: name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream',
      });
    }
  }
  return {
    name: 'pdfjs-local-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const asset = assets.get((req.url ?? '').split('?')[0]);
        if (!asset) { next(); return; }
        res.setHeader('Content-Type', asset.type);
        res.end(readFileSync(asset.path));
      });
    },
    generateBundle() {
      for (const [url, asset] of assets) this.emitFile({ type: 'asset', fileName: url.slice(1), source: readFileSync(asset.path) });
    },
  };
}
