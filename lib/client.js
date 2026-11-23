/**
 * 作文片段评测插件的浏览器半边。
 *
 * 在左侧栏注册「作文评测」入口，打开一个全幅面板：
 * - 左侧：上传手写照片（点击 / 拖拽 / 粘贴，自动压缩）或切到文字模式；
 * - 右侧：总分、逐维度评分与建议、问题清单、升格示范、练习方向；
 * - 抽屉：历史记录，可搜索、回看、删除。
 *
 * 这是一个零构建的 CJS 工厂：React 来自宿主共享模块表，样式以
 * <style> 注入，数据全部走 /api/essay-review/* 路由。
 *
 * @module dsh-plugin-essay-review/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-essay-review',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    var ReactModule = require('react')
    var React = ReactModule && ReactModule.default !== undefined ? ReactModule.default : ReactModule
    var h = React.createElement
    var useState = React.useState
    var useEffect = React.useEffect
    var useRef = React.useRef
    var useCallback = React.useCallback
    var useMemo = React.useMemo

    var NS = 'essay-review'
    var PANEL_ID = 'essay-review'
    var MAX_INPUT_BYTES = 20 * 1024 * 1024
    var MAX_EDGE = 1600

    var DICTIONARIES = {
      zh: {
        panel: '作文评测',
        title: '作文片段评测',
        subtitle: '上传手写照片或粘贴文字，从字体工整、卷面、语句、内容等方面评分并给出修改建议',
        model: '模型',
        history: '历史',
        tabImage: '手写图片',
        tabText: '文字片段',
        dropTitle: '点击选择，或把手写照片拖到这里',
        dropHint: '支持 JPG、PNG、WebP；建议正对拍摄、光线均匀、四角完整',
        pasteHint: '也可以直接粘贴剪贴板里的图片',
        replace: '重新选择',
        removeImage: '移除',
        textPlaceholder: '粘贴作文片段…',
        grade: '学段',
        titleLabel: '题目',
        titlePlaceholder: '选填，例如：那一刻，我长大了',
        requirements: '写作要求',
        requirementsPlaceholder: '选填，例如：写一个 200 字左右的片段，突出心理描写',
        focus: '重点关注',
        focusHint: '选填，勾选后评分会特别看这些维度',
        evaluate: '开始评测',
        evaluating: '正在评测',
        cancel: '取消',
        historyTitle: '评测历史',
        searchPlaceholder: '搜索标题、内容或学段…',
        emptyHistory: '还没有评测记录',
        noMatchHistory: '没有匹配的记录',
        emptyTitle: '还没有评测结果',
        emptyBody: '上传一张手写片段，或切换到文字模式粘贴一段作文，评测结果会显示在这里。',
        emptyTip1: '字体工整：笔画、结构、大小、行款',
        emptyTip2: '卷面整洁：涂改、字距、纸面',
        emptyTip3: '语言内容：语句、用词、标点、结构、切题',
        score: '总分',
        highlights: '本次亮点',
        dimensions: '分项评分',
        issues: '问题与改法',
        rewrite: '升格示范',
        copy: '复制',
        copied: '已复制',
        nextSteps: '下一步练习',
        transcription: '识别文本',
        transcriptionHint: '模型识别的手写内容；如有识别错误，切到文字模式改好再评一次',
        originalImage: '查看原图',
        reuseText: '按此文本重新评测',
        delete: '删除',
        deleteConfirm: '删除这条评测记录？',
        noVision: '当前模型不支持图片',
        noVisionHint: '当前模型看不到图片，无法评价字体工整与卷面。请改用文字模式，或在设置中更换支持图片的模型。',
        noVisionBadge: '不支持图片',
        errNoImage: '请先选择一张手写照片',
        errNoText: '请先粘贴要评测的文字',
        errType: '只支持 JPG、PNG、WebP 图片',
        errTooLarge: '图片太大，请选择 20 MB 以内的文件',
        errDecode: '图片读取失败，请换一张试试',
        cancelled: '已取消本次评测',
        loadingTip: '正在识别文字、逐项评分并生成修改建议，通常需要 20–60 秒…',
        retry: '重试',
        close: '关闭',
        metaModel: '评测模型',
        seconds: '秒',
        points: '分',
        gradeLabel: '学段',
        modeImage: '图片',
        modeText: '文字',
        noTitle: '未命名片段',
        loadingHistory: '加载中…',
        visionReady: '支持图片',
      },
      en: {
        panel: 'Essay Review',
        title: 'Essay Fragment Review',
        subtitle: 'Upload a handwritten page or paste text to score handwriting, neatness, language, and content with concrete advice',
        model: 'Model',
        history: 'History',
        tabImage: 'Handwriting',
        tabText: 'Text',
        dropTitle: 'Click to choose, or drop a handwritten photo here',
        dropHint: 'JPG, PNG, or WebP; shoot straight on with even lighting',
        pasteHint: 'You can also paste an image from the clipboard',
        replace: 'Replace',
        removeImage: 'Remove',
        textPlaceholder: 'Paste an essay fragment…',
        grade: 'Grade band',
        titleLabel: 'Prompt',
        titlePlaceholder: 'Optional, e.g. That moment I grew up',
        requirements: 'Requirements',
        requirementsPlaceholder: 'Optional, e.g. a 200-word fragment focused on inner thoughts',
        focus: 'Focus dimensions',
        focusHint: 'Optional; selected dimensions get closer attention',
        evaluate: 'Review',
        evaluating: 'Reviewing',
        cancel: 'Cancel',
        historyTitle: 'Review history',
        searchPlaceholder: 'Search title, text, or grade…',
        emptyHistory: 'No reviews yet',
        noMatchHistory: 'No matching review',
        emptyTitle: 'No review yet',
        emptyBody: 'Upload a handwritten fragment, or switch to text mode and paste an essay. The review appears here.',
        emptyTip1: 'Handwriting: strokes, structure, size, alignment',
        emptyTip2: 'Neatness: corrections, spacing, paper',
        emptyTip3: 'Language: sentences, words, punctuation, structure, focus',
        score: 'Score',
        highlights: 'Highlights',
        dimensions: 'Dimension scores',
        issues: 'Issues and fixes',
        rewrite: 'Polished version',
        copy: 'Copy',
        copied: 'Copied',
        nextSteps: 'Next practice',
        transcription: 'Recognized text',
        transcriptionHint: 'Text recognized from the photo; fix it in text mode and review again if needed',
        originalImage: 'Original photo',
        reuseText: 'Review this text again',
        delete: 'Delete',
        deleteConfirm: 'Delete this review?',
        noVision: 'The model cannot see images',
        noVisionHint: 'The current model cannot read images, so handwriting and neatness cannot be judged. Use text mode or switch to a vision-capable model.',
        noVisionBadge: 'No image input',
        errNoImage: 'Choose a handwritten photo first',
        errNoText: 'Paste the text to review first',
        errType: 'Only JPG, PNG, and WebP images are supported',
        errTooLarge: 'The image is too large; choose one under 20 MB',
        errDecode: 'The image could not be read; try another one',
        cancelled: 'Review cancelled',
        loadingTip: 'Recognizing text, scoring each dimension, and writing advice. Usually 20–60 seconds…',
        retry: 'Retry',
        close: 'Close',
        metaModel: 'Model',
        seconds: 's',
        points: 'pts',
        gradeLabel: 'Grade',
        modeImage: 'Photo',
        modeText: 'Text',
        noTitle: 'Untitled fragment',
        loadingHistory: 'Loading…',
        visionReady: 'Image input ready',
      },
    }

    /** 按 key 取当前语言文案，缺省回落中文。 */
    function translate(key) {
      var locale = 'zh'
      try {
        var lang = document.documentElement.lang || navigator.language || 'zh'
        if (/^en/i.test(lang)) locale = 'en'
      } catch {
        locale = 'zh'
      }
      return (DICTIONARIES[locale] && DICTIONARIES[locale][key]) || DICTIONARIES.zh[key] || key
    }

    /** 请求 JSON；失败时把服务端的 code/raw 带到 Error 上。 */
    async function requestJson(path, options) {
      var response = await fetch(path, {
        headers: { 'content-type': 'application/json' },
        ...(options || {}),
      })
      var data = null
      try {
        data = await response.json()
      } catch {
        data = null
      }
      if (!response.ok) {
        var message = (data && data.error && data.error.message) || ('HTTP ' + response.status)
        var error = new Error(message)
        error.code = data && data.error ? data.error.code : undefined
        error.raw = data && data.error ? data.error.raw : undefined
        error.status = response.status
        throw error
      }
      return data
    }

    /** 两位数字。 */
    function pad(value) {
      return value < 10 ? '0' + value : String(value)
    }

    /** 时间显示：月-日 时:分。 */
    function formatTime(stamp) {
      if (!stamp) return ''
      var date = new Date(stamp)
      if (Number.isNaN(date.getTime())) return ''
      return pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
    }

    /** 图片路由。 */
    function imageUrl(id) {
      return '/api/essay-review/image?id=' + encodeURIComponent(id)
    }

    /** 读图片为可绘制源，必要时走 <img> 兜底并交给调用方回收。 */
    async function loadSource(file) {
      if (typeof createImageBitmap === 'function') {
        try {
          var bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
          return { source: bitmap, width: bitmap.width, height: bitmap.height, cleanup: function () { if (bitmap.close) bitmap.close() } }
        } catch {
          // 某些编码在 createImageBitmap 下会失败，继续走 <img>。
        }
      }
      var url = URL.createObjectURL(file)
      try {
        var image = await new Promise(function (resolve, reject) {
          var element = new Image()
          element.onload = function () { resolve(element) }
          element.onerror = function () { reject(new Error('image decode failed')) }
          element.src = url
        })
        return {
          source: image,
          width: image.naturalWidth || image.width,
          height: image.naturalHeight || image.height,
          cleanup: function () { URL.revokeObjectURL(url) },
        }
      } catch (error) {
        URL.revokeObjectURL(url)
        throw error
      }
    }

    /**
     * 校验并压缩一张图片：长边不超过 1600，转成 JPEG。
     * 手写照片通常远超这个尺寸，压缩既省上传时间也避免请求体过大。
     */
    async function prepareImage(file) {
      if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error(translate('errType'))
      if (file.size > MAX_INPUT_BYTES) throw new Error(translate('errTooLarge'))
      var loaded = await loadSource(file)
      try {
        var scale = Math.min(1, MAX_EDGE / Math.max(loaded.width, loaded.height))
        var width = Math.max(1, Math.round(loaded.width * scale))
        var height = Math.max(1, Math.round(loaded.height * scale))
        var canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        var context = canvas.getContext('2d')
        if (context === null) throw new Error(translate('errDecode'))
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, width, height)
        context.drawImage(loaded.source, 0, 0, width, height)
        var dataUrl = canvas.toDataURL('image/jpeg', 0.9)
        var comma = dataUrl.indexOf(',')
        if (comma < 0) throw new Error(translate('errDecode'))
        var base64 = dataUrl.slice(comma + 1)
        return {
          dataUrl: dataUrl,
          base64: base64,
          mediaType: 'image/jpeg',
          name: file.name || 'fragment.jpg',
          width: width,
          height: height,
          bytes: Math.round((base64.length * 3) / 4),
        }
      } finally {
        loaded.cleanup()
      }
    }

    /** 把字节数显示成 KB / MB。 */
    function formatBytes(bytes) {
      if (!bytes) return ''
      if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB'
      return (bytes / 1024 / 1024).toFixed(1) + ' MB'
    }

    /** 复制文本，兼容不提供 Clipboard API 的环境。 */
    async function copyText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text)
        return true
      }
      var area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      var ok = false
      try {
        ok = document.execCommand('copy')
      } finally {
        area.remove()
      }
      return ok
    }

    /** 等级对应的强调色。 */
    function levelColor(levelKey) {
      if (levelKey === 'excellent') return 'var(--dsw-alias-state-success-primary)'
      if (levelKey === 'weak') return 'var(--dsw-alias-state-error-primary)'
      if (levelKey === 'fair' || levelKey === 'pass') return 'var(--dsw-alias-state-warn-primary)'
      return 'var(--dsw-alias-state-business-primary)'
    }

    // ------------------------------------------------------------------
    // 小组件
    // ------------------------------------------------------------------

    /** 带标签与提示的表单行。 */
    function Field(props) {
      return h('label', { className: 'er-field' },
        h('span', { className: 'er-field-label' }, props.label),
        props.children,
        props.hint ? h('span', { className: 'er-hint' }, props.hint) : null,
      )
    }

    /** 载入中的旋转指示。 */
    function Spinner() {
      return h('span', { className: 'er-spin', 'aria-hidden': 'true' })
    }

    /** 空状态。 */
    function EmptyState(props) {
      var tr = props.tr
      return h('div', { className: 'er-empty' },
        h('div', { className: 'er-empty-mark', 'aria-hidden': 'true' }, '评'),
        h('h2', null, tr('emptyTitle')),
        h('p', null, tr('emptyBody')),
        h('ul', { className: 'er-empty-list' },
          h('li', null, tr('emptyTip1')),
          h('li', null, tr('emptyTip2')),
          h('li', null, tr('emptyTip3')),
        ),
      )
    }

    /** 一条维度评分。 */
    function DimensionRow(props) {
      var dimension = props.dimension
      var percent = Math.round((dimension.score / dimension.max) * 100)
      var weak = percent < 60
      return h('div', { className: 'er-dim' },
        h('div', { className: 'er-dim-head' },
          h('strong', null, dimension.label),
          h('span', { className: weak ? 'er-dim-score weak' : 'er-dim-score' },
            String(dimension.score), h('em', null, ' / ' + dimension.max)),
        ),
        h('div', { className: 'er-bar', role: 'img', 'aria-label': dimension.label + ' ' + percent + '%' },
          h('div', { className: weak ? 'er-bar-fill weak' : 'er-bar-fill', style: { width: percent + '%' } }),
        ),
        dimension.comment ? h('p', { className: 'er-dim-comment' }, dimension.comment) : null,
        dimension.suggestions && dimension.suggestions.length > 0
          ? h('ul', { className: 'er-suggestions' }, dimension.suggestions.map(function (item, index) {
            return h('li', { key: 's' + index }, item)
          }))
          : null,
      )
    }

    /** 结果视图。 */
    function ResultView(props) {
      var review = props.review
      var tr = props.tr
      var result = review.result
      var percent = Math.max(0, Math.min(100, result.overall))
      var color = levelColor(result.level && result.level.key)
      var [copied, setCopied] = useState(false)

      var onCopy = useCallback(function () {
        void copyText(result.rewrite || '').then(function () {
          setCopied(true)
          setTimeout(function () { setCopied(false) }, 1600)
        })
      }, [result.rewrite])

      var ringStyle = {
        background: 'conic-gradient(' + color + ' ' + percent + '%, var(--dsw-alias-border-l2) 0)',
      }

      return h('article', { className: 'er-result' },
        h('div', { className: 'er-score' },
          h('div', { className: 'er-ring', style: ringStyle },
            h('div', { className: 'er-ring-inner' },
              h('strong', null, String(result.overall)),
              h('span', null, '/100'),
            ),
          ),
          h('div', { className: 'er-score-main' },
            h('div', { className: 'er-score-line' },
              h('span', { className: 'er-level ' + (result.level ? result.level.key : 'good') }, result.level ? result.level.label : ''),
              h('span', { className: 'er-muted' },
                tr('gradeLabel') + ' ' + review.grade + ' · '
                + (review.mode === 'image' ? tr('modeImage') : tr('modeText')) + ' · '
                + formatTime(review.createdAt)),
            ),
            result.summary ? h('p', { className: 'er-summary' }, result.summary) : null,
          ),
        ),

        review.hasImage
          ? h('details', { className: 'er-original' },
            h('summary', null, tr('originalImage')),
            h('img', { src: imageUrl(review.id), alt: tr('originalImage'), loading: 'lazy' }),
          )
          : null,

        result.highlights && result.highlights.length > 0
          ? h('section', { className: 'er-block' },
            h('h3', null, tr('highlights')),
            h('ul', { className: 'er-highlights' }, result.highlights.map(function (item, index) {
              return h('li', { key: 'h' + index }, h('span', { className: 'er-tick', 'aria-hidden': 'true' }, '✓'), item)
            })),
          )
          : null,

        h('section', { className: 'er-block' },
          h('h3', null, tr('dimensions')),
          h('div', { className: 'er-dims' }, result.dimensions.map(function (dimension) {
            return h(DimensionRow, { key: dimension.key, dimension: dimension })
          })),
        ),

        result.issues && result.issues.length > 0
          ? h('section', { className: 'er-block' },
            h('h3', null, tr('issues')),
            h('ol', { className: 'er-issues' }, result.issues.map(function (issue, index) {
              return h('li', { className: 'er-issue', key: 'i' + index },
                issue.quote ? h('blockquote', { className: 'er-quote' }, issue.quote) : null,
                issue.problem ? h('p', null, h('strong', null, '问题：'), issue.problem) : null,
                issue.advice ? h('p', null, h('strong', null, '改法：'), issue.advice) : null,
              )
            })),
          )
          : null,

        result.rewrite
          ? h('section', { className: 'er-block' },
            h('div', { className: 'er-block-head' },
              h('h3', null, tr('rewrite')),
              h('button', { type: 'button', className: 'er-btn small', onClick: onCopy }, copied ? tr('copied') : tr('copy')),
            ),
            h('p', { className: 'er-rewrite' }, result.rewrite),
          )
          : null,

        result.nextSteps && result.nextSteps.length > 0
          ? h('section', { className: 'er-block' },
            h('h3', null, tr('nextSteps')),
            h('ol', { className: 'er-next' }, result.nextSteps.map(function (item, index) {
              return h('li', { key: 'n' + index }, item)
            })),
          )
          : null,

        review.mode === 'image' && result.transcription
          ? h('section', { className: 'er-block' },
            h('h3', null, tr('transcription')),
            h('pre', { className: 'er-transcription' }, result.transcription),
            h('div', { className: 'er-block-actions' },
              h('span', { className: 'er-hint' }, tr('transcriptionHint')),
              h('button', { type: 'button', className: 'er-btn', onClick: function () { props.onReuse(result.transcription) } }, tr('reuseText')),
            ),
          )
          : null,

        h('footer', { className: 'er-result-footer' },
          h('span', { className: 'er-muted' },
            tr('metaModel') + ' ' + (review.model && review.model.label ? review.model.label : '—')
            + (review.elapsedMs ? ' · ' + (review.elapsedMs / 1000).toFixed(1) + tr('seconds') : '')),
          h('button', { type: 'button', className: 'er-btn danger', onClick: function () { props.onDelete(review.id) } }, tr('delete')),
        ),
      )
    }

    /** 历史抽屉。 */
    function HistoryDrawer(props) {
      var tr = props.tr
      var [query, setQuery] = useState('')
      var items = props.items
      var filtered = useMemo(function () {
        var needle = query.trim().toLowerCase()
        if (needle === '') return items
        return items.filter(function (item) {
          return [item.title, item.preview, item.grade].some(function (value) {
            return typeof value === 'string' && value.toLowerCase().includes(needle)
          })
        })
      }, [items, query])

      return h('div', { className: 'er-mask', onClick: props.onClose },
        h('aside', {
          className: 'er-drawer',
          role: 'dialog',
          'aria-label': tr('historyTitle'),
          onClick: function (event) { event.stopPropagation() },
        },
          h('header', { className: 'er-drawer-head' },
            h('h2', null, tr('historyTitle')),
            h('button', { type: 'button', className: 'er-btn small', onClick: props.onClose }, tr('close')),
          ),
          h('input', {
            className: 'er-input',
            placeholder: tr('searchPlaceholder'),
            value: query,
            onChange: function (event) { setQuery(event.target.value) },
            'aria-label': tr('searchPlaceholder'),
          }),
          filtered.length === 0
            ? h('p', { className: 'er-empty-line' }, items.length === 0 ? tr('emptyHistory') : tr('noMatchHistory'))
            : h('ul', { className: 'er-history-list' }, filtered.map(function (item) {
              return h('li', { key: item.id, className: props.activeId === item.id ? 'er-history-item active' : 'er-history-item' },
                h('button', { type: 'button', className: 'er-history-open', onClick: function () { props.onOpen(item.id) } },
                  item.hasImage
                    ? h('img', { className: 'er-thumb', src: imageUrl(item.id), alt: '', loading: 'lazy' })
                    : h('span', { className: 'er-thumb text', 'aria-hidden': 'true' }, '文'),
                  h('span', { className: 'er-history-main' },
                    h('span', { className: 'er-history-title' }, item.title || tr('noTitle')),
                    h('span', { className: 'er-history-meta' }, item.grade + ' · ' + formatTime(item.createdAt)),
                  ),
                  h('span', { className: 'er-history-score', style: { color: levelColor(item.level && item.level.key) } }, String(item.overall)),
                ),
                h('button', {
                  type: 'button',
                  className: 'er-icon-btn',
                  title: tr('delete'),
                  'aria-label': tr('delete'),
                  onClick: function () { props.onDelete(item.id) },
                }, '×'),
              )
            })),
        ),
      )
    }

    // ------------------------------------------------------------------
    // 主面板
    // ------------------------------------------------------------------

    /** 面板组件。 */
    function EssayReviewPanel(props) {
      var t = props && typeof props.t === 'function' ? props.t : null
      var tr = useCallback(function (key) { return t ? t(key) : translate(key) }, [t])

      var [config, setConfig] = useState(null)
      var [mode, setMode] = useState('image')
      var [grade, setGrade] = useState('初中')
      var [title, setTitle] = useState('')
      var [requirements, setRequirements] = useState('')
      var [focus, setFocus] = useState([])
      var [text, setText] = useState('')
      var [image, setImage] = useState(null)
      var [busy, setBusy] = useState(false)
      var [elapsed, setElapsed] = useState(0)
      var [error, setError] = useState(null)
      var [review, setReview] = useState(null)
      var [history, setHistory] = useState([])
      var [historyOpen, setHistoryOpen] = useState(false)
      var [notice, setNotice] = useState('')
      var [dragging, setDragging] = useState(false)
      var [loadingHistory, setLoadingHistory] = useState(true)

      var abortRef = useRef(null)
      var fileRef = useRef(null)
      var resultRef = useRef(null)

      var rubrics = config && config.rubrics ? config.rubrics : null
      var dimensions = rubrics && rubrics[mode] ? rubrics[mode] : []
      var visionBlocked = mode === 'image' && config !== null && config.vision === false

      /** 拉配置（模型能力、维度表）。 */
      useEffect(function () {
        var mounted = true
        void requestJson('/api/essay-review/config')
          .then(function (data) {
            if (!mounted) return
            setConfig(data)
            if (data.model && Array.isArray(data.grades) && data.grades.indexOf('初中') >= 0) setGrade('初中')
          })
          .catch(function (failure) {
            if (mounted) setError({ message: failure.message, code: failure.code })
          })
        return function () { mounted = false }
      }, [])

      /** 拉历史。 */
      var loadHistory = useCallback(async function () {
        try {
          var data = await requestJson('/api/essay-review/reviews')
          setHistory(data.reviews || [])
        } catch (failure) {
          setError({ message: failure.message, code: failure.code })
        } finally {
          setLoadingHistory(false)
        }
      }, [])

      useEffect(function () { void loadHistory() }, [loadHistory])

      /** 评测计时。 */
      useEffect(function () {
        if (!busy) return undefined
        var started = Date.now()
        setElapsed(0)
        var timer = setInterval(function () {
          setElapsed(Math.floor((Date.now() - started) / 1000))
        }, 500)
        return function () { clearInterval(timer) }
      }, [busy])

      /** 结果更新后回到顶部。 */
      useEffect(function () {
        if (resultRef.current) resultRef.current.scrollTop = 0
      }, [review])

      /** 处理一张图片文件。 */
      var acceptFile = useCallback(async function (file) {
        setError(null)
        setNotice('')
        try {
          var prepared = await prepareImage(file)
          setImage(prepared)
          setMode('image')
        } catch (failure) {
          setError({ message: failure.message })
        }
      }, [])

      /** 剪贴板粘贴图片。 */
      useEffect(function () {
        function onPaste(event) {
          if (!event.clipboardData) return
          var item = null
          for (var index = 0; index < event.clipboardData.items.length; index += 1) {
            var candidate = event.clipboardData.items[index]
            if (candidate.type && candidate.type.indexOf('image/') === 0) {
              item = candidate
              break
            }
          }
          if (item === null) return
          var file = item.getAsFile()
          if (file === null) return
          event.preventDefault()
          void acceptFile(file)
        }
        document.addEventListener('paste', onPaste)
        return function () { document.removeEventListener('paste', onPaste) }
      }, [acceptFile])

      /** 切换模式时清掉只属于图片模式的错误。 */
      function switchMode(next) {
        setMode(next)
        setError(null)
        setNotice('')
      }

      /** 勾选/取消重点维度。 */
      function toggleFocus(key) {
        setFocus(function (current) {
          if (current.indexOf(key) >= 0) return current.filter(function (item) { return item !== key })
          if (current.length >= 4) return current
          return current.concat([key])
        })
      }

      /** 提交评测。 */
      async function submit() {
        setError(null)
        setNotice('')
        if (mode === 'image' && image === null) {
          setError({ message: tr('errNoImage') })
          return
        }
        if (mode === 'text' && text.trim() === '') {
          setError({ message: tr('errNoText') })
          return
        }
        if (visionBlocked) {
          setError({ message: tr('noVisionHint'), code: 'model/no-vision' })
          return
        }
        var controller = new AbortController()
        abortRef.current = controller
        setBusy(true)
        setReview(null)
        try {
          var payload = {
            mode: mode,
            grade: grade,
            title: title,
            requirements: requirements,
            focus: focus,
            text: mode === 'text' ? text : '',
          }
          if (mode === 'image' && image !== null) {
            payload.image = { data: image.base64, mediaType: image.mediaType }
          }
          var data = await requestJson('/api/essay-review/evaluate', {
            method: 'POST',
            body: JSON.stringify(payload),
            signal: controller.signal,
          })
          setReview(data.review)
          void loadHistory()
        } catch (failure) {
          if (failure && failure.name === 'AbortError') {
            setNotice(tr('cancelled'))
          } else {
            setError({ message: failure.message, code: failure.code, raw: failure.raw })
          }
        } finally {
          setBusy(false)
          abortRef.current = null
        }
      }

      /** 打开一条历史记录。 */
      async function openReview(id) {
        setHistoryOpen(false)
        setError(null)
        setNotice('')
        try {
          var data = await requestJson('/api/essay-review/review?id=' + encodeURIComponent(id))
          setReview(data.review)
        } catch (failure) {
          setError({ message: failure.message, code: failure.code })
        }
      }

      /** 删除记录：先确认，再同步列表。 */
      async function removeReview(id) {
        if (!window.confirm(tr('deleteConfirm'))) return
        try {
          await requestJson('/api/essay-review/delete', { method: 'POST', body: JSON.stringify({ id: id }) })
          if (review && review.id === id) setReview(null)
          setHistory(function (items) { return items.filter(function (item) { return item.id !== id }) })
        } catch (failure) {
          setError({ message: failure.message, code: failure.code })
        }
      }

      /** 用识别文本回到文字模式。 */
      function reuseTranscription(value) {
        switchMode('text')
        setText(value || '')
        setReview(null)
        setHistoryOpen(false)
      }

      var modelLabel = config && config.model ? config.model.label : ''

      return h('div', { className: 'er-root' },
        h('header', { className: 'er-top' },
          h('div', { className: 'er-brand' },
            h('span', { className: 'er-logo', 'aria-hidden': 'true' }, '评'),
            h('div', { className: 'er-brand-text' },
              h('h1', null, tr('title')),
              h('p', null, tr('subtitle')),
            ),
          ),
          h('div', { className: 'er-top-actions' },
            modelLabel
              ? h('span', { className: 'er-badge', title: config.model.provider + '/' + config.model.model },
                tr('model') + ' ' + modelLabel,
                config.vision === false ? h('em', { className: 'er-badge-warn' }, tr('noVisionBadge')) : null)
              : null,
            h('button', {
              type: 'button',
              className: 'er-btn',
              onClick: function () { setHistoryOpen(true) },
            }, tr('history') + (history.length > 0 ? ' (' + history.length + ')' : '')),
          ),
        ),

        h('div', { className: 'er-body' },
          h('section', { className: 'er-pane er-form-pane', 'aria-label': tr('title') },
            h('div', { className: 'er-tabs', role: 'tablist' },
              h('button', {
                type: 'button',
                role: 'tab',
                'aria-selected': mode === 'image',
                className: mode === 'image' ? 'er-tab active' : 'er-tab',
                onClick: function () { switchMode('image') },
              }, tr('tabImage')),
              h('button', {
                type: 'button',
                role: 'tab',
                'aria-selected': mode === 'text',
                className: mode === 'text' ? 'er-tab active' : 'er-tab',
                onClick: function () { switchMode('text') },
              }, tr('tabText')),
            ),

            mode === 'image'
              ? h('div', null,
                h('input', {
                  ref: fileRef,
                  type: 'file',
                  accept: 'image/jpeg,image/png,image/webp',
                  className: 'er-file',
                  onChange: function (event) {
                    var file = event.target.files && event.target.files[0]
                    if (file) void acceptFile(file)
                    event.target.value = ''
                  },
                }),
                image === null
                  ? h('div', {
                    className: dragging ? 'er-drop dragging' : 'er-drop',
                    role: 'button',
                    tabIndex: 0,
                    onClick: function () { if (fileRef.current) fileRef.current.click() },
                    onKeyDown: function (event) {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        if (fileRef.current) fileRef.current.click()
                      }
                    },
                    onDragOver: function (event) { event.preventDefault(); setDragging(true) },
                    onDragLeave: function () { setDragging(false) },
                    onDrop: function (event) {
                      event.preventDefault()
                      setDragging(false)
                      var file = event.dataTransfer && event.dataTransfer.files ? event.dataTransfer.files[0] : null
                      if (file) void acceptFile(file)
                    },
                  },
                    h('span', { className: 'er-drop-icon', 'aria-hidden': 'true' }, '＋'),
                    h('strong', null, tr('dropTitle')),
                    h('span', { className: 'er-hint' }, tr('dropHint')),
                    h('span', { className: 'er-hint' }, tr('pasteHint')),
                  )
                  : h('div', { className: 'er-preview' },
                    h('img', { src: image.dataUrl, alt: tr('tabImage') }),
                    h('div', { className: 'er-preview-meta' },
                      h('span', null, image.width + '×' + image.height + ' · ' + formatBytes(image.bytes)),
                      h('div', { className: 'er-preview-actions' },
                        h('button', { type: 'button', className: 'er-btn small', onClick: function () { if (fileRef.current) fileRef.current.click() } }, tr('replace')),
                        h('button', { type: 'button', className: 'er-btn small', onClick: function () { setImage(null) } }, tr('removeImage')),
                      ),
                    ),
                  ),
                visionBlocked
                  ? h('p', { className: 'er-warn-note' }, tr('noVisionHint'))
                  : null,
              )
              : h('textarea', {
                className: 'er-textarea',
                rows: 12,
                placeholder: tr('textPlaceholder'),
                value: text,
                onChange: function (event) { setText(event.target.value) },
              }),

            h('div', { className: 'er-grid-2' },
              h(Field, { label: tr('grade') },
                h('select', {
                  className: 'er-select',
                  value: grade,
                  onChange: function (event) { setGrade(event.target.value) },
                }, (config && config.grades ? config.grades : ['小学低年级', '小学高年级', '初中', '高中', '其他']).map(function (item) {
                  return h('option', { key: item, value: item }, item)
                })),
              ),
              h(Field, { label: tr('titleLabel') },
                h('input', {
                  className: 'er-input',
                  placeholder: tr('titlePlaceholder'),
                  value: title,
                  maxLength: 120,
                  onChange: function (event) { setTitle(event.target.value) },
                }),
              ),
            ),

            h(Field, { label: tr('requirements') },
              h('input', {
                className: 'er-input',
                placeholder: tr('requirementsPlaceholder'),
                value: requirements,
                maxLength: 500,
                onChange: function (event) { setRequirements(event.target.value) },
              }),
            ),

            dimensions.length > 0
              ? h(Field, { label: tr('focus'), hint: tr('focusHint') },
                h('div', { className: 'er-chips' }, dimensions.map(function (dimension) {
                  var active = focus.indexOf(dimension.key) >= 0
                  return h('button', {
                    type: 'button',
                    key: dimension.key,
                    className: active ? 'er-chip active' : 'er-chip',
                    onClick: function () { toggleFocus(dimension.key) },
                  }, dimension.label)
                })),
              )
              : null,

            error
              ? h('div', { className: 'er-error', role: 'alert' },
                h('p', null, error.message),
                error.code ? h('span', { className: 'er-error-code' }, error.code) : null,
                error.raw ? h('pre', { className: 'er-error-raw' }, error.raw) : null,
              )
              : null,
            notice ? h('p', { className: 'er-notice' }, notice) : null,

            h('div', { className: 'er-submit sticky' },
              h('button', {
                type: 'button',
                className: 'er-btn primary large',
                disabled: busy,
                onClick: function () { void submit() },
              }, busy ? tr('evaluating') : tr('evaluate')),
              busy
                ? h('button', {
                  type: 'button',
                  className: 'er-btn large',
                  onClick: function () { if (abortRef.current) abortRef.current.abort() },
                }, tr('cancel'))
                : null,
            ),
          ),

          h('section', { className: 'er-pane er-result-pane', ref: resultRef, 'aria-live': 'polite' },
            busy
              ? h('div', { className: 'er-loading' },
                h(Spinner),
                h('strong', null, tr('evaluating') + '…'),
                h('span', { className: 'er-muted' }, elapsed + ' ' + tr('seconds')),
                h('p', { className: 'er-hint' }, tr('loadingTip')),
              )
              : null,
            !busy && review !== null
              ? h(ResultView, {
                review: review,
                tr: tr,
                onReuse: reuseTranscription,
                onDelete: removeReview,
              })
              : null,
            !busy && review === null ? h(EmptyState, { tr: tr }) : null,
          ),
        ),

        historyOpen
          ? h(HistoryDrawer, {
            tr: tr,
            items: history,
            loading: loadingHistory,
            activeId: review ? review.id : '',
            onClose: function () { setHistoryOpen(false) },
            onOpen: function (id) { void openReview(id) },
            onDelete: function (id) { void removeReview(id) },
          })
          : null,
      )
    }

    // ------------------------------------------------------------------
    // 样式
    // ------------------------------------------------------------------

    var STYLES = `
.er-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-base);
  font-size: 13px;
  line-height: 1.6;
}
.er-root *, .er-root *::before, .er-root *::after { box-sizing: border-box; }
.er-root button { font: inherit; }
.er-root :focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }

.er-top {
  flex: none;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 24px;
  padding-top: calc(14px + var(--dsh-frame-top-clearance, 0px));
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}
.er-brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
.er-logo {
  flex: none;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-state-business-tertiary);
  color: var(--dsw-alias-state-business-primary);
  font-size: 16px;
  font-weight: 600;
}
.er-brand-text { min-width: 0; }
.er-brand-text h1 { margin: 0; font-size: 16px; font-weight: 600; line-height: 1.4; }
.er-brand-text p {
  margin: 2px 0 0;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.er-top-actions { display: flex; align-items: center; gap: 8px; flex: none; }
.er-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 320px;
  padding: 3px 10px;
  overflow: hidden;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.er-badge-warn { color: var(--dsw-alias-state-warn-label); font-style: normal; }

.er-body {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(320px, 400px) minmax(0, 1fr);
  min-height: 0;
}
.er-pane { min-height: 0; overflow: auto; }
.er-form-pane {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px 20px 0;
  border-right: 0.5px solid var(--dsw-alias-border-l2);
}
.er-result-pane { padding: 20px 24px 32px; }

.er-tabs { display: flex; gap: 4px; padding: 3px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); }
.er-tab {
  flex: 1;
  padding: 6px 10px;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.er-tab.active { background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-weight: 500; box-shadow: 0 1px 2px rgb(0 0 0 / 8%); }

.er-file { display: none; }
.er-drop {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 210px;
  padding: 20px;
  border: 1.5px dashed var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  text-align: center;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.er-drop:hover, .er-drop.dragging { border-color: var(--dsw-alias-state-business-primary); background: var(--dsw-alias-state-business-tertiary); }
.er-drop strong { color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 500; }
.er-drop-icon { font-size: 26px; line-height: 1; color: var(--dsw-alias-state-business-primary); }
.er-hint { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 1.5; }

.er-preview { display: flex; flex-direction: column; gap: 8px; }
.er-preview img {
  width: 100%;
  max-height: 280px;
  object-fit: contain;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-2);
}
.er-preview-meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.er-preview-actions { display: flex; gap: 6px; }

.er-textarea, .er-input, .er-select {
  width: 100%;
  padding: 8px 10px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
}
.er-textarea { min-height: 220px; resize: vertical; line-height: 1.7; }
.er-textarea::placeholder, .er-input::placeholder { color: var(--dsw-alias-label-tertiary); }

.er-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.er-field-label { color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 500; }
.er-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

.er-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.er-highlights { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; }
.er-highlights li { display: flex; gap: 8px; color: var(--dsw-alias-label-secondary); }
.er-tick { flex: none; color: var(--dsw-alias-state-success-primary); font-weight: 600; }
.er-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}
button.er-chip { cursor: pointer; }
button.er-chip:hover { background: var(--dsw-alias-interactive-bg-hover); }
.er-chip.active { border-color: var(--dsw-alias-state-business-primary); background: var(--dsw-alias-state-business-tertiary); color: var(--dsw-alias-state-business-primary); }
.er-chip.good { border-color: transparent; background: var(--dsw-alias-state-success-tertiary); color: var(--dsw-alias-state-success-primary); }

.er-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
}
.er-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
.er-btn.small { height: 26px; padding: 0 9px; font-size: 12px; }
.er-btn.large { height: 36px; padding: 0 18px; }
.er-btn.primary { border-color: transparent; background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-inverted); font-weight: 500; }
.er-btn.primary:hover { background: var(--dsw-alias-button-primary-hover); }
.er-btn.danger { color: var(--dsw-alias-state-error-primary); }
.er-btn.danger:hover { background: var(--dsw-alias-interactive-bg-hover-danger); }
.er-btn:disabled { opacity: 0.55; cursor: not-allowed; }

.er-submit { display: flex; gap: 8px; margin-top: 2px; }
.er-submit.sticky {
  position: sticky;
  bottom: 0;
  z-index: 2;
  margin: 2px -20px 0;
  padding: 12px 20px 16px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
}
.er-warn-note {
  margin: 10px 0 0;
  padding: 8px 10px;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-state-warn-tertiary);
  color: var(--dsw-alias-state-warn-label);
  font-size: 12px;
}
.er-error {
  padding: 10px 12px;
  border: 0.5px solid var(--dsw-alias-state-error-primary);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-state-error-tertiary, var(--dsw-alias-bg-layer-1));
}
.er-error p { margin: 0; color: var(--dsw-alias-state-error-primary); }
.er-error-code { display: inline-block; margin-top: 4px; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.er-error-raw {
  max-height: 180px;
  margin: 8px 0 0;
  overflow: auto;
  padding: 8px;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  white-space: pre-wrap;
}
.er-notice { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; }

.er-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 64px 24px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-1);
  text-align: center;
}
.er-spin {
  width: 22px;
  height: 22px;
  border: 2px solid var(--dsw-alias-border-l2);
  border-top-color: var(--dsw-alias-state-business-primary);
  border-radius: 50%;
  animation: er-spin 0.9s linear infinite;
}
@keyframes er-spin { to { transform: rotate(360deg); } }
.er-loading .er-hint { max-width: 360px; }

.er-empty { max-width: 520px; margin: 6vh auto 0; padding: 0 8px; text-align: center; }
.er-empty-mark {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  margin: 0 auto 14px;
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-tertiary);
  font-size: 22px;
}
.er-empty h2 { margin: 0 0 6px; font-size: 16px; font-weight: 600; }
.er-empty p { margin: 0 0 16px; color: var(--dsw-alias-label-secondary); }
.er-empty-list { margin: 0; padding: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; list-style: none; }
.er-empty-list li { padding: 5px 0; border-top: 0.5px dashed var(--dsw-alias-border-l2); }

.er-result { display: flex; flex-direction: column; gap: 10px; max-width: 880px; }
.er-score {
  display: flex;
  gap: 18px;
  align-items: center;
  padding: 18px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-1);
}
.er-ring { flex: none; display: grid; place-items: center; width: 92px; height: 92px; border-radius: 50%; }
.er-ring-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 74px;
  height: 74px;
  border-radius: 50%;
  background: var(--dsw-alias-bg-base);
  line-height: 1.1;
}
.er-ring-inner strong { font-size: 26px; font-weight: 600; font-variant-numeric: tabular-nums; }
.er-ring-inner span { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.er-score-main { min-width: 0; }
.er-score-line { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.er-level { padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 500; }
.er-level.excellent { background: var(--dsw-alias-state-success-tertiary); color: var(--dsw-alias-state-success-primary); }
.er-level.good { background: var(--dsw-alias-state-business-tertiary); color: var(--dsw-alias-state-business-primary); }
.er-level.fair, .er-level.pass { background: var(--dsw-alias-state-warn-tertiary); color: var(--dsw-alias-state-warn-label); }
.er-level.weak { background: var(--dsw-alias-state-error-tertiary, var(--dsw-alias-bg-layer-2)); color: var(--dsw-alias-state-error-primary); }
.er-summary { margin: 8px 0 0; color: var(--dsw-alias-label-secondary); }
.er-original { border: 0.5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); }
.er-original summary { padding: 8px 12px; color: var(--dsw-alias-label-secondary); font-size: 12px; cursor: pointer; }
.er-original[open] summary { border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
.er-original img { display: block; width: 100%; max-height: 520px; object-fit: contain; border-radius: 0 0 var(--dsw-radius-md) var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-2); }
.er-muted { color: var(--dsw-alias-label-tertiary); font-size: 12px; }

.er-block { padding: 16px 18px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-layer-1); }
.er-block h3 { margin: 0 0 10px; font-size: 13px; font-weight: 600; }
.er-block-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.er-block-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 10px; }
.er-dims { display: flex; flex-direction: column; }
.er-dim { padding: 10px 0; border-top: 0.5px dashed var(--dsw-alias-border-l2); }
.er-dim:first-child { padding-top: 0; border-top: 0; }
.er-dim-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.er-dim-head strong { font-size: 13px; font-weight: 500; }
.er-dim-score { color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.er-dim-score em { color: var(--dsw-alias-label-tertiary); font-size: 11px; font-style: normal; }
.er-dim-score.weak { color: var(--dsw-alias-state-error-primary); }
.er-bar { height: 6px; margin: 7px 0 6px; overflow: hidden; border-radius: 999px; background: var(--dsw-alias-border-l2); }
.er-bar-fill { height: 100%; border-radius: 999px; background: var(--dsw-alias-state-business-primary); }
.er-bar-fill.weak { background: var(--dsw-alias-state-error-primary); }
.er-dim-comment { margin: 0; color: var(--dsw-alias-label-secondary); }
.er-suggestions { margin: 6px 0 0; padding-left: 18px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.er-suggestions li { margin: 2px 0; }

.er-issues { display: flex; flex-direction: column; gap: 4px; margin: 0; padding-left: 18px; }
.er-issue { padding: 4px 0 4px 6px; color: var(--dsw-alias-label-secondary); }
.er-issue p { margin: 4px 0 0; }
.er-issue strong { color: var(--dsw-alias-label-primary); font-weight: 500; }
.er-quote {
  margin: 0 0 6px;
  padding: 4px 10px;
  border-left: 2px solid var(--dsw-alias-state-warn-primary);
  border-radius: 0 var(--dsw-radius-sm) var(--dsw-radius-sm) 0;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}
.er-rewrite {
  margin: 0;
  padding: 12px 14px;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-state-business-tertiary);
  color: var(--dsw-alias-label-primary);
  line-height: 1.8;
  white-space: pre-wrap;
}
.er-next { margin: 0; padding-left: 20px; color: var(--dsw-alias-label-secondary); }
.er-next li { margin: 4px 0; }
.er-transcription {
  max-height: 260px;
  margin: 0;
  overflow: auto;
  padding: 10px 12px;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-family: inherit;
  line-height: 1.8;
  white-space: pre-wrap;
}
.er-result-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 4px;
}

.er-mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  justify-content: flex-end;
  background: var(--dsw-alias-bg-mask-1);
}
.er-drawer {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: min(400px, 92vw);
  height: 100%;
  padding: 16px;
  border-left: 0.5px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  box-shadow: -8px 0 24px rgb(0 0 0 / 10%);
}
.er-drawer-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.er-drawer-head h2 { margin: 0; font-size: 14px; font-weight: 600; }
.er-history-list { flex: 1; margin: 0; padding: 0; overflow: auto; list-style: none; }
.er-history-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px;
  border-radius: var(--dsw-radius-md);
}
.er-history-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
.er-history-item.active { background: var(--dsw-alias-bg-layer-2); }
.er-history-open {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 2px;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.er-thumb {
  flex: none;
  width: 42px;
  height: 42px;
  object-fit: cover;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-2);
}
.er-thumb.text { display: grid; place-items: center; color: var(--dsw-alias-label-tertiary); font-size: 16px; }
.er-history-main { display: flex; flex: 1; flex-direction: column; min-width: 0; }
.er-history-title { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.er-history-meta { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.er-history-score { flex: none; font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; }
.er-icon-btn {
  flex: none;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}
.er-icon-btn:hover { background: var(--dsw-alias-interactive-bg-hover-danger); color: var(--dsw-alias-state-error-primary); }
.er-empty-line { margin: 24px 0; color: var(--dsw-alias-label-tertiary); text-align: center; }

@media (max-width: 900px) {
  .er-body { grid-template-columns: minmax(0, 1fr); overflow: auto; }
  .er-pane { overflow: visible; }
  .er-form-pane { border-right: 0; border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
  .er-top { flex-wrap: wrap; }
  .er-badge { max-width: 100%; }
}
`

    /** 左侧栏图标（钢笔与横线）。 */
    function EssayReviewIcon(props) {
      var size = props && props.size ? props.size : 18
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
        h('path', { d: 'M4 20l3.2-.7L19 7.5a2.1 2.1 0 0 0-3-3L4.2 16.3 4 20z' }),
        h('path', { d: 'M13.5 6.5l3 3' }),
        h('path', { d: 'M4 22h16' }),
      )
    }

    /** 浏览器插件可用的服务。 */
    exports.inject = ['slots', 'locale']

    /**
     * 注册面板、侧栏入口、文案与样式。
     * @param {object} ctx - 浏览器插件上下文。
     */
    exports.apply = function apply(ctx) {
      ctx.effect(function () { return ctx.locale.register(NS, DICTIONARIES) }, 'essay-review: locale')
      ctx.effect(function () {
        var tag = document.createElement('style')
        tag.dataset.plugin = 'essay-review'
        tag.textContent = STYLES
        document.head.appendChild(tag)
        return function () { tag.remove() }
      }, 'essay-review: styles')
      var t = ctx.locale.bind(NS)
      ctx.slots.inject('main', function () {
        return ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, EssayReviewPanel)
      })
      ctx.slots.inject('sidebar.panellist', function () {
        return ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 6,
          label: function () { return t('panel') },
          locale: NS,
        }, EssayReviewIcon)
      })
    }

    exports.PANEL_ID = PANEL_ID
    exports.EssayReviewPanel = EssayReviewPanel
    // 供离线冒烟测试渲染，不参与插件协议。
    exports.ResultView = ResultView
    exports.HistoryDrawer = HistoryDrawer
    return module.exports
  },
})
