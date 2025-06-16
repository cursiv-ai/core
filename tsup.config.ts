import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['streams/index.ts'],
    format: ['cjs', 'esm'],
    external: [],
    dts: true,
    sourcemap: true,
  },
])
