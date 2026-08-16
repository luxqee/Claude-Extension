interface ExtensionManifest {
  manifest_version: 3
  name: string
  version: string
  description: string
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
  permissions: ['sidePanel', 'storage', 'scripting'],
  host_permissions: ['https://claude.ai/*'],
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
