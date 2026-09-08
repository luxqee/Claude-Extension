interface ExtensionManifest {
  manifest_version: 3
  name: string
  version: string
  description: string
  /** Pins the extension's ID to the same value on every machine that loads
   * this unpacked build, instead of Chrome deriving a new one per install
   * path. This is a public key (safe to commit) -- it has no matching
   * private key kept anywhere, since this project never produces a signed
   * .crx. Without this, Google Sign-In's redirect URI (registered in Google
   * Cloud Console against a specific extension ID) would need re-adding
   * every time the extension is loaded fresh on a different computer. */
  key: string
  permissions: string[]
  host_permissions: string[]
  background: {
    service_worker: string
    type: 'module'
  }
  content_scripts: Array<{
    matches: string[]
    js: string[]
  }>
  side_panel: {
    default_path: string
  }
  action: Record<string, never>
}

const manifest: ExtensionManifest = {
  manifest_version: 3,
  name: 'Claude Tools Sidebar',
  version: '0.1.0',
  description: 'Configurable prompt buttons for claude.ai, run from a sidebar.',
  key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA5XVB/dXgxQE8jwyqw4Rpvz/OscKGE/KeOplSBusI8gn+2mqrdh9Pq0i+HIop95bsz/KbMml+uCvgJMLVgstHlO3TxGc1E5T5u13kL/g0CoZDd5khfx2SSJVAwSWoNs3ttZT72xJ3p6TgeJbj4++b1ECTEmU41DxEvChJcdsGk91La7wZg+9Flaqv0Eh2J/qCj/1eGcmLIBNv9BfuLRw1L3MGZSN/jJFEAnSFnIcKGtdz86/EexjTcctx4RTQf7b1LQeaaz93qjZ7mCzDBC7XfHnzkJI38qaScfSd6StGRiiaE1FoWxpVMrDRLSqte7V72Eio/TiaRNHp31kcnQ4l1wIDAQAB',
  permissions: ['sidePanel', 'storage', 'scripting', 'identity'],
  host_permissions: ['https://claude.ai/*', 'https://claude-extension-git-main-luxqees-projects.vercel.app/*'],
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['https://claude.ai/*'],
      js: ['src/content/content-script.ts'],
    },
  ],
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
  action: {},
}

export default manifest
