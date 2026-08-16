import { describe, expect, it } from 'vitest'
import { withMovedId, withSwappedAdjacent } from '../../src/sidepanel/render'

describe('withMovedId', () => {
  it('moves a dragged id before the target id', () => {
    expect(withMovedId(['a', 'b', 'c'], 'c', 'a', 'before')).toEqual(['c', 'a', 'b'])
  })

  it('moves a dragged id after the target id', () => {
    expect(withMovedId(['a', 'b', 'c'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a'])
  })

  it('moves a dragged id down past the target, accounting for the shifted index after removal', () => {
    expect(withMovedId(['a', 'b', 'c', 'd'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a', 'd'])
  })

  it('moves a dragged id up before an earlier target', () => {
    expect(withMovedId(['a', 'b', 'c', 'd'], 'd', 'b', 'before')).toEqual(['a', 'd', 'b', 'c'])
  })

  it('is a no-op in effect when dropped immediately after itself', () => {
    expect(withMovedId(['a', 'b', 'c'], 'a', 'a', 'after')).toEqual(['a', 'b', 'c'])
  })
})

describe('withSwappedAdjacent', () => {
  it('moves a row up by swapping with its predecessor', () => {
    expect(withSwappedAdjacent(['a', 'b', 'c'], 'b', 'up')).toEqual(['b', 'a', 'c'])
  })

  it('moves a row down by swapping with its successor', () => {
    expect(withSwappedAdjacent(['a', 'b', 'c'], 'b', 'down')).toEqual(['a', 'c', 'b'])
  })

  it('returns null when moving the first row up', () => {
    expect(withSwappedAdjacent(['a', 'b', 'c'], 'a', 'up')).toBeNull()
  })

  it('returns null when moving the last row down', () => {
    expect(withSwappedAdjacent(['a', 'b', 'c'], 'c', 'down')).toBeNull()
  })

  it('returns null for an id that is not in the list', () => {
    expect(withSwappedAdjacent(['a', 'b', 'c'], 'missing', 'up')).toBeNull()
  })

  it('returns null for a single-item list in either direction', () => {
    expect(withSwappedAdjacent(['a'], 'a', 'up')).toBeNull()
    expect(withSwappedAdjacent(['a'], 'a', 'down')).toBeNull()
  })
})
