import test from 'node:test'
import assert from 'node:assert/strict'
import type { Block, RichDoc } from '@shared/richtext'
import { mergeProjectedBlocks } from './blockModel'

const paragraph = (id: string, text: string): Block => ({
  id,
  type: 'paragraph',
  runs: text ? [{ text }] : []
})

const doc = (...blocks: Block[]): RichDoc => ({ type: 'doc', blocks })

test('partial edits preserve blocks that the View does not render', () => {
  const source = doc(paragraph('a', 'hidden before'), paragraph('b', 'shown'), paragraph('c', 'hidden after'))
  const edited = doc(paragraph('b', 'changed'))

  assert.deepEqual(mergeProjectedBlocks(source, edited, ['b']), doc(
    paragraph('a', 'hidden before'),
    paragraph('b', 'changed'),
    paragraph('c', 'hidden after')
  ))
})

test('a legacy implicit first-block projection preserves later document blocks', () => {
  const source = doc(paragraph('first', 'Legacy title'), paragraph('hidden', 'Body stays intact'))
  const projection = doc(paragraph('first', 'Renamed title'))

  const merged = mergeProjectedBlocks(source, projection, [source.blocks[0].id])

  assert.deepEqual(merged.blocks.map((block) => block.id), ['first', 'hidden'])
  assert.deepEqual(merged.blocks[1], source.blocks[1])
})

test('new projected blocks stay beside their selected anchor', () => {
  const source = doc(paragraph('a', 'hidden'), paragraph('b', 'shown'), paragraph('c', 'also hidden'))
  const edited = doc(paragraph('b', 'left'), paragraph('new', 'right'))

  assert.deepEqual(mergeProjectedBlocks(source, edited, ['b']), doc(
    paragraph('a', 'hidden'),
    paragraph('b', 'left'),
    paragraph('new', 'right'),
    paragraph('c', 'also hidden')
  ))
})

test('replaying a projection with stale binding IDs does not duplicate inserted blocks', () => {
  const source = doc(paragraph('hidden-a', 'Before'), paragraph('visible', 'Selected'), paragraph('hidden-b', 'After'))
  const projection = doc(paragraph('visible', 'Edited'), paragraph('created', 'New'))

  const first = mergeProjectedBlocks(source, projection, ['visible'])
  const second = mergeProjectedBlocks(first, projection, ['visible'])

  assert.deepEqual(second, first)
  assert.deepEqual(second.blocks.map((block) => block.id), ['hidden-a', 'visible', 'created', 'hidden-b'])
})

test('a stale projection is a no-op', () => {
  const source = doc(paragraph('a', 'safe'))
  assert.deepEqual(mergeProjectedBlocks(source, doc(paragraph('missing', 'unsafe')), ['missing']), source)
})
