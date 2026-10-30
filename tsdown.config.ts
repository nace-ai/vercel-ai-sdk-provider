import { defineConfig } from 'tsdown';
import packageJson from './package.json' with { type: 'json' };

export default defineConfig({
  entry: ['./src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  platform: 'neutral',
  target: 'es2022',
  sourcemap: true,
  define: {
    __PACKAGE_VERSION__: JSON.stringify(packageJson.version),
  },
});
