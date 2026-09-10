import type { Button, ButtonType, ToolTab } from '../shared/types'
import type { ButtonUsageMap } from '../shared/prompt-usage'
import { renderButtonRow } from './ButtonRow'
import { renderEditForm } from './EditForm'
import { renderSettingsPanel } from './SettingsPanel'
import { renderTeamSection } from './TeamSection'
import { renderOrgOnboarding } from './OrgOnboarding'
import { renderManageOrganisation, type ManageOrgState } from './ManageOrganisation'
import { renderTabStrip } from './TabStrip'
import { renderTabManager } from './TabManager'
import type { OrgPrompt, OrgPromptsResult } from '../shared/org-prompts'
import type { OrgSessionState } from '../shared/org-session'

export type View =
  | { mode: 'list' }
  | { mode: 'form'; button: Button | null }
  | { mode: 'settings' }
  | { mode: 'org-onboarding' }
  | { mode: 'manage-org' }
  | { mode: 'tabs' }

export interface TabViewState {
  tabs: ToolTab[]
  activeTabId: string | null
  defaultTabId: string | null
  sortMode: 'manual' | 'most-used'
  buttonUsage: ButtonUsageMap
  /** Every personal button across all tabs -- for tab-manager counts. */
  allButtons: Button[]
}

export interface RunState {
  isRunning: boolean
  error: string | null
}

export interface SettingsState {
  error: string | null
  successCount: number | null
}

export interface RenderContext {
  onRun: (button: Button) => void
  onEdit: (button: Button) => void
  onDelete: (button: Button) => void
  onDrop: (draggedId: string, targetId: string, position: 'before' | 'after') => void
  onArrowMove: (id: string, direction: 'up' | 'down') => void
  onAddClick: () => void
  onSave: (data: { id: string | null; name: string; prompt: string; type: ButtonType; tabId: string }) => void
  onCancel: () => void
  onSelectTab: (tabId: string) => void
  onToggleSort: () => void
  onAddTab: () => void
  onManageTabs: () => void
  onReorderTabs: (orderedIds: string[]) => void
  onRenameTab: (id: string, name: string, emoji: string | null) => void
  onMoveTab: (id: string, direction: 'up' | 'down') => void
  onDeleteTab: (id: string) => void
  onSetDefaultTab: (id: string) => void
  onTabsBack: () => void
  onOpenSettings: () => void
  onExport: () => void
  onImport: (file: File) => void
  onSettingsBack: () => void
  onSignIn: () => void
  onSignOut: () => void
  onRunTeamPrompt: (prompt: OrgPrompt) => void
  onOnboardingSubmit: (data: { orgName: string; initialMemberEmails: string[] }) => void
  onOnboardingCancel: () => void
  onOpenManageOrg: () => void
  onManageOrgBack: () => void
  onApproveMember: (email: string) => void
  onRemoveMember: (email: string) => void
  onPromoteMember: (email: string) => void
  onDemoteMember: (email: string) => void
  onAddMember: (email: string) => void
  onCreateOrgTab: (name: string) => void
  onRenameOrgTab: (id: string, name: string, emoji: string | null) => void
  onDeleteOrgTab: (id: string) => void
  onMoveOrgTab: (id: string, direction: 'up' | 'down') => void
  onCreatePrompt: (data: { name: string; promptText: string; type: 'prompt' | 'skill'; tabId: string }) => void
  onUpdatePrompt: (
    id: string,
    data: { name: string; promptText: string; type: 'prompt' | 'skill'; tabId: string },
  ) => void
  onDeletePrompt: (id: string) => void
  onEditPromptClick: (prompt: OrgPrompt) => void
  onCancelEditPrompt: () => void
}

export function withMovedId(
  ids: string[],
  draggedId: string,
  targetId: string,
  position: 'before' | 'after',
): string[] {
  const remaining = ids.filter((id) => id !== draggedId)
  const targetIndex = remaining.indexOf(targetId)
  const insertAt = position === 'before' ? targetIndex : targetIndex + 1
  remaining.splice(insertAt, 0, draggedId)
  return remaining
}

export function withSwappedAdjacent(ids: string[], id: string, direction: 'up' | 'down'): string[] | null {
  const index = ids.indexOf(id)
  const swapWith = direction === 'up' ? index - 1 : index + 1
  if (index === -1 || swapWith < 0 || swapWith >= ids.length) return null
  const next = [...ids]
  ;[next[index], next[swapWith]] = [next[swapWith], next[index]]
  return next
}

export function renderApp(
  root: HTMLElement,
  buttons: Button[],
  tabState: TabViewState,
  view: View,
  runState: Map<string, RunState>,
  settingsState: SettingsState,
  session: { email: string } | null,
  orgSession: OrgSessionState | null,
  teamPrompts: OrgPromptsResult,
  manageOrgState: ManageOrgState,
  context: RenderContext,
): void {
  root.innerHTML = ''

  if (view.mode === 'form') {
    root.appendChild(
      renderEditForm(view.button, tabState.tabs, tabState.activeTabId, {
        onSave: context.onSave,
        onCancel: context.onCancel,
      }),
    )
    return
  }

  if (view.mode === 'tabs') {
    const buttonCountByTab: Record<string, number> = {}
    for (const button of tabState.allButtons) {
      buttonCountByTab[button.tabId] = (buttonCountByTab[button.tabId] ?? 0) + 1
    }
    root.appendChild(
      renderTabManager(tabState.tabs, {
        defaultTabId: tabState.defaultTabId,
        buttonCountByTab,
        onRename: context.onRenameTab,
        onReorder: context.onMoveTab,
        onDelete: context.onDeleteTab,
        onSetDefault: context.onSetDefaultTab,
        onAdd: context.onAddTab,
        onBack: context.onTabsBack,
      }),
    )
    return
  }

  if (view.mode === 'settings') {
    root.appendChild(
      renderSettingsPanel({
        onExport: context.onExport,
        onImport: context.onImport,
        onBack: context.onSettingsBack,
        importError: settingsState.error,
        importSuccessCount: settingsState.successCount,
        session,
        onSignIn: context.onSignIn,
        onSignOut: context.onSignOut,
        orgSession,
        onOpenManageOrg: context.onOpenManageOrg,
      }),
    )
    return
  }

  if (view.mode === 'org-onboarding') {
    root.appendChild(
      renderOrgOnboarding({ onSubmit: context.onOnboardingSubmit, onCancel: context.onOnboardingCancel }),
    )
    return
  }

  if (view.mode === 'manage-org') {
    root.appendChild(
      renderManageOrganisation(manageOrgState, {
        onApprove: context.onApproveMember,
        onRemove: context.onRemoveMember,
        onPromote: context.onPromoteMember,
        onDemote: context.onDemoteMember,
        onAdd: context.onAddMember,
        onCreateOrgTab: context.onCreateOrgTab,
        onRenameOrgTab: context.onRenameOrgTab,
        onDeleteOrgTab: context.onDeleteOrgTab,
        onMoveOrgTab: context.onMoveOrgTab,
        onCreatePrompt: context.onCreatePrompt,
        onUpdatePrompt: context.onUpdatePrompt,
        onDeletePrompt: context.onDeletePrompt,
        onEditPromptClick: context.onEditPromptClick,
        onCancelEditPrompt: context.onCancelEditPrompt,
        onBack: context.onManageOrgBack,
      }),
    )
    return
  }

  const header = document.createElement('div')
  header.className = 'toolbar'

  const wordmark = document.createElement('span')
  wordmark.className = 'wordmark'
  wordmark.textContent = 'Claude Tools'
  header.appendChild(wordmark)

  const headerActions = document.createElement('div')
  headerActions.className = 'toolbar-actions'
  const settingsButton = document.createElement('button')
  settingsButton.type = 'button'
  settingsButton.className = 'icon-button settings-button'
  settingsButton.textContent = '⚙'
  settingsButton.setAttribute('aria-label', 'Settings')
  settingsButton.addEventListener('click', context.onOpenSettings)
  headerActions.appendChild(settingsButton)
  const addButton = document.createElement('button')
  addButton.type = 'button'
  addButton.className = 'add-button'
  addButton.textContent = '+ Add tool'
  addButton.addEventListener('click', context.onAddClick)
  headerActions.appendChild(addButton)
  header.appendChild(headerActions)
  root.appendChild(header)

  if (tabState.tabs.length > 0) {
    root.appendChild(
      renderTabStrip(tabState.tabs, {
        activeTabId: tabState.activeTabId,
        onSelect: context.onSelectTab,
        onAdd: context.onAddTab,
        onManage: context.onManageTabs,
        onReorder: context.onReorderTabs,
      }),
    )
  }

  // `buttons` arrives already scoped to the active tab and already sorted
  // (manual order or most-used) by main.ts.
  const visibleButtons = buttons

  if (visibleButtons.length > 0 || tabState.sortMode === 'most-used') {
    const sortRow = document.createElement('div')
    sortRow.className = 'sort-row'
    const sortToggle = document.createElement('button')
    sortToggle.type = 'button'
    sortToggle.className = 'sort-toggle'
    sortToggle.textContent =
      tabState.sortMode === 'most-used' ? 'Sorted by most used' : 'Sort by most used'
    sortToggle.setAttribute('aria-pressed', String(tabState.sortMode === 'most-used'))
    sortToggle.addEventListener('click', context.onToggleSort)
    sortRow.appendChild(sortToggle)
    root.appendChild(sortRow)
  }

  if (visibleButtons.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'empty-state'
    empty.textContent =
      tabState.tabs.length > 0
        ? 'No tools in this tab yet. Click "Add tool" to create one.'
        : 'No tools yet. Click "Add tool" to create your first one.'
    root.appendChild(empty)
  } else {
  const list = document.createElement('ul')
  list.className = 'button-list'
  visibleButtons.forEach((button) => {
    const state = runState.get(button.id) ?? { isRunning: false, error: null }
    list.appendChild(
      renderButtonRow(button, {
        isRunning: state.isRunning,
        runError: state.error,
        usageCount: tabState.buttonUsage[button.id]?.count ?? 0,
        reorderable: tabState.sortMode === 'manual',
        onRun: () => context.onRun(button),
        onEdit: () => context.onEdit(button),
        onDelete: () => context.onDelete(button),
        onDrop: (draggedId, position) => context.onDrop(draggedId, button.id, position),
        onArrowMove: (direction) => context.onArrowMove(button.id, direction),
      }),
    )
  })
  root.appendChild(list)
  }

  if (orgSession?.state === 'pending') {
    const banner = document.createElement('p')
    banner.className = 'org-pending-banner'
    banner.textContent = "You're signed in. Waiting for an admin to approve you."
    root.appendChild(banner)
  } else if (
    // `orgSession === null` means unresolved -- the /api/org-session call
    // never came back (offline, backend down), which is different from a
    // resolved non-active state. In that case fall back to whatever
    // loadOrgPrompts recovered from its local cache, so the Team section
    // stays usable offline instead of vanishing.
    (orgSession?.state === 'active' || orgSession === null) &&
    teamPrompts.prompts.length > 0
  ) {
    root.appendChild(
      renderTeamSection(
        teamPrompts.orgName ?? 'Team',
        teamPrompts.tabs,
        teamPrompts.prompts,
        context.onRunTeamPrompt,
      ),
    )
  }
}
