import { ToolService } from '../shared/tool-service'
import { ChromeLocalStorageAdapter } from '../shared/storage/chrome-local-adapter'
import { renderApp, type View } from './render'
import type { Button } from '../shared/types'

const toolService = new ToolService(new ChromeLocalStorageAdapter())
const root = document.getElementById('app')

if (!root) {
  throw new Error('[Claude Tools] sidepanel root element (#app) is missing')
}

let view: View = { mode: 'list' }

async function refresh(): Promise<void> {
  try {
    const buttons = await toolService.listButtons()
    renderApp(root, buttons, view, {
      onAddClick: () => {
        view = { mode: 'form', button: null }
        void refresh()
      },
      onEdit: (button: Button) => {
        view = { mode: 'form', button }
        void refresh()
      },
      onDelete: async (button: Button) => {
        const confirmed = window.confirm(`Delete "${button.name}"? This cannot be undone.`)
        if (!confirmed) return
        await toolService.deleteButton(button.id)
        await refresh()
      },
      onMoveUp: async (button: Button) => {
        const ids = buttons.map((b) => b.id)
        const index = ids.indexOf(button.id)
        if (index <= 0) return
        ;[ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]
        await toolService.reorderButtons(ids)
        await refresh()
      },
      onMoveDown: async (button: Button) => {
        const ids = buttons.map((b) => b.id)
        const index = ids.indexOf(button.id)
        if (index === -1 || index >= ids.length - 1) return
        ;[ids[index], ids[index + 1]] = [ids[index + 1], ids[index]]
        await toolService.reorderButtons(ids)
        await refresh()
      },
      onSave: async (data) => {
        if (!data.name || !data.prompt) return
        if (data.id) {
          await toolService.updateButton(data.id, { name: data.name, prompt: data.prompt })
        } else {
          await toolService.createButton(data.name, data.prompt)
        }
        view = { mode: 'list' }
        await refresh()
      },
      onCancel: () => {
        view = { mode: 'list' }
        void refresh()
      },
    })
  } catch (error) {
    console.error('[Claude Tools] failed to load buttons', error)
    root.textContent = 'Something went wrong loading your tools. Check the console for details.'
  }
}

void refresh()
