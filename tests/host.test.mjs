/**
 * 宿主半边的冒烟测试：不启动 DSH，用假的 Cordis Context 驱动插件。
 *
 * 覆盖：路由注册、文字评测、图片评测、历史、删除、模型无视觉时的报错、
 * 模型输出格式异常的报错，以及 Agent 工具。
 */

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { apply } from '../lib/index.js'

/** 1×1 透明 PNG，用来模拟浏览器上传的手写照片。 */
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

/** 一份合法的模型输出。 */
function fixture(mode = 'text') {
  const scores = mode === 'image'
    ? { handwriting: 16, neatness: 8, language: 12, vocabulary: 8, punctuation: 4, structure: 12, content: 20 }
    : { language: 16, vocabulary: 11, punctuation: 8, structure: 15, content: 15, expression: 11 }
  return {
    transcription: mode === 'image' ? '今天天气很好。妈妈带我去公园玩。' : '',
    dimensions: Object.entries(scores).map(([key, score]) => ({
      key,
      score,
      comment: `${key} 的具体评价`,
      suggestions: ['把这句话写具体'],
    })),
    highlights: ['开头点题'],
    issues: [{ quote: '很好。', problem: '太空泛', advice: '补一个具体细节' }],
    rewrite: '今天阳光很好，妈妈带我去公园，柳枝在风里轻轻摆。',
    nextSteps: ['每天改写一句空泛的句子', '朗读自己的片段并圈出拗口处'],
    summary: '整体通顺，细节还可以更具体。',
  }
}

/** 可编程的假模型：默认返回 fixture，也可被测试改成失败或纯文本模式。 */
function makeModel() {
  const state = { mode: 'text', vision: true, output: () => JSON.stringify(fixture(state.mode)), fail: null }
  const llm = {
    async prepareCall(_route, signal, prepare) {
      if (state.fail === 'prepare') throw new Error('model route unavailable')
      const model = { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', inputModalities: state.vision ? ['text', 'image'] : ['text'] }
      const config = prepare === undefined ? {} : prepare({}, model)
      return {
        config,
        stream: (options) => {
          state.lastOptions = options
          return (async function* () {
            if (state.fail === 'stream') throw new Error('connection reset')
            yield { type: 'text-delta', text: state.output() }
            yield { type: 'finish', reason: { kind: 'stop' } }
          })()
        },
      }
    },
  }
  return { state, llm }
}

/** 记录注册行为的假 Context。 */
function makeContext() {
  const routes = new Map()
  const tools = new Map()
  const skills = []
  const effects = []
  const ctx = {
    routes,
    toolMap: tools,
    skillList: skills,
    effects,
    async effect(callback) {
      const dispose = callback()
      effects.push(dispose)
      return dispose
    },
    get(name) {
      if (name === 'agentDefaultModel') {
        return { currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }) }
      }
      return undefined
    },
    provide(name, value) {
      ctx[name] = value
      return () => {}
    },
    connection: {
      fetch: {
        register(definition) {
          routes.set(definition.path, definition)
          return () => {}
        },
      },
    },
    tools: {
      register(tool) {
        tools.set(tool.name, tool)
        return () => {}
      },
    },
    skills: {
      register(skill) {
        skills.push(skill)
        return () => {}
      },
    },
    attachments: {
      async saveImage(input) {
        return { attachmentId: 'sha256:fixture', mediaType: input.mediaType, name: input.name }
      },
    },
  }
  return ctx
}

/** 调用一条已注册的路由。 */
async function callRoute(ctx, path, method, body, query = '') {
  const definition = ctx.routes.get(path)
  assert.ok(definition, `route ${path} should be registered`)
  assert.ok(definition.methods.includes(method), `route ${path} should accept ${method}`)
  const request = new Request(`http://localhost${path}${query}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const response = await definition.fetch(request)
  const isJson = (response.headers.get('content-type') ?? '').includes('application/json')
  return { status: response.status, body: isJson ? await response.json() : await response.arrayBuffer(), response }
}

let root
let ctx
let model

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'essay-review-test-'))
  ctx = makeContext()
  model = makeModel()
  ctx.llm = model.llm
  await apply(ctx, { dataDir: root })
})

after(async () => {
  await rm(root, { recursive: true, force: true })
})

test('注册了 6 条路由、5 个工具、1 个技能', () => {
  assert.equal(ctx.routes.size, 6)
  assert.deepEqual([...ctx.toolMap.keys()].sort(), [
    'essay_review__delete_review',
    'essay_review__evaluate_image',
    'essay_review__evaluate_text',
    'essay_review__get_review',
    'essay_review__list_reviews',
  ])
  assert.equal(ctx.skillList.length, 1)
  assert.equal(ctx.skillList[0].name, 'essay-review')
})

test('config 路由返回维度表与模型能力', async () => {
  const { status, body } = await callRoute(ctx, '/api/essay-review/config', 'GET')
  assert.equal(status, 200)
  assert.equal(body.vision, true)
  assert.equal(body.model.label, 'DeepSeek-V4.1-Flash')
  assert.equal(body.rubrics.image.reduce((sum, item) => sum + item.max, 0), 100)
  assert.equal(body.rubrics.text.reduce((sum, item) => sum + item.max, 0), 100)
})

test('文字评测：返回规范化结果并写入历史', async () => {
  model.state.mode = 'text'
  const { status, body } = await callRoute(ctx, '/api/essay-review/evaluate', 'POST', {
    mode: 'text',
    text: '今天阳光很好。妈妈带我去公园玩。',
    grade: '初中',
    title: '公园',
    focus: ['language', 'content'],
  })
  assert.equal(status, 200)
  const review = body.review
  assert.equal(review.mode, 'text')
  assert.equal(review.result.overall, 76)
  assert.equal(review.result.level.label, '中等')
  assert.equal(review.result.dimensions.length, 6)
  assert.equal(review.result.transcription, '')
  assert.equal(review.hasImage, false)
  assert.equal(review.title, '公园')
  assert.deepEqual(review.focus, ['language', 'content'])

  const list = await callRoute(ctx, '/api/essay-review/reviews', 'GET')
  assert.equal(list.status, 200)
  assert.equal(list.body.reviews.length, 1)
  assert.equal(list.body.reviews[0].overall, 76)
  assert.equal(list.body.reviews[0].hasImage, false)

  const single = await callRoute(ctx, '/api/essay-review/review', 'GET', undefined, `?id=${review.id}`)
  assert.equal(single.status, 200)
  assert.equal(single.body.review.id, review.id)
})

test('图片评测：保存原图并通过图片路由读回', async () => {
  model.state.mode = 'image'
  const { status, body } = await callRoute(ctx, '/api/essay-review/evaluate', 'POST', {
    mode: 'image',
    image: { data: PNG_BASE64, mediaType: 'image/png' },
    grade: '小学高年级',
  })
  assert.equal(status, 200)
  const review = body.review
  assert.equal(review.mode, 'image')
  assert.equal(review.hasImage, true)
  assert.equal(review.result.transcription, '今天天气很好。妈妈带我去公园玩。')
  assert.equal(review.result.dimensions.length, 7)
  assert.equal(review.result.dimensions[0].key, 'handwriting')
  assert.equal(review.result.overall, 80)

  const image = await callRoute(ctx, '/api/essay-review/image', 'GET', undefined, `?id=${review.id}`)
  assert.equal(image.status, 200)
  assert.equal(image.response.headers.get('content-type'), 'image/png')
  assert.ok(image.body.byteLength > 0)
})

test('模型不支持图片时明确拒绝，而不是静默降级', async () => {
  model.state.vision = false
  const { status, body } = await callRoute(ctx, '/api/essay-review/evaluate', 'POST', {
    mode: 'image',
    image: { data: PNG_BASE64, mediaType: 'image/png' },
  })
  assert.equal(status, 415)
  assert.equal(body.error.code, 'model/no-vision')
  assert.match(body.error.message, /不支持图片/)
  model.state.vision = true
})

test('模型输出不是 JSON 时返回 model/format 并附原文', async () => {
  model.state.mode = 'text'
  model.state.output = () => '抱歉，我无法完成这个任务。'
  const { status, body } = await callRoute(ctx, '/api/essay-review/evaluate', 'POST', { mode: 'text', text: '测试片段' })
  assert.equal(status, 502)
  assert.equal(body.error.code, 'model/format')
  assert.match(body.error.raw, /抱歉/)
  model.state.output = () => JSON.stringify(fixture('text'))
})

test('图片缺失、空文字与非法 mode 都给出 4xx', async () => {
  assert.equal((await callRoute(ctx, '/api/essay-review/evaluate', 'POST', { mode: 'image' })).status, 400)
  assert.equal((await callRoute(ctx, '/api/essay-review/evaluate', 'POST', { mode: 'text', text: '  ' })).status, 400)
  assert.equal((await callRoute(ctx, '/api/essay-review/evaluate', 'POST', { mode: 'audio' })).status, 400)
  assert.equal((await callRoute(ctx, '/api/essay-review/evaluate', 'POST', {
    mode: 'image',
    image: { data: PNG_BASE64, mediaType: 'image/gif' },
  })).status, 415)
})

test('工具能评测、列出、读取并删除', async () => {
  const textTool = ctx.toolMap.get('essay_review__evaluate_text')
  const created = await textTool.execute({ text: '春天的风很温柔，吹得柳枝摇来摇去。', grade: '初中' })
  assert.ok(created.id)
  assert.equal(created.mode, 'text')
  assert.equal(typeof created.result.overall, 'number')

  const listed = await ctx.toolMap.get('essay_review__list_reviews').execute({})
  assert.ok(listed.length >= 1)

  const fetched = await ctx.toolMap.get('essay_review__get_review').execute({ id: created.id })
  assert.equal(fetched.id, created.id)

  await ctx.toolMap.get('essay_review__delete_review').execute({ id: created.id })
  await assert.rejects(() => ctx.toolMap.get('essay_review__get_review').execute({ id: created.id }))
})

test('删除记录同时删除图片并更新历史', async () => {
  const list = await callRoute(ctx, '/api/essay-review/reviews', 'GET')
  const withImage = list.body.reviews.find((item) => item.hasImage)
  assert.ok(withImage, 'should have an image review left')
  const removed = await callRoute(ctx, '/api/essay-review/delete', 'POST', { id: withImage.id })
  assert.equal(removed.status, 200)
  const missing = await callRoute(ctx, '/api/essay-review/image', 'GET', undefined, `?id=${withImage.id}`)
  assert.equal(missing.status, 404)
})
