import type { OrgPrompt, OrgTab } from '../shared/org-prompts'
import { badgeFor } from '../shared/badge'

function renderPromptRow(prompt: OrgPrompt, onRun: (p: OrgPrompt) => void): HTMLElement {
  const item = document.createElement('li')
  item.className = 'team-row'

  const badgeChar = badgeFor(prompt.type, prompt.promptText)
  if (badgeChar) {
    const badge = document.createElement('span')
    badge.className = 'skill-badge'
    badge.textContent = badgeChar
    badge.setAttribute('aria-hidden', 'true')
    item.appendChild(badge)
  }

  const name = document.createElement('button')
  name.type = 'button'
  name.className = 'team-row-name'
  name.textContent = prompt.name
  name.setAttribute('aria-label', `Run ${prompt.name}`)
  name.addEventListener('click', () => onRun(prompt))
  item.appendChild(name)

  return item
}

export function renderTeamSection(
  orgName: string,
  tabs: OrgTab[],
  prompts: OrgPrompt[],
  activeTabId: string | null,
  onSelectTab: (tabId: string) => void,
  onRun: (prompt: OrgPrompt) => void,
): HTMLElement {
  const section = document.createElement('div')
  section.className = 'team-section'

  const heading = document.createElement('h3')
  heading.className = 'team-section-heading'
  heading.textContent = orgName
  section.appendChild(heading)

  const orderedTabs = [...tabs].sort((a, b) => a.sortOrder - b.sortOrder)

  // One tab or none: nothing to switch between, so no chip strip -- just
  // the flat prompt list, same as before shared tabs existed.
  if (orderedTabs.length <= 1) {
    const list = document.createElement('ul')
    list.className = 'team-list'
    prompts.forEach((prompt) => list.appendChild(renderPromptRow(prompt, onRun)))
    section.appendChild(list)
    return section
  }

  // Falls back to the first tab if the remembered selection was deleted
  // (or nothing has been picked yet this session).
  const effectiveActiveId = orderedTabs.some((t) => t.id === activeTabId)
    ? activeTabId
    : orderedTabs[0].id

  // Same .tab-chip pill the personal tab strip uses (TabStrip.ts) --
  // clickable buttons, not text labels, to switch which shared tab's
  // prompts are shown below.
  const chipList = document.createElement('div')
  chipList.className = 'tab-strip-list'
  chipList.setAttribute('role', 'tablist')
  chipList.setAttribute('aria-label', `${orgName} tabs`)
  orderedTabs.forEach((tab) => {
    const isActive = tab.id === effectiveActiveId
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'tab-chip'
    chip.setAttribute('role', 'tab')
    chip.setAttribute('aria-selected', String(isActive))
    if (isActive) chip.classList.add('is-active')
    chip.textContent = tab.emoji ? `${tab.emoji} ${tab.name}` : tab.name
    chip.addEventListener('click', () => onSelectTab(tab.id))
    chipList.appendChild(chip)
  })
  section.appendChild(chipList)

  const list = document.createElement('ul')
  list.className = 'team-list'
  prompts
    .filter((p) => p.tabId === effectiveActiveId)
    .forEach((prompt) => list.appendChild(renderPromptRow(prompt, onRun)))
  section.appendChild(list)

  return section
}
