import { ToolService } from '../shared/tool-service'
import { ChromeLocalStorageAdapter } from '../shared/storage/chrome-local-adapter'
import { ClerkAuthAdapter } from '../shared/auth/clerk-auth-adapter'
import type { ProviderId } from '../shared/auth/providers'
import {
  renderApp,
  withMovedId,
  withSwappedAdjacent,
  type View,
  type RunState,
  type SettingsState,
} from './render'
import type { Button, ToolTab } from '../shared/types'
import type { InsertPromptRequest, InsertPromptResponse, GetUsageRequest, GetUsageResponse } from '../shared/messages'
import { parseBackup, serializeBackup } from '../shared/backup'
import { getTabPrefs, setActiveTab, setDefaultTab, resolveActiveTabId } from '../shared/tab-prefs'
import {
  getButtonUsage,
  recordButtonRun,
  pruneButtonUsage,
  sortButtonsByMostUsed,
  type ButtonUsageMap,
} from '../shared/prompt-usage'
import {
  reportPromptRun,
  fetchOrgAnalytics,
  type OrgAnalytics,
} from '../shared/org-analytics'
import {
  loadOrgPrompts,
  getCachedOrgPrompts,
  clearCachedOrgPrompts,
  createOrgPrompt,
  updateOrgPrompt,
  deleteOrgPrompt,
  createOrgTab,
  updateOrgTab,
  deleteOrgTab,
  reorderOrgTabs,
  type OrgPrompt,
  type OrgPromptsResult,
} from '../shared/org-prompts'
import { fetchOrgSession, submitOrgOnboarding, leaveOrg, type OrgSessionState } from '../shared/org-session'
import {
  fetchOrgMembers,
  approveOrgMember,
  removeOrgMember,
  addOrgMember,
  setOrgMemberRole,
  type OrgMember,
} from '../shared/org-members'
import type { ManageOrgState } from './ManageOrganisation'
import { reportUsage, fetchOrgUsage, type OrgUsageSnapshot } from '../shared/usage-report'

const toolService = new ToolService(new ChromeLocalStorageAdapter())
const authAdapter = new ClerkAuthAdapter()
const rootElement = document.getElementById('app')

if (!rootElement) {
  throw new Error('[Claude Tools] sidepanel root element (#app) is missing')
}

const root: HTMLElement = rootElement

let view: View = { mode: 'list' }
let tabs: ToolTab[] = []
let activeTabId: string | null = null
let defaultTabId: string | null = null
let sortMode: 'manual' | 'most-used' = 'manual'
let buttonUsage: ButtonUsageMap = {}
let orgAnalytics: OrgAnalytics | null = null
let session: { email: string } | null = null
let teamPrompts: OrgPromptsResult = { orgName: null, tabs: [], prompts: [] }
// Which shared tab's prompts the Team section shows. Falls back to the
// first tab (in TeamSection.ts) if this is null or points at a tab that
// no longer exists.
let teamActiveTabId: string | null = null
let orgSession: OrgSessionState | null = null
let orgMembers: OrgMember[] = []
let manageOrgLoading = false
let manageOrgBusy = false
let manageOrgAddError: string | null = null
let orgPrompts: OrgPrompt[] = []
let editingPromptId: string | null = null
let promptFormError: string | null = null
let orgUsageSnapshots: OrgUsageSnapshot[] = []
const USAGE_REPORT_INTERVAL_MS = 15 * 60 * 1000
let usageReportTimer: ReturnType<typeof setInterval> | null = null
const TEAM_RUN_KEY = '__team_prompt_run__'
const runState = new Map<string, RunState>()

// Analytics fire when an inserted prompt is actually sent, not on click.
// The content script watches the chat input and posts PROMPT_SENT with
// the run token; the callback stored here then records the run.
const pendingRuns = new Map<string, { fire: () => void; timer: ReturnType<typeof setTimeout> }>()

// A prompt that is inserted and then never sent (edited away, abandoned)
// gets no PROMPT_SENT, so its entry would sit in this map for the life of
// the side panel. The content-script send watcher gives up after 5
// minutes; drop our entry a little after that so the map can't grow
// without bound over a long session.
const PENDING_RUN_TTL_MS = 6 * 60 * 1000

function registerPendingRun(runToken: string, fire: () => void): void {
  const timer = setTimeout(() => pendingRuns.delete(runToken), PENDING_RUN_TTL_MS)
  pendingRuns.set(runToken, { fire, timer })
}

chrome.runtime.onMessage.addListener((message) => {
  const m = message as { type?: unknown; runToken?: unknown }
  if (m?.type === 'PROMPT_SENT' && typeof m.runToken === 'string') {
    const entry = pendingRuns.get(m.runToken)
    if (entry) {
      clearTimeout(entry.timer)
      pendingRuns.delete(m.runToken)
      entry.fire()
    }
  }
})
const settingsState: SettingsState = {
  error: null,
  successCount: null,
  signingIn: false,
  orgResolving: false,
}
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

async function resolveOrgSession(root: HTMLElement): Promise<void> {
  settingsState.orgResolving = true
  if (view.mode === 'settings') void refresh(root)
  try {
    await resolveOrgSessionInner(root)
  } finally {
    settingsState.orgResolving = false
    if (view.mode === 'settings') void refresh(root)
  }
}

async function resolveOrgSessionInner(root: HTMLElement): Promise<void> {
  const startedForSession = session
  const idToken = await authAdapter.getValidToken()
  if (session !== startedForSession) return
  if (!idToken) {
    const stillSignedIn = await authAdapter.getCurrentSession()
    if (session !== startedForSession) return
    if (session && !stillSignedIn) {
      session = null
      await clearCachedOrgPrompts()
      announce('Please sign in again to see your organisation.')
    }
    // The org session is unresolved, not resolved-inactive: a token refresh
    // can fail transiently (offline). Keep any cached team prompts so the
    // Team section survives. If the session actually ended above the cache
    // was just cleared, so `cached` is null and the section disappears.
    const cached = session ? await getCachedOrgPrompts() : null
    if (session !== startedForSession) return
    orgSession = null
    teamPrompts = cached ?? { orgName: null, tabs: [], prompts: [] }
    stopUsageReportTimer()
    if (view.mode === 'list' || view.mode === 'settings') await refresh(root)
    return
  }

  const resolution = await fetchOrgSession(idToken)
  if (session !== startedForSession) return
  orgSession = resolution

  if (resolution?.state === 'needs_onboarding') {
    view = { mode: 'org-onboarding' }
    await refresh(root)
    return
  }

  if (resolution?.state === 'active') {
    const result = await loadOrgPrompts(idToken)
    if (session !== startedForSession) return
    teamPrompts = result
    startUsageReportTimer()
  } else if (resolution === null) {
    // Same unresolved case as above: /api/org-session was unreachable. Fall
    // back to the cache rather than clearing, matching the pre-Phase-2D
    // behaviour where the Team section came straight from loadOrgPrompts.
    const cached = await getCachedOrgPrompts()
    if (session !== startedForSession) return
    teamPrompts = cached ?? { orgName: null, tabs: [], prompts: [] }
    stopUsageReportTimer()
  } else {
    teamPrompts = { orgName: null, tabs: [], prompts: [] }
    stopUsageReportTimer()
  }
  if (view.mode === 'list' || view.mode === 'settings') await refresh(root)
}

async function refreshOrgMembers(root: HTMLElement): Promise<void> {
  const idToken = await authAdapter.getValidToken()
  if (!idToken) return
  const members = await fetchOrgMembers(idToken)
  if (members) orgMembers = members
  if (view.mode === 'manage-org') await refresh(root)
}

async function refreshOrgPrompts(root: HTMLElement): Promise<void> {
  const idToken = await authAdapter.getValidToken()
  if (!idToken) return
  const result = await loadOrgPrompts(idToken)
  orgPrompts = result.prompts
  teamPrompts = result
  if (view.mode === 'manage-org') await refresh(root)
}

async function refreshOrgUsage(root: HTMLElement): Promise<void> {
  const idToken = await authAdapter.getValidToken()
  if (!idToken) return
  const snapshots = await fetchOrgUsage(idToken)
  if (snapshots) orgUsageSnapshots = snapshots
  if (view.mode === 'manage-org') await refresh(root)
}

async function refreshOrgAnalytics(root: HTMLElement): Promise<void> {
  const idToken = await authAdapter.getValidToken()
  if (!idToken) return
  const analytics = await fetchOrgAnalytics(idToken)
  if (analytics) orgAnalytics = analytics
  if (view.mode === 'manage-org') await refresh(root)
}

/** Runs a shared-tab / shared-prompt write with a "Saving..." spinner in
 * the Manage Organisation view, then reloads the org data. */
async function runOrgWrite(
  root: HTMLElement,
  fn: (idToken: string) => Promise<void>,
): Promise<void> {
  const idToken = await authAdapter.getValidToken()
  if (!idToken) return
  manageOrgBusy = true
  if (view.mode === 'manage-org') await refresh(root)
  try {
    await fn(idToken)
  } finally {
    manageOrgBusy = false
    await refreshOrgPrompts(root)
  }
}

async function reportCurrentUsage(): Promise<void> {
  const idToken = await authAdapter.getValidToken()
  if (!idToken) return
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    // Only a claude.ai tab has the content script that answers GET_USAGE.
    // Anything else (or a claude.ai tab opened before the last extension
    // reload) just has no receiver -- skip quietly, this is a background poll.
    if (!tab?.id || !tab.url?.startsWith('https://claude.ai/')) return
    const response = await chrome.tabs.sendMessage<GetUsageRequest, GetUsageResponse>(tab.id, {
      type: 'GET_USAGE',
    })
    if (response.ok) await reportUsage(idToken, response.usage)
  } catch (error) {
    console.debug('[Claude Tools] usage report skipped (no content script in the active tab)', error)
  }
}

function startUsageReportTimer(): void {
  if (usageReportTimer) return
  void reportCurrentUsage()
  usageReportTimer = setInterval(() => void reportCurrentUsage(), USAGE_REPORT_INTERVAL_MS)
}

function stopUsageReportTimer(): void {
  if (usageReportTimer) {
    clearInterval(usageReportTimer)
    usageReportTimer = null
  }
}

async function refresh(root: HTMLElement): Promise<void> {
  try {
    const buttons = await toolService.listButtons()
    tabs = await toolService.listTabs()
    buttonUsage = await getButtonUsage()
    void pruneButtonUsage(buttons.map((b) => b.id))
    const prefs = await getTabPrefs()
    defaultTabId = prefs.defaultTabId
    if (!activeTabId || !tabs.some((t) => t.id === activeTabId)) {
      activeTabId = resolveActiveTabId(
        tabs.map((t) => t.id),
        prefs,
      )
    }
    let visibleButtons =
      activeTabId === null ? buttons : buttons.filter((b) => b.tabId === activeTabId)
    if (sortMode === 'most-used') {
      visibleButtons = sortButtonsByMostUsed(visibleButtons, buttonUsage)
    }
    renderApp(
      root,
      visibleButtons,
      { tabs, activeTabId, defaultTabId, sortMode, buttonUsage, allButtons: buttons },
      view,
      runState,
      settingsState,
      session,
      orgSession,
      teamPrompts,
      teamActiveTabId,
      {
        members: orgMembers,
        addError: manageOrgAddError,
        loading: manageOrgLoading,
        busy: manageOrgBusy,
        orgTabs: teamPrompts.tabs,
        prompts: orgPrompts,
        editingPromptId,
        promptFormError,
        usageSnapshots: orgUsageSnapshots,
        analytics: orgAnalytics,
      },
      {
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

          const runToken = crypto.randomUUID()
          const request: InsertPromptRequest = {
            type: 'INSERT_PROMPT',
            prompt: button.prompt,
            runToken,
          }
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
            registerPendingRun(runToken, () => {
              void recordButtonRun(button.id).then(() => {
                if (view.mode === 'list') void refresh(root)
              })
            })
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
        if (sortMode !== 'manual') return
        clearRunErrors()
        const ids = withMovedId(
          visibleButtons.map((b) => b.id),
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
        if (sortMode !== 'manual') return
        const ids = withSwappedAdjacent(
          visibleButtons.map((b) => b.id),
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
            await toolService.updateButton(data.id, {
              name: data.name,
              prompt: data.prompt,
              type: data.type,
              tabId: data.tabId || undefined,
            })
          } else {
            await toolService.createButton(data.name, data.prompt, data.type, data.tabId || undefined)
          }
          view = { mode: 'list' }
          await refresh(root)
        } catch (error) {
          console.error('[Claude Tools] failed to save button', error)
          root.textContent = 'Something went wrong saving that tool. Check the console for details.'
        }
      },
      onSelectTab: async (tabId: string) => {
        clearRunErrors()
        activeTabId = tabId
        await setActiveTab(tabId)
        await refresh(root)
      },
      onToggleSort: () => {
        sortMode = sortMode === 'most-used' ? 'manual' : 'most-used'
        void refresh(root)
      },
      onAddTab: async () => {
        clearRunErrors()
        try {
          const created = await toolService.createTab('New tab')
          activeTabId = created.id
          await setActiveTab(created.id)
          view = { mode: 'tabs' }
          await refresh(root)
        } catch (error) {
          console.error('[Claude Tools] failed to create tab', error)
          root.textContent = 'Something went wrong creating that tab. Check the console for details.'
        }
      },
      onManageTabs: () => {
        clearRunErrors()
        view = { mode: 'tabs' }
        void refresh(root)
      },
      onTabsBack: () => {
        view = { mode: 'list' }
        void refresh(root)
      },
      onReorderTabs: async (orderedIds: string[]) => {
        try {
          await toolService.reorderTabs(orderedIds)
          await refresh(root)
        } catch (error) {
          console.error('[Claude Tools] failed to reorder tabs', error)
        }
      },
      onMoveTab: async (id: string, direction: 'up' | 'down') => {
        const ids = tabs.map((t) => t.id)
        const i = ids.indexOf(id)
        const j = direction === 'up' ? i - 1 : i + 1
        if (i === -1 || j < 0 || j >= ids.length) return
        ;[ids[i], ids[j]] = [ids[j], ids[i]]
        try {
          await toolService.reorderTabs(ids)
          await refresh(root)
        } catch (error) {
          console.error('[Claude Tools] failed to reorder tabs', error)
        }
      },
      onRenameTab: async (id: string, name: string, emoji: string | null) => {
        try {
          await toolService.updateTab(id, { name, emoji })
          await refresh(root)
        } catch (error) {
          console.error('[Claude Tools] failed to rename tab', error)
        }
      },
      onDeleteTab: async (id: string) => {
        const tab = tabs.find((t) => t.id === id)
        if (!tab) return
        const count = (await toolService.listButtons(id)).length
        const message =
          count === 0
            ? `Delete the "${tab.name}" tab?`
            : `Delete the "${tab.name}" tab and its ${count} tool${count === 1 ? '' : 's'}? This cannot be undone.`
        if (!window.confirm(message)) return
        try {
          await toolService.deleteTab(id, null)
          if (defaultTabId === id) await setDefaultTab(null)
          if (activeTabId === id) {
            activeTabId = null
            await setActiveTab(null)
          }
          await refresh(root)
        } catch (error) {
          console.error('[Claude Tools] failed to delete tab', error)
          root.textContent = 'Something went wrong deleting that tab. Check the console for details.'
        }
      },
      onSetDefaultTab: async (id: string) => {
        defaultTabId = id
        await setDefaultTab(id)
        await refresh(root)
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
      onExport: async () => {
        try {
          const json = serializeBackup(await toolService.listTabs(), buttons)
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
          const parsed = parseBackup(text)
          for (const tab of parsed.tabs) {
            await toolService.ensureTabByName(tab.name, tab.emoji)
          }
          for (const tool of parsed.tools) {
            const tab = await toolService.ensureTabByName(tool.tab, null)
            await toolService.createButton(tool.name, tool.prompt, tool.type, tab.id)
          }
          settingsState.error = null
          settingsState.successCount = parsed.tools.length
          announce(`Imported ${parsed.tools.length} tool${parsed.tools.length === 1 ? '' : 's'}.`)
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
      onSignIn: async (providerId: ProviderId) => {
        settingsState.signingIn = true
        await refresh(root)
        let result: { email: string } | null = null
        try {
          result = await authAdapter.signIn()
        } finally {
          settingsState.signingIn = false
        }
        if (result) {
          session = { email: result.email }
          announce(`Signed in as ${result.email}`)
          await refresh(root)
          void resolveOrgSession(root)
        } else {
          announce('Sign in was not completed.')
          await refresh(root)
        }
      },
      onSignOut: async () => {
        await authAdapter.signOut()
        await clearCachedOrgPrompts()
        session = null
        stopUsageReportTimer()
        orgSession = null
        teamPrompts = { orgName: null, tabs: [], prompts: [] }
        if (view.mode === 'org-onboarding') view = { mode: 'list' }
        await refresh(root)
      },
      onOnboardingSubmit: async (data: { orgName: string; initialMemberEmails: string[] }) => {
        const idToken = await authAdapter.getValidToken()
        if (!idToken) {
          announce('Please sign in again to set up your organisation.')
          view = { mode: 'list' }
          await refresh(root)
          return
        }
        const result = await submitOrgOnboarding(idToken, data.orgName, data.initialMemberEmails)
        if (!result) {
          announce('Something went wrong setting up your organisation. Check the console for details.')
          return
        }
        view = { mode: 'list' }
        announce(result.outcome === 'created' ? `${result.org.name} created.` : `Joined ${result.org.name}.`)
        await refresh(root)
        void resolveOrgSession(root)
      },
      onOnboardingCancel: async () => {
        await authAdapter.signOut()
        await clearCachedOrgPrompts()
        session = null
        stopUsageReportTimer()
        orgSession = null
        teamPrompts = { orgName: null, tabs: [], prompts: [] }
        view = { mode: 'list' }
        await refresh(root)
      },
      onOpenManageOrg: () => {
        clearRunErrors()
        manageOrgLoading = true
        view = { mode: 'manage-org' }
        void refresh(root)
        void Promise.allSettled([
          refreshOrgMembers(root),
          refreshOrgPrompts(root),
          refreshOrgUsage(root),
          refreshOrgAnalytics(root),
        ]).then(() => {
          manageOrgLoading = false
          if (view.mode === 'manage-org') void refresh(root)
        })
      },
      onManageOrgBack: () => {
        manageOrgAddError = null
        editingPromptId = null
        promptFormError = null
        view = { mode: 'settings' }
        void refresh(root)
      },
      onLeaveOrg: async () => {
        const leaving = orgSession
        const isPending = leaving?.state === 'pending'
        const name = leaving?.state === 'active' || leaving?.state === 'pending' ? leaving.org.name : 'this organisation'
        const message = isPending
          ? `Cancel your request to join ${name}?`
          : `Leave ${name}? You'll lose access to its shared prompts until you're re-added.`
        if (!window.confirm(message)) return

        const idToken = await authAdapter.getValidToken()
        if (!idToken) {
          announce('Please sign in again.')
          return
        }
        const result = await leaveOrg(idToken)
        if (result === 'last_admin') {
          announce('You are the last admin -- promote someone else before leaving.')
          return
        }
        if (result === 'error') {
          announce('Could not leave the organisation. Check the console for details.')
          return
        }
        // 'left' or 'not_in_org' -- either way the caller has no membership.
        orgSession = null
        orgPrompts = []
        teamPrompts = { orgName: null, tabs: [], prompts: [] }
        await clearCachedOrgPrompts()
        stopUsageReportTimer()
        announce(isPending ? 'Request cancelled.' : `Left ${name}.`)
        await refresh(root)
        void resolveOrgSession(root)
      },
      onApproveMember: async (email: string) => {
        const idToken = await authAdapter.getValidToken()
        if (!idToken) return
        await approveOrgMember(idToken, email)
        await refreshOrgMembers(root)
      },
      onRemoveMember: async (email: string) => {
        const idToken = await authAdapter.getValidToken()
        if (!idToken) return
        const result = await removeOrgMember(idToken, email)
        if (!result.ok) announce(result.error)
        await refreshOrgMembers(root)
      },
      onPromoteMember: async (email: string) => {
        const idToken = await authAdapter.getValidToken()
        if (!idToken) return
        const result = await setOrgMemberRole(idToken, email, 'director')
        if (!result.ok) announce(result.error)
        await refreshOrgMembers(root)
      },
      onDemoteMember: async (email: string) => {
        const idToken = await authAdapter.getValidToken()
        if (!idToken) return
        const result = await setOrgMemberRole(idToken, email, 'member')
        if (!result.ok) announce(result.error)
        await refreshOrgMembers(root)
      },
      onAddMember: async (email: string) => {
        const idToken = await authAdapter.getValidToken()
        if (!idToken) return
        const added = await addOrgMember(idToken, email)
        manageOrgAddError = added ? null : 'Something went wrong adding that member. Check the console for details.'
        await refreshOrgMembers(root)
      },
      onCreateOrgTab: (name: string) =>
        runOrgWrite(root, async (idToken) => {
          await createOrgTab(idToken, { name })
        }),
      onRenameOrgTab: (id: string, name: string, emoji: string | null) =>
        runOrgWrite(root, async (idToken) => {
          await updateOrgTab(idToken, id, { name, emoji })
        }),
      onDeleteOrgTab: async (id: string) => {
        const tab = teamPrompts.tabs.find((t) => t.id === id)
        if (!tab) return
        const count = teamPrompts.prompts.filter((p) => p.tabId === id).length
        const message =
          count === 0
            ? `Delete the shared "${tab.name}" tab?`
            : `Delete the shared "${tab.name}" tab? Its ${count} prompt${count === 1 ? '' : 's'} move to the first remaining tab.`
        if (!window.confirm(message)) return
        await runOrgWrite(root, async (idToken) => {
          const result = await deleteOrgTab(idToken, id)
          if (!result.ok && result.status === 400) {
            announce('An organisation must keep at least one shared tab.')
          }
        })
      },
      onReorderOrgTabs: (orderedIds: string[]) =>
        runOrgWrite(root, async (idToken) => {
          await reorderOrgTabs(idToken, orderedIds)
        }),
      onCreatePrompt: (data) =>
        runOrgWrite(root, async (idToken) => {
          const created = await createOrgPrompt(idToken, data)
          promptFormError = created
            ? null
            : 'Something went wrong adding that prompt. Check the console for details.'
        }),
      onUpdatePrompt: (id, data) =>
        runOrgWrite(root, async (idToken) => {
          const updated = await updateOrgPrompt(idToken, id, data)
          if (updated) editingPromptId = null
          promptFormError = updated
            ? null
            : 'Something went wrong saving that prompt. Check the console for details.'
        }),
      onDeletePrompt: (id: string) =>
        runOrgWrite(root, async (idToken) => {
          await deleteOrgPrompt(idToken, id)
        }),
      onEditPromptClick: (prompt: OrgPrompt) => {
        editingPromptId = prompt.id
        promptFormError = null
        void refresh(root)
      },
      onCancelEditPrompt: () => {
        editingPromptId = null
        promptFormError = null
        void refresh(root)
      },
      onSelectTeamTab: (tabId: string) => {
        teamActiveTabId = tabId
        void refresh(root)
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
            const runToken = crypto.randomUUID()
            const request: InsertPromptRequest = {
              type: 'INSERT_PROMPT',
              prompt: prompt.promptText,
              runToken,
            }
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
              registerPendingRun(runToken, () => {
                void authAdapter.getValidToken().then((token) => {
                  if (token) void reportPromptRun(token, prompt.id)
                })
              })
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
      },
    )
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
  if (session) void resolveOrgSession(root)
}

void start()
