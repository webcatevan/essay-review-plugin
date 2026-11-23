/**
 * 模型调用：解析路由、探测视觉能力、组装提示词、流式收文本、归一化结果。
 *
 * 模型走宿主的 ctx.llm，使用 Agent 默认模型；插件配置里也可以钉死
 * provider/model，便于专门给这个功能配一个视觉模型。
 */

import { buildSystemPrompt, buildUserPrompt, extractJson, normalizeResult } from './rubric.js'

/** 带 HTTP 状态与稳定 code 的失败，路由层直接翻译成响应。 */
export class EvalError extends Error {
  /**
   * @param {number} status - HTTP 状态码。
   * @param {string} code - 稳定错误码。
   * @param {string} message - 面向用户的中文说明。
   * @param {string} [raw] - 需要回显给界面的模型原文。
   */
  constructor(status, code, message, raw) {
    super(message)
    this.status = status
    this.code = code
    this.raw = raw
  }
}

/** 解析实际使用的模型路由：显式配置优先，否则跟随 Agent 默认模型。 */
export function resolveRoute(ctx, settings) {
  const hasProvider = settings.provider !== undefined
  const hasModel = settings.model !== undefined
  if (hasProvider !== hasModel) {
    throw new EvalError(503, 'model/misconfigured', 'provider 与 model 必须同时配置')
  }
  if (hasProvider) return { provider: settings.provider, model: settings.model }
  const selection = ctx.get?.('agentDefaultModel')?.currentSelection?.()
  if (selection === undefined || selection === null
    || typeof selection.provider !== 'string' || typeof selection.model !== 'string') {
    throw new EvalError(503, 'model/unconfigured', '没有可用的默认模型，请先在设置里选择模型')
  }
  return { provider: selection.provider, model: selection.model }
}

/**
 * 解析一次模型调用，同时拿到该模型是否支持图片输入。
 * @param {object} ctx - 宿主 Context。
 * @param {object} settings - 插件设置。
 * @param {AbortSignal} signal - 取消与超时信号。
 */
export async function prepareCall(ctx, settings, signal) {
  const route = resolveRoute(ctx, settings)
  let supportsImage = false
  let label = route.model
  let call
  try {
    call = await ctx.llm.prepareCall({ provider: route.provider, model: route.model, maxTokens: settings.maxOutputTokens }, signal, (controls, model) => {
      supportsImage = model?.inputModalities?.includes('image') === true
      if (typeof model?.name === 'string' && model.name.trim() !== '') label = model.name
      const effort = settings.reasoningEffort ?? model?.reasoning?.efforts?.[0]?.id
      return effort === undefined ? controls : { ...controls, reasoningEffort: effort }
    })
  } catch (error) {
    if (signal.aborted) throw new EvalError(499, 'model/cancelled', '评测已取消或超时')
    throw new EvalError(503, 'model/unavailable', error instanceof Error ? error.message : String(error))
  }
  return { route, call, supportsImage, label }
}

/** 一次模型调用能接受的最长文本，防止超长粘贴把上下文打满。 */
const MAX_PROMPT_CHARS = 20000

/**
 * 执行一次评测。
 * @param {object} ctx - 宿主 Context。
 * @param {object} settings - 插件设置。
 * @param {{ mode: 'image'|'text', imageRef?: unknown, grade: string, title: string, requirements: string, focus: string[], text: string }} input
 * @returns {Promise<{ result: object, model: { provider: string, model: string, label: string }, transcription: string }>}
 */
export async function runEvaluation(ctx, settings, input, externalSignal) {
  const timeoutController = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    timeoutController.abort()
  }, settings.timeoutMs)
  const signal = externalSignal === undefined
    ? timeoutController.signal
    : AbortSignal.any([externalSignal, timeoutController.signal])
  /** 取消与超时共用一套说明；超时给出可操作的建议。 */
  const abortFailure = () => (timedOut
    ? new EvalError(504, 'model/timeout', `模型在 ${Math.round(settings.timeoutMs / 1000)} 秒内没有完成，请重试或缩短片段`)
    : new EvalError(499, 'model/cancelled', '评测已取消'))
  try {
    const prepared = await prepareCall(ctx, settings, signal)
    if (input.mode === 'image' && prepared.supportsImage !== true) {
      throw new EvalError(
        415,
        'model/no-vision',
        `当前模型「${prepared.label}」不支持图片输入，无法判断字体工整与卷面。请切换到文字模式，或在设置里换用支持图片的模型。`,
      )
    }
    const promptText = input.mode === 'text' ? String(input.text ?? '') : ''
    if (promptText.length > MAX_PROMPT_CHARS) {
      throw new EvalError(413, 'text/too-long', `文字片段超过 ${MAX_PROMPT_CHARS} 字，请分段评测`)
    }
    const system = buildSystemPrompt(input.mode)
    const user = buildUserPrompt({ ...input, text: promptText })
    /** @type {Array<Record<string, unknown>>} */
    const content = [{ type: 'text', text: user }]
    if (input.mode === 'image' && input.imageRef !== undefined) {
      content.push({ type: 'image', attachment: input.imageRef })
    }

    let text = ''
    let failureReason
    try {
      for await (const chunk of prepared.call.stream({
        ...prepared.call.config,
        system,
        messages: [{ role: 'user', content }],
        signal,
        purpose: 'essay-review',
      })) {
        if (chunk.type === 'text-delta') text += chunk.text
        else if (chunk.type === 'finish' && chunk.reason?.kind !== 'stop') failureReason = chunk.reason
      }
    } catch (error) {
      if (signal.aborted) throw abortFailure()
      throw new EvalError(502, 'model/failed', error instanceof Error ? error.message : String(error))
    }
    if (failureReason !== undefined) {
      if (failureReason.kind === 'aborted') throw abortFailure()
      const failure = failureReason.failure
      const reason = typeof failure?.message === 'string' && failure.message !== '' ? failure.message : '模型调用失败'
      const code = typeof failure?.code === 'string' && failure.code !== '' ? `[${failure.code}] ` : ''
      throw new EvalError(502, 'model/failed', `${code}${reason}`)
    }
    const answer = text.trim()
    if (answer === '') throw new EvalError(502, 'model/empty', '模型没有返回内容，请重试')

    const raw = extractJson(answer)
    if (raw === undefined) {
      throw new EvalError(502, 'model/format', '模型返回的不是可解析的 JSON，可以重试一次', answer.slice(0, 3000))
    }
    let result
    try {
      result = normalizeResult(raw, input.mode)
    } catch (error) {
      const code = error?.code === 'MODEL_FORMAT' ? 'model/format' : 'model/failed'
      throw new EvalError(502, code, error instanceof Error ? error.message : '模型输出无法解析', answer.slice(0, 3000))
    }
    return {
      result,
      model: { provider: prepared.route.provider, model: prepared.route.model, label: prepared.label },
    }
  } finally {
    clearTimeout(timer)
  }
}

/** 模型能力探测结果缓存（毫秒）。 */
const PROBE_TTL_MS = 60_000
/** @type {Map<string, { at: number, value: object }>} */
const probeCache = new Map()

/**
 * 探测当前路由的模型名称与是否支持图片，供界面提示。
 * @returns {Promise<{ provider: string, model: string, label: string, vision: boolean }>}
 */
export async function probeModel(ctx, settings) {
  const key = `${settings.provider ?? ''}/${settings.model ?? ''}`
  const cached = probeCache.get(key)
  if (cached !== undefined && Date.now() - cached.at < PROBE_TTL_MS) return cached.value
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const prepared = await prepareCall(ctx, settings, controller.signal)
    const value = {
      provider: prepared.route.provider,
      model: prepared.route.model,
      label: prepared.label,
      vision: prepared.supportsImage,
    }
    probeCache.set(key, { at: Date.now(), value })
    return value
  } finally {
    clearTimeout(timer)
  }
}
