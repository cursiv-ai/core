import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['core/index.ts', 'errors/index.ts'],
    format: ['cjs', 'esm'],
    external: [],
    dts: true,
    sourcemap: true,
  },
])
