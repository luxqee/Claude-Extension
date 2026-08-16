import { defineConfig } from 'vite'
import { crx, type ManifestV3Export } from '@crxjs/vite-plugin'
import manifest from './manifest.config'

export default defineConfig({
  plugins: [
    // Cast past CRXJS's bundled manifest type: side_panel is a valid MV3
    // key but the plugin's own type definitions can lag behind newer
    // manifest keys. Our own ExtensionManifest type is the real safety net.
    crx({ manifest: manifest as ManifestV3Export }),
  ],
})
