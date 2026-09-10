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
  onRun: (prompt: OrgPrompt) => void,
): HTMLElement {
  const section = document.createElement('div')
  section.className = 'team-section'

  const heading = document.createElement('h3')
  heading.className = 'team-section-heading'
  heading.textContent = orgName
  section.appendChild(heading)

  // Group by shared tab. With zero or one tab, render one flat list (no
  // sub-headers) -- same as before tabs existed.
  const orderedTabs = [...tabs].sort((a, b) => a.sortOrder - b.sortOrder)
  const showSubHeaders = orderedTabs.length > 1

  const groups: { label: string | null; prompts: OrgPrompt[] }[] = []
  if (orderedTabs.length === 0) {
    groups.push({ label: null, prompts })
  } else {
    for (const tab of orderedTabs) {
      const inTab = prompts
        .filter((p) => p.tabId === tab.id)
        .sort((a, b) => a.sortOrder - b.sortOrder)
      if (inTab.length > 0) {
        groups.push({ label: showSubHeaders ? (tab.emoji ? `${tab.emoji} ${tab.name}` : tab.name) : null, prompts: inTab })
      }
    }
    const orphaned = prompts.filter((p) => !p.tabId || !orderedTabs.some((t) => t.id === p.tabId))
    if (orphaned.length > 0) groups.push({ label: showSubHeaders ? 'Other' : null, prompts: orphaned })
  }

  for (const group of groups) {
    if (group.label) {
      const sub = document.createElement('p')
      sub.className = 'team-subheading'
      sub.textContent = group.label
      section.appendChild(sub)
    }
    const list = document.createElement('ul')
    list.className = 'team-list'
    group.prompts.forEach((prompt) => list.appendChild(renderPromptRow(prompt, onRun)))
    section.appendChild(list)
  }

  return section
}
