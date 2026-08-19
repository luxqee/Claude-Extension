import { ToolService } from '../shared/tool-service'
import { ChromeLocalStorageAdapter } from '../shared/storage/chrome-local-adapter'
import { GoogleAuthAdapter } from '../shared/auth/google-auth-adapter'
import {
  renderApp,
  withMovedId,
  withSwappedAdjacent,
  type View,
  type RunState,
  type SettingsState,
} from './render'
import type { Button } from '../shared/types'
import type { InsertPromptRequest, InsertPromptResponse } from '../shared/messages'
import { parseImportedButtons, serializeButtons } from '../shared/backup'
import {
  loadOrgPrompts,
  clearCachedOrgPrompts,
  type OrgPrompt,
  type OrgPromptsResult,
} from '../shared/org-prompts'

const toolService = new ToolService(new ChromeLocalStorageAdapter())
const authAdapter = new GoogleAuthAdapter()
const rootElement = document.getElementById('app')

if (!rootElement) {
  throw new Error('[Claude Tools] sidepanel root element (#app) is missing')
}

const root: HTMLElement = rootElement

let view: View = { mode: 'list' }
let session: { email: string } | null = null
let teamPrompts: OrgPromptsResult = { orgName: null, prompts: [] }
const TEAM_RUN_KEY = '__team_prompt_run__'
const runState = new Map<string, RunState>()
const settingsState: SettingsState = { error: null, successCount: null }
let focusHandleId: string | null = null

function clearRunErrors(): void {
  for (const [id, state] of runState) {
    if (state.error && !state.isRunning) {
      runState.delete(id)
    }
  }
}

function announce(message: string): void {
  const region = document.getElementById('live-status')
  if (region) region.textContent = message
}

async function refreshTeamPrompts(root: HTMLElement): Promise<void> {
  const startedForSession = session
  const idToken = await authAdapter.getValidIdToken()
  if (session !== startedForSession) return
  if (!idToken) {
    // getValidIdToken() already cleared the stored session if the silent
    // refresh failed outright -- check whether that happened so we only
    // prompt the user to sign in again when it's actually needed, not on
    // every call (e.g. a call made while genuinely signed out already).
    const stillSignedIn = await authAdapter.getCurrentSession()
    if (session !== startedForSession) return
    if (session && !stillSignedIn) {
      session = null
      await clearCachedOrgPrompts()
      announce('Please sign in again to see your team prompts.')
    }
    teamPrompts = { orgName: null, prompts: [] }
    if (view.mode === 'list') await refresh(root)
    return
  }
  const result = await loadOrgPrompts(idToken)
  if (session !== startedForSession) return
  teamPrompts = result
  if (view.mode === 'list') await refresh(root)
}

async function refresh(root: HTMLElement): Promise<void> {
  try {
    const buttons = await toolService.listButtons()
    renderApp(root, buttons, view, runState, settingsState, session, teamPrompts, {
      onRun: async (button: Button) => {
        const alreadyRunning = [...runState.values()].some((state) => state.isRunning)
        if (alreadyRunning) return
        clearRunErrors()
        runState.set(button.id, { isRunning: true, error: null })
        if (view.mode === 'list') await refresh(root)

        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
          if (!tab?.id || !tab.url) {
            console.warn('[Claude Tools] no active claude.ai tab to run against')
            runState.set(button.id, { isRunning: false, error: 'Open claude.ai to use this tool.' })
            announce('Open claude.ai to use this tool.')
            if (view.mode === 'list') await refresh(root)
            return
          }

          const request: InsertPromptRequest = { type: 'INSERT_PROMPT', prompt: button.prompt }
          let response: InsertPromptResponse
          try {
            response = await chrome.tabs.sendMessage<InsertPromptRequest, InsertPromptResponse>(
              tab.id,
              request,
            )
          } catch (error) {
            console.error('[Claude Tools] failed to reach content script', error)
            runState.set(button.id, { isRunning: false, error: 'Reload the Claude tab and try again.' })
            announce('Reload the Claude tab and try again.')
            if (view.mode === 'list') await refresh(root)
            return
          }

          if (response.ok) {
            runState.set(button.id, { isRunning: false, error: null })
          } else {
            console.error('[Claude Tools] run failed', response.error, response.message)
            runState.set(button.id, { isRunning: false, error: response.message })
            announce(response.message)
          }
          if (view.mode === 'list') await refresh(root)
        } catch (error) {
          console.error('[Claude Tools] unexpected error running button', error)
          runState.set(button.id, {
            isRunning: false,
            error: 'Something went wrong running that tool. Check the console for details.',
          })
          announce('Something went wrong running that tool. Check the console for details.')
          if (view.mode === 'list') await refresh(root)
        }
      },
      onAddClick: () => {
        clearRunErrors()
        view = { mode: 'form', button: null }
        void refresh(root)
      },
      onEdit: (button: Button) => {
        clearRunErrors()
        view = { mode: 'form', button }
        void refresh(root)
      },
      onDelete: async (button: Button) => {
        const confirmed = window.confirm(`Delete "${button.name}"? This cannot be undone.`)
        if (!confirmed) return
        clearRunErrors()
        try {
          await toolService.deleteButton(button.id)
          await refresh(root)
        } catch (error) {
          console.error('[Claude Tools] failed to delete button', error)
          root.textContent = 'Something went wrong deleting that tool. Check the console for details.'
        }
      },
      onDrop: async (draggedId: string, targetId: string, position: 'before' | 'after') => {
        clearRunErrors()
        const ids = withMovedId(
          buttons.map((b) => b.id),
          draggedId,
          targetId,
          position,
        )
        try {
          await toolService.reorderButtons(ids)
          await refresh(root)
        } catch (error) {
          console.error('[Claude Tools] failed to reorder buttons', error)
          root.textContent = 'Something went wrong reordering your tools. Check the console for details.'
        }
      },
      onArrowMove: async (id: string, direction: 'up' | 'down') => {
        const ids = withSwappedAdjacent(
          buttons.map((b) => b.id),
          id,
          direction,
        )
        if (!ids) return
        clearRunErrors()
        try {
          await toolService.reorderButtons(ids)
          focusHandleId = id
          await refresh(root)
        } catch (error) {
          console.error('[Claude Tools] failed to reorder buttons', error)
          root.textContent = 'Something went wrong reordering your tools. Check the console for details.'
        }
      },
      onSave: async (data) => {
        if (!data.name || !data.prompt) return
        clearRunErrors()
        try {
          if (data.id) {
            await toolService.updateButton(data.id, { name: data.name, prompt: data.prompt, type: data.type })
          } else {
            await toolService.createButton(data.name, data.prompt, data.type)
          }
          view = { mode: 'list' }
          await refresh(root)
        } catch (error) {
          console.error('[Claude Tools] failed to save button', error)
          root.textContent = 'Something went wrong saving that tool. Check the console for details.'
        }
      },
      onCancel: () => {
        clearRunErrors()
        view = { mode: 'list' }
        void refresh(root)
      },
      onOpenSettings: () => {
        clearRunErrors()
        settingsState.error = null
        settingsState.successCount = null
        view = { mode: 'settings' }
        void refresh(root)
      },
      onExport: () => {
        try {
          const json = serializeButtons(buttons)
          const blob = new Blob([json], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.href = url
          link.download = 'claude-tools.json'
          document.body.appendChild(link)
          link.click()
          link.remove()
          setTimeout(() => URL.revokeObjectURL(url), 0)
        } catch (error) {
          console.error('[Claude Tools] failed to export tools', error)
          settingsState.error = 'Something went wrong exporting your tools. Check the console for details.'
          announce('Something went wrong exporting your tools. Check the console for details.')
          settingsState.successCount = null
          void refresh(root)
        }
      },
      onImport: async (file: File) => {
        try {
          const text = await file.text()
          const parsed = parseImportedButtons(text)
          for (const { name, prompt, type } of parsed) {
            await toolService.createButton(name, prompt, type)
          }
          settingsState.error = null
          settingsState.successCount = parsed.length
          announce(`Imported ${parsed.length} tool${parsed.length === 1 ? '' : 's'}.`)
          await refresh(root)
        } catch (error) {
          console.error('[Claude Tools] failed to import tools', error)
          settingsState.error =
            error instanceof Error ? error.message : 'Something went wrong importing that file.'
          announce(settingsState.error)
          settingsState.successCount = null
          await refresh(root)
        }
      },
      onSettingsBack: () => {
        settingsState.error = null
        settingsState.successCount = null
        view = { mode: 'list' }
        void refresh(root)
      },
      onSignIn: async () => {
        const result = await authAdapter.signIn()
        if (result) {
          session = { email: result.email }
          announce(`Signed in as ${result.email}`)
          await refresh(root)
          void refreshTeamPrompts(root)
        } else {
          announce('Sign in was not completed.')
          await refresh(root)
        }
      },
      onSignOut: async () => {
        await authAdapter.signOut()
        await clearCachedOrgPrompts()
        session = null
        teamPrompts = { orgName: null, prompts: [] }
        await refresh(root)
      },
      onRunTeamPrompt: async (prompt: OrgPrompt) => {
        const alreadyRunning = [...runState.values()].some((state) => state.isRunning)
        if (alreadyRunning) return
        runState.set(TEAM_RUN_KEY, { isRunning: true, error: null })
        try {
          try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
            if (!tab?.id || !tab.url) {
              announce('Open claude.ai to use this tool.')
              return
            }
            const request: InsertPromptRequest = { type: 'INSERT_PROMPT', prompt: prompt.promptText }
            let response: InsertPromptResponse
            try {
              response = await chrome.tabs.sendMessage<InsertPromptRequest, InsertPromptResponse>(
                tab.id,
                request,
              )
            } catch (error) {
              console.error('[Claude Tools] failed to reach content script', error)
              announce('Reload the Claude tab and try again.')
              return
            }
            if (response.ok) {
              announce(`Inserted ${prompt.name}.`)
            } else {
              console.error('[Claude Tools] team prompt run failed', response.error, response.message)
              announce(response.message)
            }
          } catch (error) {
            console.error('[Claude Tools] unexpected error running team prompt', error)
            announce('Something went wrong running that tool. Check the console for details.')
          }
        } finally {
          runState.delete(TEAM_RUN_KEY)
        }
      },
    })
    if (focusHandleId) {
      const handles = Array.from(root.querySelectorAll<HTMLElement>('.drag-handle'))
      handles.find((el) => el.dataset.buttonId === focusHandleId)?.focus()
      focusHandleId = null
    }
  } catch (error) {
    console.error('[Claude Tools] failed to load buttons', error)
    root.textContent = 'Something went wrong loading your tools. Check the console for details.'
  }
}

async function start(): Promise<void> {
  session = await authAdapter.getCurrentSession()
  await refresh(root)
  if (session) void refreshTeamPrompts(root)
}

void start()
