#!/usr/bin/env node
/**
 * 浏览器端到端验证（本地开发用）。
 *
 * 通过 Chrome DevTools Protocol 驱动正在运行的 DSH 桌面窗口：
 * 打开「作文评测」面板 → 选择一张图 → 点击开始评测 → 等结果 → 截图。
 *
 * 用法：
 *   node tools/browser-e2e.mjs [图片路径] [截图路径]
 * 前置：应用以 --remote-debugging-port=9222 启动，插件已经通过 HMR 生效。
 */

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const port = process.env.CDP_PORT ?? '9222'
const imagePath = resolve(process.argv[2] ?? 'assets/sample-essay.png')
const shotPath = resolve(process.argv[3] ?? 'assets/panel-result.png')
const previewShotPath = resolve(process.argv[4] ?? 'assets/panel-preview.png')

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = targets.find((target) => target.type === 'page' && (target.url.startsWith('dsh-app://') || target.url.startsWith('http://127.0.0.1')))
if (page === undefined) {
  console.error('no DSH page target')
  process.exit(1)
}

const socket = new WebSocket(page.webSocketDebuggerUrl)
let nextId = 1
const pending = new Map()

/** 发一条 CDP 命令。 */
function send(method, params = {}) {
  const id = nextId++
  return new Promise((resolvePromise, rejectPromise) => {
    pending.set(id, { resolve: resolvePromise, reject: rejectPromise })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id === undefined) return
  const entry = pending.get(message.id)
  if (entry === undefined) return
  pending.delete(message.id)
  if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
  else entry.resolve(message.result)
})
await new Promise((resolvePromise, rejectPromise) => {
  socket.addEventListener('open', resolvePromise, { once: true })
  socket.addEventListener('error', rejectPromise, { once: true })
})

/** 在页面里求值，返回 JSON 可序列化的值。 */
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'evaluate failed')
  return result.result.value
}

/** 等一个条件成立。 */
async function waitFor(label, expression, timeoutMs = 120_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const value = await evaluate(expression)
    if (value) return value
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 800))
  }
  throw new Error(`timeout waiting for ${label}`)
}

await send('Runtime.enable')
await send('Page.enable')
await send('DOM.enable')

// 1. 打开面板
const opened = await evaluate(`(() => {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === '作文评测')
  if (button === undefined) return 'missing-entry'
  button.click()
  return 'clicked'
})()`)
if (opened !== 'clicked') throw new Error(`sidebar entry not found: ${opened}`)
await waitFor('panel root', `!!document.querySelector('.er-root')`, 15_000)
console.log('panel opened')

// 2. 选择图片（隐藏的 file input）
const documentNode = await send('DOM.getDocument', { depth: 2 })
const inputNode = await send('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector: 'input.er-file' })
if (!inputNode.nodeId) throw new Error('file input not found')
await send('DOM.setFileInputFiles', { nodeId: inputNode.nodeId, files: [imagePath] })
await waitFor('image preview', `!!document.querySelector('.er-preview img')`, 20_000)
console.log('image attached')

const previewShot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(previewShotPath, Buffer.from(previewShot.data, 'base64'))
console.log('preview screenshot:', previewShotPath)

// 3. 开始评测
const clicked = await evaluate(`(() => {
  const button = [...document.querySelectorAll('.er-submit button')].find((item) => /开始评测|Review/.test(item.textContent))
  if (button === undefined) return false
  button.click()
  return true
})()`)
if (!clicked) throw new Error('submit button not found')
console.log('evaluation started')

// 4. 等结果或错误
const outcome = await waitFor('result or error', `(() => {
  if (document.querySelector('.er-result')) return { state: 'done' }
  const error = document.querySelector('.er-error')
  if (error) return { state: 'error', text: error.innerText }
  return null
})()`, 240_000)
if (outcome.state === 'error') throw new Error(`evaluation failed: ${outcome.text}`)
await new Promise((resolvePromise) => setTimeout(resolvePromise, 400))
console.log('evaluation done')

const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(shotPath, Buffer.from(shot.data, 'base64'))
console.log('result screenshot:', shotPath)

const summary = await evaluate(`(() => {
  const root = document.querySelector('.er-result')
  return {
    score: root?.querySelector('.er-ring-inner strong')?.textContent,
    level: root?.querySelector('.er-level')?.textContent,
    dims: [...root?.querySelectorAll('.er-dim-head strong') ?? []].map((item) => item.textContent),
  }
})()`)
console.log(JSON.stringify(summary))

socket.close()
