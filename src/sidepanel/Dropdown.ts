// A custom select that matches the AIRE site's dropdown menu: a themed
// trigger button and a raised, rounded, shadowed panel of options, each
// with a check slot for the current selection. Keyboard accessible
// (Enter/Space/ArrowDown to open, arrows to move, Enter to choose, Esc to
// close) and closes on outside click.

export interface DropdownOption {
  value: string
  label: string
}

export interface DropdownConfig {
  options: DropdownOption[]
  value: string
  ariaLabel: string
  onChange: (value: string) => void
}

const CHECK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'

const CHEVRON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5"/></svg>'

export function createDropdown(config: DropdownConfig): HTMLElement {
  let currentValue = config.value
  let open = false

  const wrapper = document.createElement('div')
  wrapper.className = 'dropdown'

  const trigger = document.createElement('button')
  trigger.type = 'button'
  trigger.className = 'dropdown-trigger'
  trigger.setAttribute('aria-haspopup', 'listbox')
  trigger.setAttribute('aria-label', config.ariaLabel)

  const triggerLabel = document.createElement('span')
  triggerLabel.className = 'dropdown-trigger-label'
  const chevron = document.createElement('span')
  chevron.className = 'dropdown-chevron'
  chevron.innerHTML = CHEVRON_SVG
  trigger.appendChild(triggerLabel)
  trigger.appendChild(chevron)

  const panel = document.createElement('div')
  panel.className = 'dropdown-panel'
  panel.setAttribute('role', 'listbox')
  panel.setAttribute('aria-label', config.ariaLabel)
  panel.hidden = true

  const optionButtons: HTMLButtonElement[] = config.options.map((option) => {
    const item = document.createElement('button')
    item.type = 'button'
    item.className = 'dropdown-option'
    item.setAttribute('role', 'option')
    item.dataset.value = option.value

    const check = document.createElement('span')
    check.className = 'dropdown-option-check'

    const label = document.createElement('span')
    label.className = 'dropdown-option-label'
    label.textContent = option.label

    item.appendChild(check)
    item.appendChild(label)
    item.addEventListener('click', () => choose(option.value))
    panel.appendChild(item)
    return item
  })

  function syncSelected(): void {
    triggerLabel.textContent =
      config.options.find((o) => o.value === currentValue)?.label ?? config.options[0]?.label ?? ''
    optionButtons.forEach((btn) => {
      const selected = btn.dataset.value === currentValue
      btn.setAttribute('aria-selected', String(selected))
      btn.querySelector('.dropdown-option-check')!.innerHTML = selected ? CHECK_SVG : ''
    })
  }

  function onDocClick(event: MouseEvent): void {
    if (!wrapper.contains(event.target as Node)) setOpen(false)
  }

  function setOpen(next: boolean): void {
    open = next
    panel.hidden = !open
    trigger.setAttribute('aria-expanded', String(open))
    wrapper.classList.toggle('is-open', open)
    if (open) {
      document.addEventListener('mousedown', onDocClick)
      const selectedIndex = Math.max(
        0,
        optionButtons.findIndex((b) => b.dataset.value === currentValue),
      )
      optionButtons[selectedIndex]?.focus()
    } else {
      document.removeEventListener('mousedown', onDocClick)
    }
  }

  function choose(value: string): void {
    currentValue = value
    syncSelected()
    setOpen(false)
    trigger.focus()
    config.onChange(value)
  }

  trigger.addEventListener('click', () => setOpen(!open))
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setOpen(true)
    }
  })

  panel.addEventListener('keydown', (event) => {
    const index = optionButtons.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      trigger.focus()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      optionButtons[Math.min(optionButtons.length - 1, index + 1)]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      optionButtons[Math.max(0, index - 1)]?.focus()
    } else if (event.key === 'Home') {
      event.preventDefault()
      optionButtons[0]?.focus()
    } else if (event.key === 'End') {
      event.preventDefault()
      optionButtons[optionButtons.length - 1]?.focus()
    }
  })

  wrapper.appendChild(trigger)
  wrapper.appendChild(panel)
  syncSelected()
  return wrapper
}
