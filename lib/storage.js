/**
 * 评测记录存储：一个 JSON 索引 + 每次评测一个 JSON 文件 + 原图副本。
 *
 * 目录由宿主插件决定（默认 <profile>/essay-review-workshop），这样记录
 * 在应用重启后仍在，且不同 profile 互不干扰。
 */

import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** 单条索引项最大长度；超出时丢弃最旧的记录。 */
const MAX_REVIEWS = 200

/** 索引文件格式版本。 */
const INDEX_VERSION = 1

/** 生成一个按时间可排序的记录 id。 */
function newId() {
  const stamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 8)
  return `er-${stamp}-${random}`
}

/** 原子写：先写临时文件再改名，避免进程中断留下半个 JSON。 */
async function writeJsonAtomic(path, value) {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

/** 一批记录文件，读写都经过同一个 Promise 队列，避免索引互相覆盖。 */
export class ReviewStore {
  /**
   * @param {string} root - 存储根目录。
   */
  constructor(root) {
    this.root = root
    this.indexPath = join(root, 'index.json')
    this.reviewsDir = join(root, 'reviews')
    this.imagesDir = join(root, 'images')
    /** @type {Promise<unknown>} */
    this.queue = Promise.resolve()
    /** @type {Promise<void> | undefined} */
    this.initialized = undefined
  }

  /** 建目录（幂等）。 */
  async init() {
    if (this.initialized === undefined) {
      this.initialized = (async () => {
        await mkdir(this.reviewsDir, { recursive: true })
        await mkdir(this.imagesDir, { recursive: true })
      })()
    }
    await this.initialized
  }

  /** 串行执行一次索引读写的临界区。 */
  async exclusive(task) {
    const run = this.queue.then(task, task)
    this.queue = run.then(() => undefined, () => undefined)
    return await run
  }

  /** 读取索引；不存在或损坏时返回空索引。 */
  async readIndex() {
    await this.init()
    try {
      const parsed = JSON.parse(await readFile(this.indexPath, 'utf8'))
      if (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.reviews)) {
        return { version: INDEX_VERSION, reviews: parsed.reviews.filter((item) => item && typeof item.id === 'string') }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.warn('[essay-review] index unreadable, starting empty:', error)
      }
    }
    return { version: INDEX_VERSION, reviews: [] }
  }

  /**
   * 列出记录（新的在前）。
   * @param {string} [query] - 在标题、预览、学段里做不区分大小写的包含匹配。
   */
  async list(query = '') {
    const index = await this.readIndex()
    const needle = query.trim().toLowerCase()
    const rows = needle === ''
      ? index.reviews
      : index.reviews.filter((item) => [item.title, item.preview, item.grade, item.level?.label]
        .some((value) => typeof value === 'string' && value.toLowerCase().includes(needle)))
    return [...rows].sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
  }

  /** 读取一条完整记录。 */
  async get(id) {
    await this.init()
    const safe = String(id)
    if (!/^er-[a-z0-9-]+$/.test(safe)) throw notFound()
    try {
      const parsed = JSON.parse(await readFile(join(this.reviewsDir, `${safe}.json`), 'utf8'))
      if (parsed === null || typeof parsed !== 'object') throw notFound()
      return parsed
    } catch (error) {
      if (error?.code === 'NOT_FOUND') throw error
      throw notFound()
    }
  }

  /**
   * 保存一条记录并更新索引。
   * @param {object} review - 完整记录（含 id、createdAt）。
   */
  async save(review) {
    await this.init()
    return await this.exclusive(async () => {
      await writeJsonAtomic(join(this.reviewsDir, `${review.id}.json`), review)
      const index = await this.readIndex()
      const summary = {
        id: review.id,
        createdAt: review.createdAt,
        mode: review.mode,
        grade: review.grade,
        title: review.title,
        overall: review.result.overall,
        level: review.result.level,
        preview: review.result.summary || (review.text ?? '').slice(0, 80),
        hasImage: review.hasImage === true,
        model: review.model,
      }
      const reviews = [summary, ...index.reviews.filter((item) => item.id !== review.id)]
        .sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
      const dropped = reviews.splice(MAX_REVIEWS)
      await writeJsonAtomic(this.indexPath, { version: INDEX_VERSION, reviews })
      for (const item of dropped) await this.removeFiles(item.id)
      return summary
    })
  }

  /** 删除一条记录及其图片。 */
  async remove(id) {
    await this.init()
    return await this.exclusive(async () => {
      const index = await this.readIndex()
      const exists = index.reviews.some((item) => item.id === id)
      if (!exists) throw notFound()
      const reviews = index.reviews.filter((item) => item.id !== id)
      await writeJsonAtomic(this.indexPath, { version: INDEX_VERSION, reviews })
      await this.removeFiles(id)
      return { deleted: id }
    })
  }

  /** 删除记录正文与图片；图片扩展名未知时按目录前缀匹配。 */
  async removeFiles(id) {
    await unlink(join(this.reviewsDir, `${id}.json`)).catch(() => {})
    try {
      const files = await readdir(this.imagesDir)
      for (const name of files) {
        if (name.startsWith(`${id}.`)) await unlink(join(this.imagesDir, name)).catch(() => {})
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }

  /**
   * 保存一张原图副本。
   * @param {string} id - 记录 id。
   * @param {Uint8Array} bytes - 图片字节。
   * @param {'jpg'|'png'|'webp'} extension - 扩展名。
   * @returns {Promise<string>} 文件名。
   */
  async saveImage(id, bytes, extension) {
    await this.init()
    const name = `${id}.${extension}`
    await writeFile(join(this.imagesDir, name), bytes)
    return name
  }

  /**
   * 读取一张图片。
   * @param {string} name - 文件名（来自记录，只允许安全字符）。
   * @returns {Promise<{ bytes: Uint8Array, mediaType: string }>}
   */
  async readImage(name) {
    await this.init()
    if (typeof name !== 'string' || !/^er-[a-z0-9-]+\.(?:jpg|png|webp)$/.test(name)) throw notFound()
    try {
      const bytes = await readFile(join(this.imagesDir, name))
      const extension = name.split('.').pop()
      const mediaType = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg'
      return { bytes, mediaType }
    } catch {
      throw notFound()
    }
  }
}

/** 统一的「记录不存在」错误。 */
function notFound() {
  return Object.assign(new Error('记录不存在或已被删除'), { code: 'NOT_FOUND' })
}

/** 由生成的数据目录与时间构造一条新记录。 */
export function makeReviewId() {
  return newId()
}
