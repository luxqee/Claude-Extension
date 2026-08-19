import type { OrgPrompt } from '../shared/org-prompts'

export function renderTeamSection(
  orgName: string,
  prompts: OrgPrompt[],
  onRun: (prompt: OrgPrompt) => void,
): HTMLElement {
  const section = document.createElement('div')
  section.className = 'team-section'

  const heading = document.createElement('h3')
  heading.className = 'team-section-heading'
  heading.textContent = `Team — ${orgName}`
  section.appendChild(heading)

  const list = document.createElement('ul')
  list.className = 'team-list'
  prompts.forEach((prompt) => {
    const item = document.createElement('li')
    item.className = 'team-row'

    if (prompt.type === 'skill') {
      const badge = document.createElement('span')
      badge.className = 'skill-badge'
      badge.textContent = '/'
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

    list.appendChild(item)
  })
  section.appendChild(list)

  return section
}
