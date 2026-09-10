import type { OrgMember } from '../shared/org-members'
import type { OrgPrompt, OrgTab } from '../shared/org-prompts'
import type { OrgUsageSnapshot } from '../shared/usage-report'
import type { OrgAnalytics } from '../shared/org-analytics'
import { joinTabLabel, splitTabLabel } from '../shared/tab-label'
import { moveInList } from '../shared/list-order'
import { createDropdown } from './Dropdown'

export interface ManageOrgState {
  loading: boolean
  /** A shared-tab or shared-prompt write is in flight. */
  busy: boolean
  members: OrgMember[]
  addError: string | null
  orgTabs: OrgTab[]
  prompts: OrgPrompt[]
  editingPromptId: string | null
  promptFormError: string | null
  usageSnapshots: OrgUsageSnapshot[]
  analytics: OrgAnalytics | null
}

function loadingLine(text = 'Loading...'): HTMLElement {
  const p = document.createElement('p')
  p.className = 'loading-line'
  p.textContent = text
  return p
}

export interface ManageOrganisationContext {
  onApprove: (email: string) => void
  onRemove: (email: string) => void
  onPromote: (email: string) => void
  onDemote: (email: string) => void
  onAdd: (email: string) => void
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
  onBack: () => void
}

function sectionHeading(text: string): HTMLElement {
  const h = document.createElement('h3')
  h.className = 'team-section-heading'
  h.textContent = text
  return h
}

function renderMembers(state: ManageOrgState, context: ManageOrganisationContext): DocumentFragment {
  const frag = document.createDocumentFragment()
  frag.appendChild(sectionHeading('Members'))

  if (state.loading && state.members.length === 0) {
    frag.appendChild(loadingLine())
  }

  const list = document.createElement('ul')
  list.className = 'roster-list'
  state.members.forEach((member) => {
    const item = document.createElement('li')
    item.className = 'roster-row'

    const email = document.createElement('span')
    email.className = 'roster-row-email'
    email.textContent = member.email
    item.appendChild(email)

    const status = document.createElement('span')
    status.className = 'roster-row-status'
    status.textContent =
      member.status === 'pending' ? 'Pending' : member.role === 'director' ? 'Admin' : 'Member'
    item.appendChild(status)

    const actions = document.createElement('div')
    actions.className = 'roster-row-actions'

    if (member.status === 'pending') {
      const approve = document.createElement('button')
      approve.type = 'button'
      approve.className = 'settings-action-button'
      approve.textContent = 'Approve'
      approve.addEventListener('click', () => context.onApprove(member.email))
      actions.appendChild(approve)
    } else if (member.role === 'member') {
      const promote = document.createElement('button')
      promote.type = 'button'
      promote.className = 'settings-action-button'
      promote.textContent = 'Make admin'
      promote.addEventListener('click', () => context.onPromote(member.email))
      actions.appendChild(promote)
    } else {
      const demote = document.createElement('button')
      demote.type = 'button'
      demote.className = 'settings-action-button'
      demote.textContent = 'Remove admin role'
      demote.addEventListener('click', () => context.onDemote(member.email))
      actions.appendChild(demote)
    }

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'icon-button icon-button-danger'
    remove.textContent = 'Remove'
    remove.addEventListener('click', () => context.onRemove(member.email))
    actions.appendChild(remove)

    item.appendChild(actions)
    list.appendChild(item)
  })
  frag.appendChild(list)

  const addSection = document.createElement('div')
  addSection.className = 'settings-section'
  const addForm = document.createElement('form')
  addForm.className = 'roster-add-form'
  const addInput = document.createElement('input')
  addInput.type = 'email'
  addInput.required = true
  addInput.placeholder = 'teammate@company.com'
  addForm.appendChild(addInput)
  const addButton = document.createElement('button')
  addButton.type = 'submit'
  addButton.className = 'settings-action-button'
  addButton.textContent = 'Add member'
  addForm.appendChild(addButton)
  addForm.addEventListener('submit', (event) => {
    event.preventDefault()
    const value = addInput.value.trim()
    if (!value) return
    context.onAdd(value)
    addInput.value = ''
  })
  addSection.appendChild(addForm)
  const addHint = document.createElement('p')
  addHint.className = 'settings-hint'
  addHint.textContent = 'Added people appear as Pending until you approve them.'
  addSection.appendChild(addHint)
  if (state.addError) {
    const error = document.createElement('p')
    error.className = 'settings-error'
    error.textContent = state.addError
    addSection.appendChild(error)
  }
  frag.appendChild(addSection)
  return frag
}

function renderSharedTabs(state: ManageOrgState, context: ManageOrganisationContext): DocumentFragment {
  const frag = document.createDocumentFragment()
  frag.appendChild(sectionHeading('Shared tabs'))

  if ((state.loading && state.orgTabs.length === 0) || state.busy) {
    frag.appendChild(loadingLine(state.busy ? 'Saving...' : 'Loading...'))
  }

  const ids = state.orgTabs.map((t) => t.id)
  const list = document.createElement('ul')
  list.className = 'tab-manager-list'
  state.orgTabs.forEach((tab) => {
    const row = document.createElement('li')
    row.className = 'tab-manager-row'

    const handle = document.createElement('button')
    handle.type = 'button'
    handle.className = 'drag-handle'
    handle.textContent = '☰'
    handle.setAttribute('aria-label', `Reorder ${tab.name}. Arrow keys to move, or drag.`)
    handle.draggable = true
    handle.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData('text/plain', tab.id)
      row.classList.add('dragging')
    })
    handle.addEventListener('dragend', () => row.classList.remove('dragging'))
    handle.addEventListener('keydown', (event) => {
      const i = ids.indexOf(tab.id)
      if (event.key === 'ArrowUp' && i > 0) {
        event.preventDefault()
        context.onReorderOrgTabs(moveInList(ids, tab.id, ids[i - 1], 'before'))
      } else if (event.key === 'ArrowDown' && i < ids.length - 1) {
        event.preventDefault()
        context.onReorderOrgTabs(moveInList(ids, tab.id, ids[i + 1], 'after'))
      }
    })
    row.appendChild(handle)

    row.addEventListener('dragover', (event) => {
      event.preventDefault()
      const rect = row.getBoundingClientRect()
      const after = event.clientY - rect.top > rect.height / 2
      row.classList.toggle('drag-over-top', !after)
      row.classList.toggle('drag-over-bottom', after)
    })
    row.addEventListener('dragleave', () => row.classList.remove('drag-over-top', 'drag-over-bottom'))
    row.addEventListener('drop', (event) => {
      event.preventDefault()
      row.classList.remove('drag-over-top', 'drag-over-bottom')
      const draggedId = event.dataTransfer?.getData('text/plain')
      if (!draggedId || draggedId === tab.id) return
      const rect = row.getBoundingClientRect()
      const after = event.clientY - rect.top > rect.height / 2
      context.onReorderOrgTabs(moveInList(ids, draggedId, tab.id, after ? 'after' : 'before'))
    })

    const label = document.createElement('input')
    label.type = 'text'
    label.className = 'tab-manager-name'
    label.value = joinTabLabel(tab.emoji, tab.name)
    label.setAttribute('aria-label', `Name for ${tab.name} (start with an emoji to set an icon)`)

    function commit(): void {
      const { emoji, name } = splitTabLabel(label.value)
      if (name.length === 0) {
        label.value = joinTabLabel(tab.emoji, tab.name)
        return
      }
      if (name === tab.name && emoji === (tab.emoji ?? null)) return
      context.onRenameOrgTab(tab.id, name, emoji)
    }
    label.addEventListener('blur', commit)
    label.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        ;(e.target as HTMLInputElement).blur()
      }
    })

    row.appendChild(label)

    const controls = document.createElement('div')
    controls.className = 'tab-manager-controls'

    const del = document.createElement('button')
    del.type = 'button'
    del.className = 'icon-button icon-button-danger'
    del.textContent = 'Delete'
    del.setAttribute('aria-label', `Delete ${tab.name}`)
    del.disabled = state.orgTabs.length <= 1
    del.addEventListener('click', () => context.onDeleteOrgTab(tab.id))
    controls.appendChild(del)

    row.appendChild(controls)
    list.appendChild(row)
  })
  frag.appendChild(list)

  const addForm = document.createElement('form')
  addForm.className = 'roster-add-form'
  const addInput = document.createElement('input')
  addInput.type = 'text'
  addInput.required = true
  addInput.placeholder = 'New shared tab name'
  addForm.appendChild(addInput)
  const addButton = document.createElement('button')
  addButton.type = 'submit'
  addButton.className = 'settings-action-button'
  addButton.textContent = 'Add tab'
  addForm.appendChild(addButton)
  addForm.addEventListener('submit', (event) => {
    event.preventDefault()
    const value = addInput.value.trim()
    if (!value) return
    context.onCreateOrgTab(value)
    addInput.value = ''
  })
  frag.appendChild(addForm)
  return frag
}

function renderPrompts(state: ManageOrgState, context: ManageOrganisationContext): DocumentFragment {
  const frag = document.createDocumentFragment()
  frag.appendChild(sectionHeading('Shared prompts'))

  if ((state.loading && state.prompts.length === 0) || state.busy) {
    frag.appendChild(loadingLine(state.busy ? 'Saving...' : 'Loading...'))
  }

  const tabNameById = new Map(state.orgTabs.map((t) => [t.id, t.name]))

  const promptsList = document.createElement('ul')
  promptsList.className = 'roster-list'
  state.prompts.forEach((prompt) => {
    const item = document.createElement('li')
    item.className = 'roster-row'

    const name = document.createElement('span')
    name.className = 'roster-row-email'
    name.textContent = prompt.name
    item.appendChild(name)

    const meta = document.createElement('span')
    meta.className = 'roster-row-status'
    const tabName = prompt.tabId ? tabNameById.get(prompt.tabId) : null
    meta.textContent = `${prompt.type === 'skill' ? 'Skill' : 'Prompt'}${tabName ? ` · ${tabName}` : ''}`
    item.appendChild(meta)

    const actions = document.createElement('div')
    actions.className = 'roster-row-actions'

    const edit = document.createElement('button')
    edit.type = 'button'
    edit.className = 'settings-action-button'
    edit.textContent = 'Edit'
    edit.addEventListener('click', () => context.onEditPromptClick(prompt))
    actions.appendChild(edit)

    const del = document.createElement('button')
    del.type = 'button'
    del.className = 'icon-button icon-button-danger'
    del.textContent = 'Delete'
    del.addEventListener('click', () => context.onDeletePrompt(prompt.id))
    actions.appendChild(del)

    item.appendChild(actions)
    promptsList.appendChild(item)
  })
  frag.appendChild(promptsList)

  const editingPrompt = state.prompts.find((p) => p.id === state.editingPromptId) ?? null

  const form = document.createElement('form')
  form.className = 'edit-form'

  const typeToggle = document.createElement('div')
  typeToggle.className = 'type-toggle'
  const promptOpt = document.createElement('label')
  promptOpt.className = 'type-toggle-option'
  const promptRadio = document.createElement('input')
  promptRadio.type = 'radio'
  promptRadio.name = 'org-prompt-type'
  promptRadio.value = 'prompt'
  promptRadio.checked = (editingPrompt?.type ?? 'prompt') === 'prompt'
  promptOpt.appendChild(promptRadio)
  promptOpt.appendChild(document.createTextNode('Prompt'))
  typeToggle.appendChild(promptOpt)
  const skillOpt = document.createElement('label')
  skillOpt.className = 'type-toggle-option'
  const skillRadio = document.createElement('input')
  skillRadio.type = 'radio'
  skillRadio.name = 'org-prompt-type'
  skillRadio.value = 'skill'
  skillRadio.checked = editingPrompt?.type === 'skill'
  skillOpt.appendChild(skillRadio)
  skillOpt.appendChild(document.createTextNode('Skill'))
  typeToggle.appendChild(skillOpt)
  form.appendChild(typeToggle)

  let selectedTabId = editingPrompt?.tabId ?? state.orgTabs[0]?.id ?? ''
  if (state.orgTabs.length > 0) {
    const tabLabel = document.createElement('label')
    tabLabel.textContent = 'Tab'
    tabLabel.appendChild(
      createDropdown({
        ariaLabel: 'Tab',
        value: selectedTabId,
        options: state.orgTabs.map((tab) => ({
          value: tab.id,
          label: tab.emoji ? `${tab.emoji} ${tab.name}` : tab.name,
        })),
        onChange: (value) => {
          selectedTabId = value
        },
      }),
    )
    form.appendChild(tabLabel)
  }

  const nameLabel = document.createElement('label')
  nameLabel.textContent = 'Name'
  const nameInput = document.createElement('input')
  nameInput.type = 'text'
  nameInput.required = true
  nameInput.value = editingPrompt?.name ?? ''
  nameLabel.appendChild(nameInput)
  form.appendChild(nameLabel)

  const textLabel = document.createElement('label')
  textLabel.textContent = 'Prompt text'
  const textInput = document.createElement('textarea')
  textInput.required = true
  textInput.rows = 6
  textInput.value = editingPrompt?.promptText ?? ''
  textLabel.appendChild(textInput)
  form.appendChild(textLabel)

  const actions = document.createElement('div')
  actions.className = 'edit-form-actions'
  if (state.editingPromptId) {
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.textContent = 'Cancel'
    cancel.addEventListener('click', context.onCancelEditPrompt)
    actions.appendChild(cancel)
  }
  const submit = document.createElement('button')
  submit.type = 'submit'
  submit.textContent = state.editingPromptId ? 'Save prompt' : 'Add prompt'
  actions.appendChild(submit)
  form.appendChild(actions)

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const name = nameInput.value.trim()
    const promptText = textInput.value.trim()
    if (!name || !promptText) return
    const type: 'prompt' | 'skill' = skillRadio.checked ? 'skill' : 'prompt'
    const tabId = selectedTabId || state.orgTabs[0]?.id || ''
    if (state.editingPromptId) {
      context.onUpdatePrompt(state.editingPromptId, { name, promptText, type, tabId })
    } else {
      context.onCreatePrompt({ name, promptText, type, tabId })
    }
  })
  frag.appendChild(form)

  if (state.promptFormError) {
    const err = document.createElement('p')
    err.className = 'settings-error'
    err.textContent = state.promptFormError
    frag.appendChild(err)
  }
  return frag
}

function statTile(value: string, label: string): HTMLElement {
  const tile = document.createElement('div')
  tile.className = 'stat-tile'
  const big = document.createElement('span')
  big.className = 'stat-tile-value'
  big.textContent = value
  const small = document.createElement('span')
  small.className = 'stat-tile-label'
  small.textContent = label
  tile.appendChild(big)
  tile.appendChild(small)
  return tile
}

function renderAnalytics(state: ManageOrgState): DocumentFragment {
  const frag = document.createDocumentFragment()
  frag.appendChild(sectionHeading('Analytics'))

  const a = state.analytics
  if (!a) {
    frag.appendChild(state.loading ? loadingLine() : (() => {
      const hint = document.createElement('p')
      hint.className = 'settings-hint'
      hint.textContent = 'No analytics yet.'
      return hint
    })())
    return frag
  }

  const totalRuns = a.perMember.reduce((sum, m) => sum + m.runCount, 0)
  const activeMembers = a.perMember.filter((m) => m.runCount > 0).length

  const panel = frag

  const tiles = document.createElement('div')
  tiles.className = 'stat-tiles'
  tiles.appendChild(statTile(String(totalRuns), 'Prompt runs'))
  tiles.appendChild(statTile(String(activeMembers), 'Active members'))
  panel.appendChild(tiles)

  const topHeading = document.createElement('p')
  topHeading.className = 'settings-hint'
  topHeading.textContent = 'Top prompts'
  panel.appendChild(topHeading)

  const topList = document.createElement('ul')
  topList.className = 'roster-list'
  a.topPrompts.slice(0, 10).forEach((p) => {
    const item = document.createElement('li')
    item.className = 'roster-row'
    const name = document.createElement('span')
    name.className = 'roster-row-email'
    name.textContent = p.name
    item.appendChild(name)
    const count = document.createElement('span')
    count.className = 'roster-row-status'
    count.textContent = p.runCount === 1 ? '1 run' : `${p.runCount} runs`
    item.appendChild(count)
    topList.appendChild(item)
  })
  panel.appendChild(topList)

  const perHeading = document.createElement('p')
  perHeading.className = 'settings-hint'
  perHeading.textContent = 'Per member'
  panel.appendChild(perHeading)

  const perList = document.createElement('ul')
  perList.className = 'roster-list'
  a.perMember.forEach((m) => {
    const item = document.createElement('li')
    item.className = 'roster-row'
    const email = document.createElement('span')
    email.className = 'roster-row-email'
    email.textContent = m.email
    item.appendChild(email)
    const count = document.createElement('span')
    count.className = 'roster-row-status'
    count.textContent = m.runCount === 1 ? '1 run' : `${m.runCount} runs`
    item.appendChild(count)
    perList.appendChild(item)
  })
  panel.appendChild(perList)

  return frag
}

function renderUsageSnapshots(state: ManageOrgState): DocumentFragment {
  const frag = document.createDocumentFragment()
  frag.appendChild(sectionHeading('Member usage limits'))

  if (state.usageSnapshots.length === 0) {
    if (state.loading) {
      frag.appendChild(loadingLine())
    } else {
      const empty = document.createElement('p')
      empty.className = 'settings-hint'
      empty.textContent = 'No usage reported yet.'
      frag.appendChild(empty)
    }
    return frag
  }

  const list = document.createElement('ul')
  list.className = 'roster-list'
  state.usageSnapshots.forEach((snapshot) => {
    const item = document.createElement('li')
    item.className = 'roster-row'
    const email = document.createElement('span')
    email.className = 'roster-row-email'
    email.textContent = snapshot.email
    item.appendChild(email)
    const percents = document.createElement('span')
    percents.className = 'roster-row-status'
    const parts = [
      snapshot.sessionPercent !== null ? `Session ${snapshot.sessionPercent}%` : null,
      snapshot.weeklyPercent !== null ? `Weekly ${snapshot.weeklyPercent}%` : null,
      snapshot.spendPercent !== null ? `Spend ${snapshot.spendPercent}%` : null,
    ].filter((part): part is string => part !== null)
    percents.textContent = parts.length > 0 ? parts.join(' · ') : 'No data'
    item.appendChild(percents)
    list.appendChild(item)
  })
  frag.appendChild(list)
  return frag
}

export function renderManageOrganisation(
  state: ManageOrgState,
  context: ManageOrganisationContext,
): HTMLElement {
  const container = document.createElement('div')
  container.className = 'manage-org'

  const heading = document.createElement('h2')
  heading.className = 'settings-heading'
  heading.textContent = 'Manage Organisation'
  container.appendChild(heading)

  container.appendChild(renderMembers(state, context))
  container.appendChild(renderSharedTabs(state, context))
  container.appendChild(renderPrompts(state, context))
  container.appendChild(renderAnalytics(state))
  container.appendChild(renderUsageSnapshots(state))

  const back = document.createElement('button')
  back.type = 'button'
  back.className = 'settings-back-button'
  back.innerHTML = '<span class="gi">←</span> Back'
  back.addEventListener('click', context.onBack)
  container.appendChild(back)

  return container
}
