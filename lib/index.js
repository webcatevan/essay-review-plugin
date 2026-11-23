/**
 * 作文片段评测插件的宿主半边。
 *
 * 提供：
 * - `/api/essay-review/*`：界面用的评测、历史、图片路由；
 * - `essay_review__*` 工具：让 Agent 也能直接评测文字或本地图片；
 * - 一份随包附带的 SKILL.md，说明什么时候该用这些工具。
 *
 * 评测走宿主的 ctx.llm（默认跟随 Agent 默认模型）。手写照片需要模型
 * 支持图片输入；不支持时给出明确提示，而不是退化成纯文字评分。
 *
 * @module dsh-plugin-essay-review
 */

import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EvalError, probeModel, runEvaluation } from './evaluate.js'
import { GRADES, RUBRICS } from './rubric.js'
import { makeReviewId, ReviewStore } from './storage.js'
import { defineJsonTool } from './tool-def.js'

/** Cordis 插件名。 */
export const name = 'ui-essay-review'

/** 需要的宿主服务。 */
export const inject = ['attachments', 'connection', 'llm', 'tools', 'skills']

const DEFAULT_MAX_OUTPUT_TOKENS = 4096
const DEFAULT_TIMEOUT_MS = 240_000
const DEFAULT_MAX_IMAGE_BYTES = 12 * 1024 * 1024
const DEFAULT_MAX_TEXT_CHARS = 20_000

/** 允许的图片类型与落盘扩展名。 */
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

/** 读取并夹取配置。 */
function resolveSettings(config) {
  const raw = config !== null && typeof config === 'object' ? config : {}
  return {
    provider: nonEmpty(raw.provider),
    model: nonEmpty(raw.model),
    reasoningEffort: nonEmpty(raw.reasoningEffort),
    dataDir: nonEmpty(raw.dataDir),
    maxOutputTokens: integer(raw.maxOutputTokens, DEFAULT_MAX_OUTPUT_TOKENS, 256, 32_768),
    timeoutMs: integer(raw.timeoutMs, DEFAULT_TIMEOUT_MS, 10_000, 600_000),
    maxImageBytes: integer(raw.maxImageBytes, DEFAULT_MAX_IMAGE_BYTES, 64 * 1024, 32 * 1024 * 1024),
    maxTextChars: integer(raw.maxTextChars, DEFAULT_MAX_TEXT_CHARS, 500, 100_000),
  }
}

/** 非空字符串，否则 undefined。 */
function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** 有界整数。 */
function integer(value, fallback, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** JSON 响应。 */
function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** 统一失败响应。 */
function failure(status, code, message, raw) {
  const error = { code, message }
  if (typeof raw === 'string' && raw !== '') error.raw = raw
  return json({ error }, status)
}

/** 把任意错误翻译成响应；未知错误不泄漏堆栈。 */
function errorResponse(error) {
  if (error instanceof EvalError) return failure(error.status, error.code, error.message, error.raw)
  if (error !== null && typeof error === 'object' && error.code === 'NOT_FOUND') {
    return failure(404, 'review/not-found', error.message)
  }
  console.error('[essay-review]', error)
  return failure(500, 'internal', error instanceof Error ? error.message : String(error))
}

/** 读取 JSON 请求体。 */
async function readJson(request) {
  const text = await request.text()
  if (text.trim() === '') return {}
  try {
    const parsed = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    throw new EvalError(400, 'request/invalid-json', '请求体不是合法 JSON')
  }
}

/** 解析学段：只接受列表内的值，缺省为初中。 */
function gradeOf(value) {
  return typeof value === 'string' && GRADES.includes(value) ? value : '初中'
}

/** 解析标题与要求，限长。 */
function textField(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

/** 只保留当前模式存在的维度 key。 */
function focusOf(value, mode) {
  if (!Array.isArray(value)) return []
  const allowed = new Set(RUBRICS[mode].map((dimension) => dimension.key))
  return [...new Set(value.filter((key) => typeof key === 'string' && allowed.has(key)))].slice(0, 4)
}

/** 解码浏览器上传的 base64 图片。 */
function decodeImage(value, settings) {
  if (value === null || typeof value !== 'object') {
    throw new EvalError(400, 'image/missing', '请选择一张手写照片')
  }
  const mediaType = value.mediaType
  if (typeof mediaType !== 'string' || !(mediaType in IMAGE_TYPES)) {
    throw new EvalError(415, 'image/type', '仅支持 JPG、PNG、WebP 图片')
  }
  const encoded = typeof value.data === 'string' ? value.data.replace(/^data:[^;]+;base64,/, '') : ''
  if (encoded === '') throw new EvalError(400, 'image/empty', '图片内容为空')
  if (encoded.length > Math.ceil((settings.maxImageBytes * 4) / 3) + 16) {
    throw new EvalError(413, 'image/too-large', `图片超过 ${Math.round(settings.maxImageBytes / 1024 / 1024)} MB`)
  }
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.byteLength === 0) throw new EvalError(400, 'image/invalid', '图片无法解码')
  if (bytes.byteLength > settings.maxImageBytes) {
    throw new EvalError(413, 'image/too-large', `图片超过 ${Math.round(settings.maxImageBytes / 1024 / 1024)} MB`)
  }
  return { bytes, mediaType, extension: IMAGE_TYPES[mediaType] }
}

/** 把图片存进附件服务，得到模型可引用的 attachment。 */
async function saveAttachment(ctx, image) {
  try {
    return await ctx.attachments.saveImage({
      data: new Uint8Array(image.bytes),
      mediaType: image.mediaType,
      name: `essay-fragment.${image.extension}`,
    })
  } catch (error) {
    throw new EvalError(413, 'image/refused', `图片无法保存：${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 评测并保存一条记录。
 * @param {object} ctx - 宿主 Context。
 * @param {ReviewStore} store - 存储。
 * @param {object} settings - 插件设置。
 * @param {{ mode: 'image'|'text', text: string, image?: { bytes: Uint8Array, mediaType: string, extension: string }, imageRef?: unknown, grade: string, title: string, requirements: string, focus: string[] }} input
 * @param {AbortSignal} [signal] - 调用方取消信号。
 */
async function evaluateAndStore(ctx, store, settings, input, signal) {
  const started = Date.now()
  const { result, model } = await runEvaluation(ctx, settings, input, signal)
  const id = makeReviewId()
  let imageName
  if (input.mode === 'image' && input.image !== undefined) {
    imageName = await store.saveImage(id, input.image.bytes, input.image.extension)
  }
  const review = {
    id,
    createdAt: Date.now(),
    mode: input.mode,
    grade: input.grade,
    title: input.title,
    requirements: input.requirements,
    focus: input.focus,
    text: input.mode === 'text' ? input.text : result.transcription,
    image: imageName ?? null,
    hasImage: imageName !== undefined,
    result,
    model,
    elapsedMs: Date.now() - started,
  }
  try {
    await store.save(review)
  } catch (error) {
    if (imageName !== undefined) await store.removeFiles(id)
    throw error
  }
  return review
}

/**
 * 诊断路由：报告 client-modules 当前是否已经收录本插件的浏览器半边。
 * 桌面端在宿主启动时缓存 boot injections，新装的客户端插件要等应用重启；
 * 这条路由用来区分「宿主没收录」和「页面还没重新加载」。
 */
function registerClientStatus(ctx) {
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['clientModules'], (sub) => {
    sub.effect(() => sub.connection.fetch.register({
      path: '/api/essay-review/client-status',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: () => {
        const registry = sub.clientModules
        const graph = registry.graph()
        return json({
          entries: graph.entries.map((entry) => entry.id),
          clientPath: registry.clientPath('dsh-plugin-essay-review') ?? null,
          rev: graph.rev,
        })
      },
    }), 'essay-review: client status')
  })
}

/** 注册浏览器使用的路由。 */
function registerRoutes(ctx, store, settings) {
  const configRoute = async () => {
    let model
    let vision = false
    let warning
    try {
      const probed = await probeModel(ctx, settings)
      model = { provider: probed.provider, model: probed.model, label: probed.label }
      vision = probed.vision
    } catch (error) {
      warning = error instanceof EvalError ? error.message : String(error)
    }
    return json({
      model,
      vision,
      warning,
      grades: GRADES,
      rubrics: RUBRICS,
      limits: { maxImageBytes: settings.maxImageBytes, maxTextChars: settings.maxTextChars, timeoutMs: settings.timeoutMs },
    })
  }

  const evaluate = async (request) => {
    try {
      const body = await readJson(request)
      const mode = body.mode === 'image' ? 'image' : body.mode === 'text' ? 'text' : undefined
      if (mode === undefined) throw new EvalError(400, 'request/mode', 'mode 必须是 image 或 text')
      const text = typeof body.text === 'string' ? body.text : ''
      if (mode === 'text' && text.trim() === '') throw new EvalError(400, 'text/empty', '请先粘贴要评测的文字')
      if (mode === 'text' && text.length > settings.maxTextChars) {
        throw new EvalError(413, 'text/too-long', `文字片段超过 ${settings.maxTextChars} 字，请删减后再试`)
      }
      let image
      let imageRef
      if (mode === 'image') {
        image = decodeImage(body.image, settings)
        imageRef = await saveAttachment(ctx, image)
      }
      const review = await evaluateAndStore(ctx, store, settings, {
        mode,
        text,
        image,
        imageRef,
        grade: gradeOf(body.grade),
        title: textField(body.title, 120),
        requirements: textField(body.requirements, 500),
        focus: focusOf(body.focus, mode),
      }, request.signal)
      return json({ review })
    } catch (error) {
      return errorResponse(error)
    }
  }

  const listReviews = async (request) => {
    try {
      const query = new URL(request.url).searchParams.get('q') ?? ''
      return json({ reviews: await store.list(query) })
    } catch (error) {
      return errorResponse(error)
    }
  }

  const getReview = async (request) => {
    try {
      const id = new URL(request.url).searchParams.get('id') ?? ''
      if (id === '') throw new EvalError(400, 'review/id-missing', '缺少记录 id')
      return json({ review: await store.get(id) })
    } catch (error) {
      return errorResponse(error)
    }
  }

  const deleteReview = async (request) => {
    try {
      const body = await readJson(request)
      const id = typeof body.id === 'string' ? body.id : ''
      if (id === '') throw new EvalError(400, 'review/id-missing', '缺少记录 id')
      return json({ ok: true, ...(await store.remove(id)) })
    } catch (error) {
      return errorResponse(error)
    }
  }

  const image = async (request) => {
    try {
      const id = new URL(request.url).searchParams.get('id') ?? ''
      if (id === '') throw new EvalError(400, 'review/id-missing', '缺少记录 id')
      const review = await store.get(id)
      if (review.hasImage !== true || typeof review.image !== 'string') {
        throw new EvalError(404, 'review/no-image', '这条记录没有图片')
      }
      const stored = await store.readImage(review.image)
      return new Response(stored.bytes, {
        headers: {
          'content-type': stored.mediaType,
          'content-length': String(stored.bytes.byteLength),
          'cache-control': 'private, max-age=31536000, immutable',
        },
      })
    } catch (error) {
      return errorResponse(error)
    }
  }

  const routes = [
    ['/api/essay-review/config', ['GET'], configRoute],
    ['/api/essay-review/evaluate', ['POST'], evaluate],
    ['/api/essay-review/reviews', ['GET'], listReviews],
    ['/api/essay-review/review', ['GET'], getReview],
    ['/api/essay-review/delete', ['POST'], deleteReview],
    ['/api/essay-review/image', ['GET', 'HEAD'], image],
  ]
  for (const [path, methods, fetch] of routes) {
    ctx.effect(
      () => ctx.connection.fetch.register({ path, methods, requestBody: 'buffered', fetch }),
      `essay-review: ${path}`,
    )
  }
}

/** 把 EvalError 转成工具可读的错误。 */
function toolFailure(error) {
  if (error instanceof EvalError) {
    const suffix = error.raw === undefined ? '' : `\n\n模型原文：\n${error.raw}`
    throw new Error(`${error.message}（${error.code}）${suffix}`)
  }
  throw error
}

/** 注册 Agent 工具。 */
function registerTools(ctx, store, settings) {
  const tool = (spec) => {
    ctx.effect(() => ctx.tools.register(defineJsonTool(spec)), `essay-review: tool ${spec.name}`)
  }

  const common = {
    grade: { type: 'string', description: `学段，取值：${GRADES.join('、')}` },
    title: { type: 'string', description: '作文题目' },
    requirements: { type: 'string', description: '写作要求或评分标准' },
    focus: {
      type: 'array',
      items: { type: 'string' },
      description: '本次重点关注的维度 key，例如 handwriting、language、content；留空表示全部',
    },
  }

  tool({
    name: 'essay_review__evaluate_text',
    description: '评测一段作文文字：按语句通顺、用词、标点、结构、内容、表达等维度评分，并给出修改建议与升格示范。',
    parameters: {
      text: { type: 'string', required: true, description: '作文片段原文' },
      ...common,
    },
    async execute(args) {
      const mode = 'text'
      const text = typeof args.text === 'string' ? args.text : ''
      if (text.trim() === '') throw new Error('text 不能为空')
      if (text.length > settings.maxTextChars) throw new Error(`文字片段超过 ${settings.maxTextChars} 字`)
      try {
        return await evaluateAndStore(ctx, store, settings, {
          mode,
          text,
          grade: gradeOf(args.grade),
          title: textField(args.title, 120),
          requirements: textField(args.requirements, 500),
          focus: focusOf(args.focus, mode),
        })
      } catch (error) {
        toolFailure(error)
      }
    },
  })

  tool({
    name: 'essay_review__evaluate_image',
    description: '评测一张手写作文照片：识别文字，并从字体工整、卷面整洁、语句、内容等方面评分，给出修改建议。需要当前模型支持图片输入。',
    parameters: {
      path: { type: 'string', required: true, description: '手写照片的绝对路径（JPG/PNG/WebP）' },
      ...common,
    },
    async execute(args) {
      const filePath = typeof args.path === 'string' ? args.path.trim() : ''
      if (!isAbsolute(filePath)) throw new Error('path 必须是绝对路径')
      const extension = extname(filePath).toLowerCase()
      const mediaType = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : ''
      if (mediaType === '') throw new Error('仅支持 JPG、PNG、WebP 图片')
      const bytes = await readFile(filePath)
      if (bytes.byteLength > settings.maxImageBytes) throw new Error(`图片超过 ${Math.round(settings.maxImageBytes / 1024 / 1024)} MB`)
      try {
        const imageRef = await saveAttachment(ctx, {
          bytes,
          mediaType,
          extension: IMAGE_TYPES[mediaType],
        })
        return await evaluateAndStore(ctx, store, settings, {
          mode: 'image',
          text: '',
          image: { bytes, mediaType, extension: IMAGE_TYPES[mediaType] },
          imageRef,
          grade: gradeOf(args.grade),
          title: textField(args.title, 120),
          requirements: textField(args.requirements, 500),
          focus: focusOf(args.focus, 'image'),
        })
      } catch (error) {
        toolFailure(error)
      }
    },
  })

  tool({
    name: 'essay_review__list_reviews',
    description: '列出历史评测记录（新的在前），可按标题、内容或学段搜索。',
    parameters: { query: { type: 'string', description: '搜索关键词' } },
    async execute(args) {
      return await store.list(typeof args.query === 'string' ? args.query : '')
    },
  })

  tool({
    name: 'essay_review__get_review',
    description: '读取一条评测记录的完整评分与建议。',
    parameters: { id: { type: 'string', required: true } },
    async execute(args) {
      return await store.get(String(args.id))
    },
  })

  tool({
    name: 'essay_review__delete_review',
    description: '删除一条评测记录及其图片。',
    parameters: { id: { type: 'string', required: true } },
    async execute(args) {
      return await store.remove(String(args.id))
    },
  })
}

/** 注册随包的技能说明，让 Agent 知道何时使用这些工具。 */
function registerSkill(ctx) {
  const here = dirname(fileURLToPath(import.meta.url))
  const file = join(here, '..', 'skill', 'SKILL.md')
  let raw
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return
  }
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (frontmatter === null) return
  const fields = {}
  for (const line of frontmatter[1].split(/\r?\n/)) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line)
    if (match !== null) fields[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '')
  }
  if (fields.name === undefined || fields.description === undefined) return
  ctx.effect(() => ctx.skills.register({
    name: fields.name,
    description: fields.description,
    content: raw.slice(frontmatter[0].length).trim(),
    path: file,
    resourceBase: { kind: 'directory', path: dirname(file) },
  }), 'essay-review: skill')
}

/** 插件入口。 */
export async function apply(ctx, config) {
  const settings = resolveSettings(config)
  const dataDir = settings.dataDir ?? join(process.env.DSH_PROFILE_DIR ?? process.cwd(), 'essay-review-workshop')
  const store = new ReviewStore(dataDir)
  await store.init()
  // Cordis 的 Context 是代理：未注册的属性不能直接赋值，必须走 provide。
  if (typeof ctx.provide === 'function') ctx.provide('essayReviewStore', store)
  registerRoutes(ctx, store, settings)
  registerTools(ctx, store, settings)
  registerSkill(ctx)
  registerClientStatus(ctx)
}

