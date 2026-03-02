import vue2 from '@vitejs/plugin-vue2';
import * as path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue2()],
  resolve: {
    alias: {
      // 直接引用源码，方便开发调试
      'flux-transfer/vue2': path.resolve(__dirname, '../../src/adapters/vue2.ts'),
      'flux-transfer': path.resolve(__dirname, '../../src/index.ts'),
    },
  },
});
