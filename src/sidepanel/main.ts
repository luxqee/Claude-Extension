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

async function refresh(root: HTMLElement): Promise<void> {
  try {
    const buttons = await toolService.listButtons()
    renderApp(root, buttons, view, {
      onAddClick: () => {
        view = { mode: 'form', button: null }
        void refresh(root)
      },
      onEdit: (button: Button) => {
        view = { mode: 'form', button }
        void refresh(root)
      },
      onDelete: async (button: Button) => {
        const confirmed = window.confirm(`Delete "${button.name}"? This cannot be undone.`)
        if (!confirmed) return
        try {
          await toolService.deleteButton(button.id)
          await refresh(root)
        } catch (error) {
          console.error('[Claude Tools] failed to delete button', error)
          root.textContent = 'Something went wrong deleting that tool. Check the console for details.'
        }
      },
      onMoveUp: async (button: Button) => {
        const ids = buttons.map((b) => b.id)
        const index = ids.indexOf(button.id)
        if (index <= 0) return
        ;[ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]
        try {
          await toolService.reorderButtons(ids)
          await refresh(root)
        } catch (error) {
          console.error('[Claude Tools] failed to reorder buttons', error)
          root.textContent = 'Something went wrong reordering your tools. Check the console for details.'
        }
      },
      onMoveDown: async (button: Button) => {
        const ids = buttons.map((b) => b.id)
        const index = ids.indexOf(button.id)
        if (index === -1 || index >= ids.length - 1) return
        ;[ids[index], ids[index + 1]] = [ids[index + 1], ids[index]]
        try {
          await toolService.reorderButtons(ids)
          await refresh(root)
        } catch (error) {
          console.error('[Claude Tools] failed to reorder buttons', error)
          root.textContent = 'Something went wrong reordering your tools. Check the console for details.'
        }
      },
      onSave: async (data) => {
        if (!data.name || !data.prompt) return
        try {
          if (data.id) {
            await toolService.updateButton(data.id, { name: data.name, prompt: data.prompt })
          } else {
            await toolService.createButton(data.name, data.prompt)
          }
          view = { mode: 'list' }
          await refresh(root)
        } catch (error) {
          console.error('[Claude Tools] failed to save button', error)
          root.textContent = 'Something went wrong saving that tool. Check the console for details.'
        }
      },
      onCancel: () => {
        view = { mode: 'list' }
        void refresh(root)
      },
    })
  } catch (error) {
    console.error('[Claude Tools] failed to load buttons', error)
    root.textContent = 'Something went wrong loading your tools. Check the console for details.'
  }
}

void refresh(root)
