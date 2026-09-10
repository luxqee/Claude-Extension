import type { Button, ButtonType, ToolTab } from '../shared/types'
import type { ButtonUsageMap } from '../shared/prompt-usage'

// AIRE wordmark (getaiready.now). Inherits currentColor for theming.
const AIRE_LOGO_SVG =
  '<svg viewBox="0 0 856 223" height="22" fill="currentColor" role="img" aria-label="AIRE">' +
  '<path transform="translate(0.244 -1.886) scale(2.1244)" d="M41.7,2.3h25.4c1.3,0,2.4.8,2.9,2.1l34.8,95.8c.8,2.2-.7,4.5-2.9,4.5h-22.9c-1.3,0-2.5-.9-2.9-2.2l-4-11.7c-.4-1.3-1.6-2.2-2.9-2.2h-30.9c-1.3,0-2.5.9-2.9,2.2l-3.9,11.7c-.4,1.3-1.6,2.2-2.9,2.2H6.3c-2.2,0-3.7-2.3-2.9-4.5L38.8,4.4c.5-1.3,1.6-2.1,2.9-2.1h0ZM65,69c.8,0,1.4-.8,1.1-1.6l-10.8-30.9c-.4-1.1-1.9-1.1-2.2,0l-10.8,30.9c-.3.8.3,1.5,1.1,1.5h21.8,0Z"></path>' +
  '<path d="M279.41,13.91Q280.81,3 291.81,3L341.39,3Q352.39,3 350.99,13.91L325.99,209.09Q324.59,220 313.59,220L264.01,220Q253.01,220 254.41,209.09Z"></path>' +
  '<path transform="translate(375.414 -255.964) scale(2.1244)" d="M3.2,125.2c0-1.8,1.4-3.3,3.1-3.3h58.2c19.9,0,40.6,5.1,40.6,26.9v7.3c0,12.4-7.2,19.6-19.9,21.1v1.5c11.2,1.4,18.3,6.5,18.3,18.9v7.3c0,3.6,0,9.1.9,14.9.3,2.1-1.1,4-3,4h-25.8c-1.7,0-3.1-1.5-3.1-3.3v-18.5c0-7.3-3.2-10.2-11.1-10.2h-26.9c-1.7,0-3.1,1.5-3.1,3.3v25.3c0,1.9-1.4,3.3-3.1,3.3H6.2c-1.7,0-3.1-1.5-3.1-3.3v-95.2h0ZM62.8,166.9c6.4,0,9.5-2.9,9.5-8.1v-4.2c0-5.1-3.2-8-9.5-8h-28.5c-1.7,0-3.1,1.5-3.1,3.3v13.7c0,1.9,1.4,3.3,3.1,3.3h28.5Z"></path>' +
  '<path transform="translate(373.398 -255.752) scale(2.1244)" d="M126.5,121.8h92.3c2.4,0,4.3,1.6,4.3,3.5v17.8c0,1.9-1.9,3.5-4.3,3.5h-61.5v14.6h57.9c2.4,0,4.3,1.6,4.3,3.5v15.6c0,1.9-1.9,3.5-4.3,3.5h-57.9v15.3h62.4c2.4,0,4.3,1.6,4.3,3.5v17.8c0,1.9-1.9,3.5-4.3,3.5h-93.2c-2.4,0-4.3-1.6-4.3-3.5v-94.9c0-1.9,1.9-3.5,4.3-3.5h0Z"></path>' +
  '</svg>'
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
import type { ProviderId } from '../shared/auth/providers'

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
  signingIn: boolean
  orgResolving: boolean
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
  onSignIn: (providerId: ProviderId) => void
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
  onReorderOrgTabs: (orderedIds: string[]) => void
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

  // Persistent AIRE wordmark, top-left of every view.
  const appHeader = document.createElement('div')
  appHeader.className = 'app-header'
  const brand = document.createElement('span')
  brand.className = 'wordmark'
  brand.innerHTML = AIRE_LOGO_SVG
  appHeader.appendChild(brand)
  root.appendChild(appHeader)

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
        onReorder: context.onReorderTabs,
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
        signingIn: settingsState.signingIn,
        orgResolving: settingsState.orgResolving,
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
        onReorderOrgTabs: context.onReorderOrgTabs,
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
  addButton.innerHTML = '<span class="gi">+</span> Add tool'
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
        ? 'No tools in this tab yet. Add your first one with the button above.'
        : 'No tools yet. Add your first one with the button above.'
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
