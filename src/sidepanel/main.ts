import { ToolService } from '../shared/tool-service'
import { ChromeLocalStorageAdapter } from '../shared/storage/chrome-local-adapter'
import { renderApp } from './render'

const toolService = new ToolService(new ChromeLocalStorageAdapter())
const root = document.getElementById('app')

if (!root) {
  throw new Error('[Claude Tools] sidepanel root element (#app) is missing')
}

async function refresh(): Promise<void> {
  try {
    const buttons = await toolService.listButtons()
    renderApp(root, buttons)
  } catch (error) {
    console.error('[Claude Tools] failed to load buttons', error)
    root.textContent = 'Something went wrong loading your tools. Check the console for details.'
  }
}

void refresh()
