/**
 * 浏览器半边的离线冒烟测试：用宿主同款的 React 渲染面板与结果视图，
 * 并断言 apply 注册了「主面板 + 侧栏入口」两个插槽。
 *
 * 插件本身不带 node_modules，所以 React 路径由 REACT_PATH 指定；
 * 未指定或不可用时整组测试跳过。
 */

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'

const reactPath = process.env.REACT_PATH ?? ''
let React = null
let renderToStaticMarkup = null
if (reactPath !== '') {
  try {
    const requireFrom = createRequire(join(reactPath, 'package.json'))
    React = requireFrom('react')
    renderToStaticMarkup = requireFrom('react-dom/server').renderToStaticMarkup
  } catch (error) {
    console.warn('[client.smoke] React unavailable, skipping:', error.message)
  }
}

/** 载入浏览器半边并取回它的 factory（模块只会执行一次，结果缓存）。 */
let factoryPromise = null
function loadFactory() {
  if (factoryPromise === null) {
    factoryPromise = (async () => {
      let captured = null
      globalThis.window = {
        __ModuleLoader__: {
          load(definition) { captured = definition },
        },
      }
      await import('../lib/client.js')
      assert.ok(captured, 'client bundle should call window.__ModuleLoader__.load')
      assert.equal(captured.id, 'dsh-plugin-essay-review')
      return captured.factory
    })()
  }
  return factoryPromise
}

/** 只提供 react 的模块表。 */
function fakeRequire(id) {
  if (id === 'react') return React
  throw new Error(`unexpected module request: ${id}`)
}

const skip = React === null ? 'set REACT_PATH to a package with react + react-dom' : false

test('apply 注册主面板与侧栏入口', { skip }, async () => {
  const factory = await loadFactory()
  const exports = factory(fakeRequire)
  const registrations = []
  globalThis.document = {
    createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
    head: { appendChild() {} },
  }
  const ctx = {
    effect(callback) { callback(); return () => {} },
    locale: { register() { return () => {} }, bind() { return (key) => key } },
    slots: {
      inject(slot, callback) { callback() },
      register(options, component) {
        registrations.push({ slot: options.name, options, component })
        return () => {}
      },
    },
  }
  exports.apply(ctx)
  assert.deepEqual(registrations.map((item) => item.slot).sort(), ['main', 'sidebar.panellist'])
  const sidebar = registrations.find((item) => item.slot === 'sidebar.panellist')
  assert.equal(sidebar.options.id, 'essay-review')
  assert.equal(typeof sidebar.component, 'function')
})

test('空状态面板可以渲染', { skip }, async () => {
  const factory = await loadFactory()
  const exports = factory(fakeRequire)
  const html = renderToStaticMarkup(React.createElement(exports.EssayReviewPanel, {}))
  assert.match(html, /作文片段评测|Essay Fragment Review/)
  assert.match(html, /er-root/)
  assert.match(html, /er-drop/)
})

test('结果视图渲染分数、维度与建议', { skip }, async () => {
  const factory = await loadFactory()
  const exports = factory(fakeRequire)
  const review = {
    id: 'er-test-1',
    createdAt: Date.now(),
    mode: 'image',
    grade: '初中',
    title: '那一刻，我长大了',
    hasImage: true,
    elapsedMs: 32000,
    model: { provider: 'deepseek-account', model: 'deepseek-flash', label: 'DeepSeek-V4.1-Flash' },
    result: {
      overall: 84,
      level: { key: 'good', label: '良好' },
      summary: '书写清楚，叙事完整。',
      transcription: '那天雨很大，我撑着伞站在校门口。',
      dimensions: [
        { key: 'handwriting', label: '字体工整', max: 20, score: 17, comment: '结构匀称', suggestions: ['横画再平一些'] },
        { key: 'content', label: '内容切题', max: 25, score: 21, comment: '细节具体', suggestions: [] },
      ],
      highlights: ['开头画面感强'],
      issues: [{ quote: '雨很大。', problem: '略显空泛', advice: '写成雨点砸在伞面上' }],
      rewrite: '雨点砸在伞面上，我站在校门口等妈妈。',
      nextSteps: ['每天改写一句空泛的句子'],
    },
  }
  const html = renderToStaticMarkup(React.createElement(exports.ResultView, {
    review,
    tr: (key) => key,
    onReuse() {},
    onDelete() {},
  }))
  assert.match(html, /84/)
  assert.match(html, /字体工整/)
  assert.match(html, /内容切题/)
  assert.match(html, /雨点砸在伞面上/)
  assert.match(html, /transcription/)
})
