import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  base: './',
  publicDir: command === 'serve' ? 'public' : false,
  plugins: [{
    name: 'license-notices',
    apply: 'build',
    generateBundle() {
      const notices = [
        ['TapeKit kernel', './vendor/tapekit/LICENSE'],
        ['Inter Variable', './node_modules/@fontsource-variable/inter/LICENSE'],
        ['DM Sans Variable', './node_modules/@fontsource-variable/dm-sans/LICENSE'],
      ];
      const source = notices.map(([name, path]) => name + '\n\n' + readFileSync(new URL(path, import.meta.url), 'utf8').trim()).join('\n\n');
      this.emitFile({ type: 'asset', fileName: 'NOTICES.txt', source: source + '\n' });
    },
  }],
}));
