import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'adapters/vue2': 'src/adapters/vue2.ts',
    'adapters/vue3': 'src/adapters/vue3.ts',
    'adapters/react': 'src/adapters/react.ts'
  },
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: false,
  outDir: 'dist',
  external: ['vue', 'react', 'react-dom'],
  target: 'es2020',
});
