import { beforeEach, describe, expect, it } from 'vitest'
import { ToolService } from '../../src/shared/tool-service'
import { FakeStorageAdapter } from '../support/fake-storage-adapter'

describe('ToolService', () => {
  let storage: FakeStorageAdapter
  let service: ToolService

  beforeEach(() => {
    storage = new FakeStorageAdapter()
    service = new ToolService(storage)
  })

  it('creates a button with an incrementing order and a generated id', async () => {
    const first = await service.createButton('Summarize', 'Summarize this.')
    const second = await service.createButton('Translate', 'Translate this.')
    expect(first.order).toBe(0)
    expect(second.order).toBe(1)
    expect(first.id).not.toBe(second.id)
    expect(first.name).toBe('Summarize')
    expect(first.prompt).toBe('Summarize this.')
  })

  it('continues past the highest existing order after delete-then-create, instead of reusing a count-based order', async () => {
    const a = await service.createButton('A', 'a')
    const b = await service.createButton('B', 'b')
    const c = await service.createButton('C', 'c')
    const d = await service.createButton('D', 'd')
    expect([a.order, b.order, c.order, d.order]).toEqual([0, 1, 2, 3])

    await service.deleteButton(b.id)
    await service.deleteButton(c.id)

    const e = await service.createButton('E', 'e')
    expect(e.order).toBe(4)
  })

  it('lists buttons sorted by order', async () => {
    await storage.saveButton({ id: 'b', name: 'B', order: 1, prompt: 'b' })
    await storage.saveButton({ id: 'a', name: 'A', order: 0, prompt: 'a' })
    const buttons = await service.listButtons()
    expect(buttons.map((b) => b.id)).toEqual(['a', 'b'])
  })

  it('updates an existing button, preserving fields not passed', async () => {
    const created = await service.createButton('Name', 'Prompt')
    await service.updateButton(created.id, { name: 'New Name' })
    const [button] = await service.listButtons()
    expect(button.name).toBe('New Name')
    expect(button.prompt).toBe('Prompt')
  })

  it('throws when updating a button that does not exist', async () => {
    await expect(service.updateButton('missing-id', { name: 'X' })).rejects.toThrow(
      'Button not found: missing-id',
    )
  })

  it('deletes a button', async () => {
    const created = await service.createButton('Name', 'Prompt')
    await service.deleteButton(created.id)
    expect(await service.listButtons()).toEqual([])
  })

  it('reorders buttons', async () => {
    const a = await service.createButton('A', 'a')
    const b = await service.createButton('B', 'b')
    await service.reorderButtons([b.id, a.id])
    const buttons = await service.listButtons()
    expect(buttons.map((btn) => btn.id)).toEqual([b.id, a.id])
  })
})
