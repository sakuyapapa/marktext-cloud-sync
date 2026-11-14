// Portable build: bundles every production dependency into out/main and
// out/preload so a self-contained app folder needs no node_modules. Native
// modules stay external and are loaded through src/main/utils/optionalNative.ts.
//
//   pnpm exec electron-vite build --config electron.vite.portable.config.ts
//
// The regular config (electron.vite.config.ts) keeps the upstream externalized
// layout used by electron-builder.
import { resolve, dirname } from 'path'
import type { PluginOption } from 'vite'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import svgLoader from 'vite-svg-loader'
import postcssPresetEnv from 'postcss-preset-env'
import packageJson from './package.json' with { type: 'json' }
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export default defineConfig({
  main: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        external: ['keytar', 'native-keymap']
      }
    },
    define: {
      MARKTEXT_VERSION: JSON.stringify(packageJson.version),
      MARKTEXT_VERSION_STRING: JSON.stringify(`v${packageJson.version}`)
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        common: resolve(__dirname, 'src/common'),
        '@shared': resolve(__dirname, 'src/shared')
      },
      extensions: ['.mjs', '.ts', '.js', '.json']
    }
  },
  preload: {
    // Sandboxed preload cannot require npm packages; inline its ESM path helpers.
    build: {
      externalizeDeps: false
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        common: resolve(__dirname, 'src/common'),
        '@shared': resolve(__dirname, 'src/shared')
      },
      extensions: ['.mjs', '.ts', '.js', '.json']
    }
  },
  renderer: {
    // The sandboxed renderer accesses Node only through preload and IPC.
    assetsInclude: ['**/*.md'],
    // Some browser dependencies reference Node鈥檚 global; map it to globalThis before imports run.
    define: {
      global: 'globalThis'
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        common: resolve(__dirname, 'src/common'),
        '@shared': resolve(__dirname, 'src/shared'),
        // Shared `common/*` helpers import the bare `path` specifier; route it to
        // a platform-correct module so the renderer never builds mixed-separator
        // paths (#5683).
        path: resolve(__dirname, 'src/renderer/src/node/platformPath.ts')
      },
      extensions: ['.mjs', '.ts', '.js', '.json', '.vue']
    },
    optimizeDeps: {
      // Vite's dev client exposes define.global at runtime for optimized deps.
      include: ['pako', 'pathe']
    },
    plugins: [vue(), svgLoader()] as PluginOption[],
    css: {
      postcss: {
        plugins: [
          postcssPresetEnv({
            stage: 0,
            features: {
              'nesting-rules': true,
              // Electron ships Chromium, which supports CSS logical properties
              // natively. Leave them untouched so `padding-inline-start` /
              // `inset-inline-start` mirror correctly under `dir="rtl"` instead
              // of being down-compiled to hard-coded LTR physical props (#4673).
              'logical-properties-and-values': false
            }
          })
        ]
      }
    }
  }
})

