/**
 * 视觉索引 visionindex —— Forsion 桌面插件(裸 setup(ctx) 体,宿主 new Function('ctx', code) 装载)。
 *
 * 库里几千张截图/扫描件/拍照笔记里的字,今天在全局搜索里等于不存在。本插件用**用户已经登录的宿主
 * 视觉链路**(execMode:'host' 的 view_image,视觉能力由引擎 visionService 自动降级,插件永不选模型)
 * 逐张读出文字,写成**可见目录里的纯 md sidecar**(<工作文件夹>/Index/<源路径原样>.md),
 * 于是宿主全局搜索直接命中,并能从命中处 frontmatter 的 source 反查回原图。
 *
 * 两个视图(Space 组合:左 queue + 主 results + 右宿主 chat):
 *   plugin:visionindex:queue   —— 目录圈定 + 预算闸 + 可中断续跑的扫描队列
 *   plugin:visionindex:results —— 识别结果、反查原图、转正式笔记、验证全局搜索能不能命中
 *
 * 红线(立项论证的命门,改前先读 SPEC):
 *   · manifest 绝不声明 fileExtensions、绝不认领自定义文件类型 —— sidecar 必须是普普通通的笔记,
 *     否则主进程把它排出页面列表 = 全局搜索搜不到 = 本插件白做。
 *   · .visionindex/ 只放状态,绝不出现识别正文(连摘要都不行)。
 *   · vault 绝对路径是敏感信息:只在内存里拼给 Agent,不落盘、不进产物、不打日志。
 *
 * 安全:一切模型/用户产出文本只走 createElement + textContent(全文件不含 HTML 字符串注入面)。
 * 兼容:07-18 之后的 ctx 面一律可选链;枚举接缝「方法在、结果空」是一等状态,必须渲染出真内容。
 * 时间:「现在」一律 Date.now();日序走 Date.UTC 纯日历;全文件无周期定时器(check 冻钟可测)。
 */
const PLUGIN_ID = 'visionindex'
const APP_ID = 'tangu'
/** 引擎 hostExec.ts 的 VIEW_IMAGE_MAX_BYTES —— UI 层拿不到 size,只能事后按错误文案归类。 */
const VIEW_IMAGE_MAX_BYTES = 5 * 1024 * 1024
/** 引擎 IMAGE_MIME 支持的六种位图;.svg/.heic/.tif/.pdf 一律不入队(不是失败,是不做)。 */
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']
const FENCE_META = 'visionindex-meta'
const FENCE_TEXT = 'visionindex-text'
const FENCE_FILES = 'visionindex-files'
const INDEX_DIR = '.visionindex'
const SIDECAR_DIR = 'Index'
const NOTES_DIR = 'Notes'
const DEFAULT_WF = '视觉索引'
const MAX_RESULT_ROWS = 60
const PREVIEW_CHARS = 120

// ══ 双语词表(两侧键集合必须完全相等,check.mjs 断言它)══════════════════════
const MSG = {
  zh: {
    viewQueue: '扫描队列', viewResults: '识别结果',
    cmdOpen: '视觉索引:打开', cmdScan: '视觉索引:开始识别',
    sbTitle: '打开视觉索引', sbPending: '{n} 待识别', sbReady: '已就绪',
    setMaxLabel: '单次识别上限(张)', setMaxDesc: '预算闸的硬闸:一次运行最多识别多少张图(1-500)。超出的留到下次运行。',
    setSecLabel: '单张预估耗时(秒)', setSecDesc: '只用于预算闸估时,不影响真实速度(1-120)。',
    setVaultLabel: '笔记库绝对路径(可留空)', setVaultDesc: '最后手段:宿主取不到库路径、且 Agent 也解析不出相对路径时才填。留空 = 让 Agent 用它系统提示里已有的库路径解析。',
    setRetryLabel: '重扫时重试失败的图', setRetryDesc: '默认跳过上次失败的图;打开后每次扫描都会把它们重新排队。',
    qTitle: '视觉索引', qSubtitle: '把图片里的字读出来,写成能被全局搜索命中的笔记。',
    introTitle: '视觉索引能做什么', introStep1: '① 勾选要索引的目录(烧的是你自己的额度,所以不做开箱扫全库)。',
    introStep2: '② 看清预算再开跑:一次识别几张、大概多久,都写在按钮上方。',
    introStep3: '③ 每张图读完立刻落一份 md sidecar —— 从此全局搜索能搜到图里的字,点一下就跳回原图。',
    introHint: '中途可以停,已经读完的全部作数,下次接着跑。',
    secFolders: '圈定目录', secBudget: '预算闸', secRun: '本次运行',
    selAll: '全选', selNone: '全不选', rescanMeta: '重扫元数据', rebuildCache: '重建缓存',
    folderRoot: '(库根)', folderStat: '图片 {n} 张 · 已识别 {d}',
    noFolders: '当前枚举不到任何图片目录。用下面的按钮让 Agent 扫一遍库,或先手动补录一张试试。',
    budgetLine: '本次将识别 {n} 张,预估约 {dur}。',
    budgetCapped: '已按单次上限截到 {n} 张,可多次运行把剩下的跑完。',
    budgetPickFirst: '先在上面勾选至少一个目录,预算闸才会解锁。',
    budgetNothing: '圈定的目录里没有待识别的图了。',
    btnStart: '开始识别', btnStop: '停止', btnOpenResults: '打开结果 →',
    runProgress: '{i} / {n}', runCurrent: '正在读:{name}',
    resOk: '{n} 字', resEmpty: '无文字',
    dataAt: '产物写在 {path},普通 markdown,可直接当笔记打开。',
    banEnumTitle: '枚举不到文件', banEnumBody: '当前环境没有给出文件清单(没打开笔记库,或宿主/网页端不支持枚举)。你仍然可以让 Agent 扫一遍库,或手动补录单张。',
    banBridgeTitle: '这个宿主版本没有文件枚举接口', banBridgeBody: '升级 Forsion 桌面端即可自动圈定目录。在此之前,可以手动补录单张图片走同一条识别管线。',
    banVaultTitle: '取不到笔记库的绝对路径', banVaultBody: '不要紧:指令会改发库内相对路径,并让 Agent 用它系统提示里已有的库路径解析。实在不行再去设置里手填。',
    banEngineTitle: '还没连上 Forsion 引擎', banEngineBody: '识别要用你已登录的宿主视觉链路。请在 Forsion 桌面端登录后再回来开跑。',
    banBtnAgentScan: '让 Agent 扫库', banBtnManual: '手动补录一张', banBtnSettings: '设置在哪',
    banSettingsHint: '设置 → Forsion → 社区插件 → 视觉索引:那一页有「笔记库绝对路径」「单次识别上限」「单张预估耗时」「重扫时重试失败的图」。',
    errTooLarge: '图片超过 5MB', errUnsupported: '引擎不支持的图片格式', errNotFound: '找不到这个文件',
    errNoChannel: '当前运行环境无法回传图片', errNoFence: '模型没有按约定格式回复', errUnknown: '未知错误',
    errStream: '与引擎的连接中断,未收到完成事件',
    rSearchPh: '搜索识别出的文字…', rSearchLocal: '全局搜索没给出命中,当前只在已读入的条目里匹配 —— 结果可能不全。',
    rEmptyTitle: '还没有识别结果',
    rEmptyBody: '去「扫描队列」勾一个装图片的目录,跑一批,这里就会长出来。',
    rGoScan: '去扫描', rCount: '{n} 条', rNoHit: '没有匹配的条目。',
    grpToday: '今天', grpYesterday: '昨天', grpWeek: '本周', grpEarlier: '更早',
    actOpenText: '打开文本', actOpenSource: '反查原图', actPromote: '转正式笔记', actRedo: '重新识别', actVerify: '验证收录',
    verifyOk: '全局搜索可命中', verifyNo: '全局搜索还没索引到', verifyNA: '这个环境没有全局搜索接口',
    noteFrom: '来自',
    notifyPickFolder: '先在「扫描队列」里勾选要索引的目录', notifyNoEngine: '未连接到 Forsion 引擎(需要在桌面端登录)',
    notifyDone: '本批结束:{ok} 张有文字,{empty} 张无文字,{fail} 张失败', notifyStopped: '已停止,已读完的全部保留,可随时接着跑',
    notifyPromoteEmpty: '读不到这条的识别正文(sidecar 可能已被删),没有转出空笔记',
    notifyRepeatFail: '连续 3 张都失败({code}),已停止本批', notifyPromoted: '已转成正式笔记',
    notifyBroke: '与引擎的连接中断,已停止本批(已读完的全部保留,可接着跑):{err}',
    notifyRedone: '已重新识别', notifyRebuilt: '缓存已按库里现有的 sidecar 重建',
    notifyScanFound: 'Agent 扫到 {n} 张图片', notifyScanNone: 'Agent 没有扫到可识别的图片',
    promptManual: '输入一张图片在库里的相对路径(如 Attachments/2026/白板.png)',
    notifyBadPath: '这不是可以识别的图片路径(只收 png/jpg/jpeg/gif/webp/bmp,且不能在工作文件夹内)',
    uHour: '小时', uMin: '分', uSec: '秒',
    achSeries: '视觉索引', ach1: '第一张', ach1d: '识别出第一张图里的文字',
    ach2: '百图', ach2d: '累计识别 100 张图', ach3: '沉淀', ach3d: '把 5 段识别结果转成正式笔记',
  },
  en: {
    viewQueue: 'Scan Queue', viewResults: 'Results',
    cmdOpen: 'VisionIndex: Open', cmdScan: 'VisionIndex: Start reading',
    sbTitle: 'Open VisionIndex', sbPending: '{n} pending', sbReady: 'Ready',
    setMaxLabel: 'Images per run (max)', setMaxDesc: 'Hard cap of the budget gate: how many images one run may read (1-500). The rest waits for the next run.',
    setSecLabel: 'Estimated seconds per image', setSecDesc: 'Used only to estimate the budget, never to throttle the real run (1-120).',
    setVaultLabel: 'Absolute vault path (optional)', setVaultDesc: 'Last resort: fill this in only when the host cannot report the vault path and the agent cannot resolve relative paths either. Empty = let the agent use the vault path already in its system prompt.',
    setRetryLabel: 'Retry failed images on rescan', setRetryDesc: 'By default previously failed images are skipped; turn this on to queue them again on every scan.',
    qTitle: 'VisionIndex', qSubtitle: 'Read the text inside your images and store it as notes global search can actually find.',
    introTitle: 'What VisionIndex does', introStep1: '1. Pick the folders to index — it spends your own quota, so it never scans the whole vault on its own.',
    introStep2: '2. Check the budget before you start: how many images and roughly how long, right above the button.',
    introStep3: '3. Every image lands its own markdown sidecar the moment it is read — global search finds the words, one click jumps back to the picture.',
    introHint: 'You can stop any time: everything already read is kept, and the next run picks up where you left off.',
    secFolders: 'Folders to index', secBudget: 'Budget', secRun: 'This run',
    selAll: 'Select all', selNone: 'Clear', rescanMeta: 'Refresh file list', rebuildCache: 'Rebuild cache',
    folderRoot: '(vault root)', folderStat: '{n} images · {d} indexed',
    noFolders: 'No image folders could be listed here. Let the agent scan the vault with the button below, or add a single image by hand.',
    budgetLine: 'This run will read {n} images, about {dur}.',
    budgetCapped: 'Capped at {n} images by the per-run limit — run again to finish the rest.',
    budgetPickFirst: 'Pick at least one folder above to unlock the budget gate.',
    budgetNothing: 'Nothing left to read in the folders you picked.',
    btnStart: 'Start reading', btnStop: 'Stop', btnOpenResults: 'Open results →',
    runProgress: '{i} / {n}', runCurrent: 'Reading: {name}',
    resOk: '{n} chars', resEmpty: 'no text',
    dataAt: 'Sidecars are written to {path} as ordinary markdown you can open as notes.',
    banEnumTitle: 'Nothing to enumerate', banEnumBody: 'This environment returned an empty file list (no vault is open, or the host / web build cannot enumerate). You can still let the agent scan the vault, or add a single image by hand.',
    banBridgeTitle: 'This host build has no file-listing API', banBridgeBody: 'Update the Forsion desktop app to pick folders automatically. Until then you can still add single images by hand through the same pipeline.',
    banVaultTitle: 'The absolute vault path is not available', banVaultBody: 'That is fine: the instruction switches to a vault-relative path and lets the agent resolve it against the vault path already in its system prompt. Fill the setting in only if that fails too.',
    banEngineTitle: 'Not connected to the Forsion engine', banEngineBody: 'Reading images uses the vision pipeline you are already signed in to. Sign in on the Forsion desktop app and come back.',
    banBtnAgentScan: 'Let the agent scan', banBtnManual: 'Add one image', banBtnSettings: 'Where are the settings',
    banSettingsHint: 'Settings → Forsion → Community plugins → VisionIndex: that page holds the absolute vault path, the per-run cap, the per-image estimate and the retry-failed switch.',
    errTooLarge: 'Image over 5MB', errUnsupported: 'Image format the engine cannot read', errNotFound: 'File not found',
    errNoChannel: 'This runtime cannot send images back', errNoFence: 'The model did not reply in the required format', errUnknown: 'Unknown error',
    errStream: 'The connection to the engine dropped before the run finished',
    rSearchPh: 'Search the extracted text…', rSearchLocal: 'Global search returned no hits, so this only matches entries already loaded — the list may be incomplete.',
    rEmptyTitle: 'No results yet',
    rEmptyBody: 'Go to the Scan Queue, tick a folder that holds images, run one batch — results show up here.',
    rGoScan: 'Go to the queue', rCount: '{n} items', rNoHit: 'Nothing matches that search.',
    grpToday: 'Today', grpYesterday: 'Yesterday', grpWeek: 'This week', grpEarlier: 'Earlier',
    actOpenText: 'Open text', actOpenSource: 'Open image', actPromote: 'Promote to note', actRedo: 'Read again', actVerify: 'Verify search',
    verifyOk: 'Global search finds it', verifyNo: 'Global search has not indexed it yet', verifyNA: 'No global search API in this environment',
    noteFrom: 'From',
    notifyPickFolder: 'Pick the folders to index in the Scan Queue first', notifyNoEngine: 'Not connected to the Forsion engine (sign in on the desktop app)',
    notifyDone: 'Batch finished: {ok} with text, {empty} without text, {fail} failed', notifyStopped: 'Stopped — everything already read is kept, you can resume any time',
    notifyPromoteEmpty: 'The extracted text of this entry could not be read (its sidecar may be gone) — no empty note was created',
    notifyRepeatFail: '3 images in a row failed ({code}); this batch was stopped', notifyPromoted: 'Promoted to a note',
    notifyBroke: 'The connection to the engine dropped, so this batch stopped (everything already read is kept, you can resume): {err}',
    notifyRedone: 'Read again', notifyRebuilt: 'Cache rebuilt from the sidecars currently in the vault',
    notifyScanFound: 'The agent found {n} images', notifyScanNone: 'The agent found no readable images',
    promptManual: 'Enter one vault-relative image path (e.g. Attachments/2026/board.png)',
    notifyBadPath: 'Not an indexable image path (png/jpg/jpeg/gif/webp/bmp only, and never inside the work folder)',
    uHour: 'hr', uMin: 'min', uSec: 'sec',
    achSeries: 'VisionIndex', ach1: 'First read', ach1d: 'Extract the text of your first image',
    ach2: 'Hundred', ach2d: 'Extract text from 100 images in total', ach3: 'Kept', ach3d: 'Promote 5 extractions into real notes',
  },
}
const L = () => (ctx.getLocale ? ctx.getLocale() : 'zh')
/** ⚠️ 占位符必须**单趟**正则替换,未知键原样留着。逐个 split/join 是错的:先替进去的值会被后面的
 *  轮次再扫一遍 —— 值里恰好带着另一个占位符(用户把目录命名成 `{d}` 之类)就会被当占位符二次吃掉。 */
function t(k, vars) {
  const d = MSG[L()] || MSG.zh
  const s = d[k] != null ? d[k] : (MSG.zh[k] != null ? MSG.zh[k] : k)
  return vars ? s.replace(/\{(\w+)\}/g, (m, key) => (key in vars ? String(vars[key]) : m)) : s
}

// ══ 小工具 ════════════════════════════════════════════════════════════════════
const say = (m, o) => { if (ctx.notify) ctx.notify(m, o); else if (ctx.app && ctx.app.notify) ctx.app.notify(m) }
const uuid = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`)
const getLS = (k, d) => { try { const v = localStorage.getItem(`plugin.${PLUGIN_ID}.${k}`); return v == null ? d : v } catch { return d } }
const setLS = (k, v) => { try { localStorage.setItem(`plugin.${PLUGIN_ID}.${k}`, String(v)) } catch { /* ignore */ } }
const wfRoot = () => (ctx.app && ctx.app.workFolder ? ctx.app.workFolder() : DEFAULT_WF)
const indexPath = () => `${wfRoot()}/${INDEX_DIR}/index.json`
const numSetting = (key, dflt, lo, hi) => {
  const n = parseInt(getLS(key, String(dflt)), 10)
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt
}
const maxPerRun = () => numSetting('maxPerRun', 50, 1, 500)
const secondsPerImage = () => numSetting('secondsPerImage', 9, 1, 120)
const retryFailed = () => getLS('retryFailed', 'false') === 'true'
const nowIso = () => new Date(Date.now()).toISOString()
function sanitizeFileName(name) {
  return String(name || '').replace(/[\\/:*?"<>|#[\]]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 60) || 'image'
}
const pad2 = (n) => String(n).padStart(2, '0')
function dayKeyOf(ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
/** 纯日历日序(Date.UTC/86400000):不受 DST 影响,只比「第几天」。 */
function daySerialOf(ms) {
  const d = new Date(ms)
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000)
}
const baseNameOf = (p) => String(p || '').split('/').pop() || String(p || '')
const previewOf = (s, n) => {
  const one = String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n) + '…' : one
}

// ══ 纯函数(经文末 __VISIONINDEX_TEST__ 暴露给 check.mjs / probe.mjs)════════

/** 阶梯 ①②④ 的唯一收口:真签名 string[]、Agent 的对象数组、手工补录的单条 —— 全部归一成 {path}[]。
 *  落地签名再变,适配点只有这一个函数。脏输入一律空数组,绝不抛。 */
function normalizeFileList(raw) {
  let arr = raw
  if (arr && !Array.isArray(arr) && typeof arr === 'object') {
    if (Array.isArray(arr.files)) arr = arr.files
    else if (Array.isArray(arr.items)) arr = arr.items
    else if (Array.isArray(arr.paths)) arr = arr.paths
    else arr = null
  }
  if (!Array.isArray(arr)) return []
  const seen = new Set()
  const out = []
  for (const it of arr) {
    let p = ''
    if (typeof it === 'string') p = it
    else if (it && typeof it === 'object') p = it.path || it.relPath || it.name || ''
    p = String(p || '').replace(/\\/g, '/').replace(/^\.\//, '').trim()
    if (!p || seen.has(p)) continue
    seen.add(p)
    out.push({ path: p })
  }
  return out
}

/** 能不能进识别队列。收引擎 IMAGE_MIME 的六种位图(大小写不敏感);
 *  `a.png.md` 是 sidecar 不是图,工作文件夹内的一律不收(不给 sidecar 再建 sidecar)。 */
function isIndexableImage(p, workFolder) {
  const s = String(p == null ? '' : p).replace(/\\/g, '/').trim()
  if (!s) return false
  const low = s.toLowerCase()
  if (low.endsWith('.md')) return false
  if (!IMAGE_EXTS.some((e) => low.endsWith(e))) return false
  const wf = String(workFolder == null ? '' : workFolder).replace(/^\/+|\/+$/g, '')
  if (wf && (s === wf || s.startsWith(wf + '/'))) return false
  return true
}

/** 源图 → sidecar 路径:**保留原后缀再追加 .md**(同名异后缀不撞,且剥掉尾部 .md 即还原源路径)。
 *  路径遍历/绝对路径/工作文件夹内 一律 null(防线,不是兜底)。 */
function sidecarPathFor(src, workFolder) {
  const s = String(src == null ? '' : src).replace(/\\/g, '/').trim()
  const wf = String(workFolder == null ? '' : workFolder).replace(/^\/+|\/+$/g, '') || DEFAULT_WF
  if (!s || s.startsWith('/')) return null
  const segs = s.split('/')
  if (segs.some((x) => x === '..' || x === '.' || x === '')) return null
  if (s === wf || s.startsWith(wf + '/')) return null
  return `${wf}/${SIDECAR_DIR}/${s}.md`
}

/** sidecar 路径 → 源图路径(sidecarPathFor 的逆)。不是本插件的 sidecar → null。 */
function sourceFromSidecar(sidecar, workFolder) {
  const s = String(sidecar == null ? '' : sidecar).replace(/\\/g, '/').trim()
  const wf = String(workFolder == null ? '' : workFolder).replace(/^\/+|\/+$/g, '') || DEFAULT_WF
  const prefix = `${wf}/${SIDECAR_DIR}/`
  if (!s.startsWith(prefix) || !s.toLowerCase().endsWith('.md')) return null
  const src = s.slice(prefix.length, s.length - 3)
  if (!src) return null
  return isIndexableImage(src, wf) ? src : null
}

/** 指纹 = FNV-1a(**源路径字符串**) 的 8 位小写十六进制。
 *  ⚠️ 它**不是内容哈希**:UI 层的 readFile 只吐 UTF-8 文本、listFiles 不给 size/mtime,
 *  内容变更在当前接缝下无法自动检测 —— 如实叫「指纹」,README 里不许吹成「内容变了会自动重识别」。 */
function fpOf(s) {
  const str = String(s == null ? '' : s)
  if (!str) return ''
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    h = Math.imul(h ^ (c & 0xff), 0x01000193) >>> 0
    if (c > 0xff) h = Math.imul(h ^ ((c >>> 8) & 0xff), 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** 取一个围栏块。闭合**只认独占一行的三反引号**(正文里行内的三反引号不算)。
 *  返回 {found, body, closed}:未闭合到 EOF 也算 found,由调用方记 truncated。 */
function takeFence(lines, name) {
  const open = new RegExp('^\\s*```+\\s*' + name + '\\s*$')
  for (let i = 0; i < lines.length; i++) {
    if (!open.test(lines[i])) continue
    const buf = []
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*```+\s*$/.test(lines[j])) return { found: true, body: buf.join('\n'), closed: true }
      buf.push(lines[j])
    }
    return { found: true, body: buf.join('\n'), closed: false }
  }
  return { found: false, body: '', closed: false }
}

const DEFAULT_META = { lang: '', kind: 'other', confidence: 'low' }

/** 解析模型产出。**「解析失败」与「空结果」是两种东西,绝不许合并**:
 *  text 围栏缺席 = ok:false/no-fence(引擎坏了);text 围栏在但内容空 = ok:true/empty(这张图真没字)。 */
function parseVisionOutput(raw) {
  const s = String(raw == null ? '' : raw).replace(/\r\n/g, '\n')
  const lines = s.split('\n')
  const text = takeFence(lines, FENCE_TEXT)
  if (!text.found) return { ok: false, reason: 'no-fence', text: '', empty: true, truncated: false, meta: { ...DEFAULT_META } }
  const metaBlock = takeFence(lines, FENCE_META)
  let meta = { ...DEFAULT_META }
  if (metaBlock.found) {
    try {
      const j = JSON.parse(metaBlock.body.trim())
      if (j && typeof j === 'object') {
        meta = {
          lang: typeof j.lang === 'string' ? j.lang : '',
          kind: typeof j.kind === 'string' && j.kind ? j.kind : 'other',
          confidence: j.confidence === 'high' ? 'high' : 'low',
        }
      }
    } catch { meta = { ...DEFAULT_META } } // 坏 meta 不毁正文
  }
  const body = text.body.replace(/^\n+/, '').replace(/\s+$/, '')
  return { ok: true, text: body, empty: body.length === 0, truncated: !text.closed, meta }
}

/** 失败码。**只吃「模型产出 / view_image 工具报错」这类文本**:兜底 `no-fence` 的语义是
 *  「回复里没有约定围栏 = 模型没按格式答」,把它套到 HTTP/SSE 断链上就是给传输层故障贴模型故障的标签。
 *  错误对象一律走下面的 classifyError,别直接把 e.message 丢进这里。
 *  5MB 口径与引擎 VIEW_IMAGE_MAX_BYTES 同源(常量在本文件顶部,check 断言相等)。 */
function classifyFailure(raw) {
  const s = String(raw == null ? '' : raw).toLowerCase()
  if (!s.trim()) return 'unknown'
  if (s.includes('image too large')) return 'too-large'
  if (s.includes('unsupported image format')) return 'unsupported'
  if (s.includes('file not found')) return 'not-found'
  if (s.includes('cannot display images')) return 'no-channel'
  if (!s.includes(FENCE_TEXT)) return 'no-fence'
  return 'unknown'
}
/** 错误对象 → 失败码。自带 `code` 的(本插件显式抛的)直接用;
 *  否则按文案认 view_image 的四种「这一张读不了」,认不出的一律 **传输层** `stream`,
 *  **绝不**再落回 no-fence(那会把断链说成「模型没按约定格式回复」)。 */
function classifyError(e) {
  const code = e && typeof e === 'object' && typeof e.code === 'string' ? e.code : ''
  if (code) return code
  const c = classifyFailure(String((e && e.message) || e || ''))
  return c === 'no-fence' || c === 'unknown' ? 'stream' : c
}
/** 传输层故障(整批停,当前这张**不落账**)与「这一张读不了」(落账 failed,继续下一张)的分界。 */
const isTransportCode = (code) => code === 'stream' || code === 'no-engine'
const failureLabel = (code) => {
  const map = {
    'too-large': 'errTooLarge', unsupported: 'errUnsupported', 'not-found': 'errNotFound',
    'no-channel': 'errNoChannel', 'no-fence': 'errNoFence', stream: 'errStream', 'no-engine': 'notifyNoEngine',
  }
  return t(map[code] || 'errUnknown')
}

/** 绝对/相对二选一的唯一收口。两版**只差 IMAGE 那一段**,其余逐字相同(check 逐行 diff 断言防漂移)。
 *  发给模型的一切文字一律英文;识别出的正文必须保持原语言,所以这里显式禁止翻译。 */
function buildExtractMessage(o) {
  const abs = o && o.absPath ? String(o.absPath).replace(/\\/g, '/') : ''
  const rel = o && o.relPath ? String(o.relPath).replace(/\\/g, '/') : ''
  const head = abs
    ? [`IMAGE (absolute path): ${abs}`]
    : [`IMAGE (path relative to the Amadeus vault): ${rel}`, 'Resolve it against the Amadeus vault path given in your system prompt.']
  return [
    'You are the text-extraction step of a note-taking app. Your ONLY job is to read the text that',
    'is visibly printed inside one image and transcribe it.',
    '',
  ].concat(head).concat([
    '',
    'Steps:',
    '1. Call view_image with exactly that path.',
    '2. Transcribe every legible piece of text you can see, preserving reading order and line breaks.',
    '',
    'Hard rules:',
    '- Use ONLY the view_image tool. Do NOT read, write, create, move or delete any file.',
    '  Do NOT run shell commands. Do NOT browse the web. Do NOT call any other tool.',
    '- Transcribe verbatim in the ORIGINAL language of the image. Never translate, summarise,',
    '  correct, or comment on the content.',
    '- Do not describe the picture. Text only. If a region is unreadable, skip it silently.',
    '- Reply with the two fenced blocks below and NOTHING else.',
    '',
    '```' + FENCE_META,
    '{"lang":"<ISO 639-1 of the image text, or empty>","kind":"screenshot|scan|photo|diagram|other","confidence":"high|low"}',
    '```',
    '```' + FENCE_TEXT,
    '<the transcribed text, verbatim>',
    '```',
    '',
    'If the image contains no legible text at all, still emit both blocks and leave the text block empty.',
  ]).join('\n')
}

/** 阶梯 ② 的扫库指令:同样死限工具面,只回一个围栏块。 */
function buildScanFilesMessage(o) {
  const abs = o && o.absPath ? String(o.absPath).replace(/\\/g, '/') : ''
  const where = abs
    ? [`SEARCH ROOT (absolute path): ${abs}`]
    : ['SEARCH ROOT: the Amadeus vault.', 'Use the Amadeus vault path given in your system prompt as the root.']
  return [
    'You are the file-discovery step of a note-taking app. Your ONLY job is to list image files.',
    '',
  ].concat(where).concat([
    '',
    'Hard rules:',
    '- Use ONLY glob_files (or list_files) to enumerate. Do NOT open, read, move, write or delete',
    '  any file. Do NOT run shell commands. Do NOT browse the web. Do NOT call any other tool.',
    `- Only these extensions count: ${IMAGE_EXTS.join(' ')}.`,
    '- Skip dot-directories, node_modules, and anything inside the plugin work folder.',
    '- Reply with exactly one fenced block and NOTHING else. It must contain a JSON array of',
    '  vault-relative paths (strings), at most 2000 entries.',
    '',
    '```' + FENCE_FILES,
    '["Attachments/2026/board.png", "Screenshots/receipt.jpg"]',
    '```',
  ]).join('\n')
}

/** 预算闸。空输入 → 全 0 不 capped;N === maxPerRun 是边界,**不**算 capped。 */
function estimateBudget(pending, max, perImage) {
  const list = Array.isArray(pending) ? pending : []
  const cap = Math.max(1, Math.min(500, Math.floor(Number(max) || 50)))
  const per = Math.max(1, Math.min(120, Math.floor(Number(perImage) || 9)))
  const count = Math.min(list.length, cap)
  return { count, seconds: count * per, capped: list.length > cap }
}

/** 时长文案(双语,单位走词表 —— 英文侧永不出现中文量词)。 */
function fmtDuration(sec) {
  const total = Math.max(0, Math.floor(Number(sec) || 0))
  const hh = Math.floor(total / 3600)
  const mm = Math.floor((total % 3600) / 60)
  const ss = total % 60
  const parts = []
  if (hh) parts.push(`${hh} ${t('uHour')}`)
  if (mm) parts.push(`${mm} ${t('uMin')}`)
  if (ss || !parts.length) parts.push(`${ss} ${t('uSec')}`)
  return parts.join(' ')
}

/** 结果分组标签(今天/昨天/本周/更早)。纯日历日序差,跨年天然正确。 */
function groupLabelOf(ms) {
  const at = Number(ms) || 0
  if (!at) return t('grpEarlier')
  const diff = daySerialOf(Date.now()) - daySerialOf(at)
  if (diff <= 0) return t('grpToday')
  if (diff === 1) return t('grpYesterday')
  if (diff < 7) return t('grpWeek')
  return t('grpEarlier')
}

const FM_ORDER = ['visionindex', 'source', 'fp', 'lang', 'kind', 'chars', 'truncated', 'extractedAt']
/** sidecar 序列化:只写文件头那一段 frontmatter,正文原样(正文里的 --- 行不受影响)。 */
function serializeSidecar(fm, body) {
  const o = fm || {}
  const keys = FM_ORDER.filter((k) => o[k] != null && o[k] !== '')
  for (const k of Object.keys(o)) { if (!keys.includes(k) && o[k] != null && o[k] !== '') keys.push(k) }
  const head = keys.map((k) => `${k}: ${String(o[k])}`)
  return ['---'].concat(head).concat(['---', '', String(body == null ? '' : body)]).join('\n')
}
/** sidecar 解析:CRLF 归一;**只吃文件头那一段** frontmatter;没有则 {fm:{}, body:全文}。 */
function parseSidecar(text) {
  const s = String(text == null ? '' : text).replace(/\r\n/g, '\n')
  const lines = s.split('\n')
  if (lines[0] !== '---') return { fm: {}, body: s }
  let end = -1
  for (let i = 1; i < lines.length; i++) { if (lines[i] === '---') { end = i; break } }
  if (end < 0) return { fm: {}, body: s }
  const fm = {}
  for (let i = 1; i < end; i++) {
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(lines[i])
    if (m) fm[m[1]] = m[2].replace(/\s+$/, '')
  }
  let rest = lines.slice(end + 1)
  if (rest.length && rest[0] === '') rest = rest.slice(1)
  return { fm, body: rest.join('\n') }
}

const rootOf = (p) => {
  const s = String(p || '')
  const i = s.indexOf('/')
  return i < 0 ? '' : s.slice(0, i)
}

/** listPages() 里属于本插件的 sidecar → 已识别源图集合(有 sidecar 的图靠 sidecar 自己说话)。 */
function doneSetOf(pages, workFolder) {
  const out = new Set()
  for (const it of normalizeFileList(pages)) {
    const src = sourceFromSidecar(it.path, workFolder)
    if (src) out.add(src)
  }
  return out
}

/** 圈定 + 已识别 → 待识别。roots 为空一律给 [] —— **不做开箱扫全库**,这是范围闸不是优化。 */
function buildPending(files, roots, index, opts) {
  const o = opts || {}
  const wf = o.workFolder || DEFAULT_WF
  const rs = Array.isArray(roots) ? roots.map((x) => String(x == null ? '' : x)) : []
  if (!rs.length) return []
  const entries = (index && index.entries) || {}
  const done = o.done instanceof Set ? o.done : new Set(Array.isArray(o.done) ? o.done : [])
  const out = []
  for (const it of normalizeFileList(files)) {
    const p = it.path
    if (!isIndexableImage(p, wf)) continue
    if (!rs.includes(rootOf(p))) continue
    if (done.has(p)) continue
    const e = entries[p]
    if (e) {
      if (e.st === 'ok' || e.st === 'empty' || e.st === 'promoted' || e.st === 'skipped') continue
      if (e.st === 'failed' && !o.retryFailed) continue
    }
    out.push(p)
  }
  return out
}

/** SSE 行 → 事件对象(不是 data: 行/坏 JSON → null)。 */
function decodeSseLine(line) {
  const s = String(line == null ? '' : line).trim()
  if (!s || s.startsWith(':') || !s.startsWith('data:')) return null
  const data = s.slice(5).replace(/^ /, '')
  if (!data) return null
  try { return JSON.parse(data) } catch { return null }
}

const countChars = (s) => String(s == null ? '' : s).replace(/\s/g, '').length

// ══ 引擎接入(照 bluebird:POST /agent/runs + fetch 读 SSE;不能 EventSource,要 Bearer)══
async function getCfg() {
  try {
    const c = await (globalThis.window && window.tangu && window.tangu.getConfig ? window.tangu.getConfig() : null)
    if (c && c.backendUrl) return { backendUrl: c.backendUrl, token: c.token || '' }
  } catch { /* web 回退 */ }
  try { return { backendUrl: location.origin + '/api', token: localStorage.getItem('forsion_token') || '' } } catch { /* ignore */ }
  return { backendUrl: '', token: '' }
}

/** 一次 run。**每张图一枚新 session_id**(图片会被物化成 user 图像消息留在上下文里,复用 = token 爆炸);
 *  **不传 model_id、不传 agentSlug** —— 视觉能力由引擎 visionService 自动降级,插件永不选模型。 */
async function runAgent(cfg, sessionId, message, signal, cwd) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.token}` }
  const agentConfig = { execMode: 'host' }
  if (cwd) agentConfig.cwd = cwd
  const start = await fetch(`${cfg.backendUrl}/agent/runs`, {
    method: 'POST', headers, signal,
    body: JSON.stringify({ session_id: sessionId, app_id: APP_ID, message, attachments: [], agent_config: agentConfig }),
  })
  if (!start.ok) throw new Error((await start.text().catch(() => '')) || `HTTP ${start.status}`)
  const started = await start.json()
  const runId = started && started.runId
  if (!runId) throw new Error('no runId')
  const res = await fetch(`${cfg.backendUrl}/agent/runs/${encodeURIComponent(runId)}/events?fromSeq=0`, { headers, signal })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let lastSeq = 0
  let content = ''
  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    buf += dec.decode(chunk.value, { stream: true })
    const parts = buf.split('\n')
    buf = parts.pop() || ''
    for (const line of parts) {
      const ev = decodeSseLine(line)
      if (!ev) continue
      if (typeof ev.seq === 'number') { if (ev.seq <= lastSeq) continue; lastSeq = ev.seq }
      if (ev.type === 'token') { const d = ev.payload && ev.payload.delta; if (d) content += d; continue }
      if (ev.type === 'done') return (ev.payload && ev.payload.content) || content
      if (ev.type === 'error') throw new Error((ev.payload && ev.payload.error) || 'run failed')
    }
  }
  if (content) return content
  throw new Error(t('errStream'))
}
/** 测试接缝:check.mjs / probe.mjs 用真管线的指令段,但不必真起 run。 */
let agentRunner = runAgent
const setRunner = (fn) => { agentRunner = typeof fn === 'function' ? fn : runAgent }

/** vault 绝对路径:优先宿主实时值,其次用户手填(阶梯 ③b)。**只在内存里拼给 Agent,绝不落盘。** */
function absVaultRoot() {
  let r = null
  try { r = ctx.app && ctx.app.vaultRoot ? ctx.app.vaultRoot() : null } catch { r = null }
  if (r) return String(r).replace(/[\\/]+$/, '')
  const manual = String(getLS('vaultAbsPath', '') || '').trim()
  return manual ? manual.replace(/[\\/]+$/, '') : ''
}

// ══ 派生缓存(只放状态,绝不放正文;任何时候可仅凭 listFiles+listPages 全量重建)══════
let indexCache = null
let writeChain = Promise.resolve()
function enqueueWrite(job) {
  const p = writeChain.then(job)
  writeChain = p.then(() => {}, () => {})
  return p
}
async function readIndex(force) {
  if (indexCache && !force) return indexCache
  let parsed = null
  try {
    const raw = ctx.app && ctx.app.readFile ? await ctx.app.readFile(indexPath()) : null
    parsed = raw ? JSON.parse(raw) : null
  } catch { parsed = null }
  indexCache = parsed && typeof parsed === 'object' && parsed.entries && typeof parsed.entries === 'object'
    ? { v: 1, builtAt: parsed.builtAt || '', entries: parsed.entries }
    : { v: 1, builtAt: '', entries: {} }
  return indexCache
}
function setEntry(src, patch) {
  return enqueueWrite(async () => {
    const idx = await readIndex(true)
    idx.entries[src] = { ...(idx.entries[src] || {}), ...patch }
    idx.builtAt = nowIso()
    await ctx.app.writeFile(indexPath(), JSON.stringify(idx, null, 2))
    indexCache = idx
    return idx
  })
}
/** 重建缓存:**ok 集合**从库里现有 sidecar 全量重算(不需要 Agent),**非 ok 状态一律合并保留**。
 *  ⚠️ 别改回「整份覆写」:这份缓存的正当性只有一条 —— 记住那些「没有产出 sidecar」的图
 *  (empty / failed / skipped / promoted),而这些信息 `listPages()` 里根本不存在。全量覆写会
 *  ① 把已知无文字的图下次重扫全部重烧一遍额度;② 让 promoted 的「永不再被扫描触碰」当场失效。 */
async function rebuildIndex() {
  const wf = wfRoot()
  const pages = ctx.app && ctx.app.listPages ? await ctx.app.listPages() : []
  const done = doneSetOf(pages, wf)
  return enqueueWrite(async () => {
    const prev = (await readIndex(true)).entries || {}
    const entries = {}
    // ① 有 sidecar 的图靠 sidecar 自己说话 —— 但 at/c 从旧账里接着用,否则全掉进「更早」分组
    for (const src of done) {
      const p = prev[src] || {}
      const e = { fp: fpOf(src), st: 'ok', at: Number(p.at) || 0, sc: sidecarPathFor(src, wf) }
      if (Number(p.c)) e.c = Number(p.c)
      entries[src] = e
    }
    // ② 非 ok 状态覆盖在上面(promoted 的 sidecar 可能还在,但它的语义高于「有 sidecar」)
    for (const k of Object.keys(prev)) {
      const e = prev[k]
      if (e && typeof e === 'object' && e.st && e.st !== 'ok') entries[k] = e
    }
    const idx = { v: 1, builtAt: nowIso(), entries }
    await ctx.app.writeFile(indexPath(), JSON.stringify(idx, null, 2))
    indexCache = idx
    return idx
  })
}

// ══ 识别管线 ═════════════════════════════════════════════════════════════════
/** 落 sidecar。sidecar **整份归机器所有**:重识别 = 整文件覆写(想长期编辑请先「转正式笔记」)。 */
async function writeSidecar(src, text, meta, truncated) {
  const wf = wfRoot()
  const sc = sidecarPathFor(src, wf)
  if (!sc) return null
  const fm = {
    visionindex: '1', source: src, fp: fpOf(src),
    lang: (meta && meta.lang) || '', kind: (meta && meta.kind) || 'other',
    chars: String(countChars(text)),
  }
  if (truncated) fm.truncated = '1'
  fm.extractedAt = nowIso()
  const body = `# ${baseNameOf(src)}\n\n![[${src}]]\n\n${String(text || '')}\n`
  await ctx.app.writeFile(sc, serializeSidecar(fm, body))
  return sc
}

/** 产出 → 落盘 + 记状态。空结果**不写 sidecar**(但要记 st:'empty',否则每次重扫都白烧一遍)。 */
async function applyExtraction(src, raw) {
  const parsed = parseVisionOutput(raw)
  const at = Date.now()
  if (!parsed.ok) {
    const code = classifyFailure(raw)
    await setEntry(src, { fp: fpOf(src), st: 'failed', e: code, at })
    return { st: 'failed', e: code, chars: 0 }
  }
  if (parsed.empty) {
    await setEntry(src, { fp: fpOf(src), st: 'empty', c: 0, at })
    return { st: 'empty', chars: 0 }
  }
  const sc = await writeSidecar(src, parsed.text, parsed.meta, parsed.truncated)
  const chars = countChars(parsed.text)
  await setEntry(src, { fp: fpOf(src), st: 'ok', c: chars, at, sc })
  if (ctx.achievements && ctx.achievements.track) ctx.achievements.track('extract')
  if (ctx.activity && ctx.activity.log) ctx.activity.log('extract', { chars, kind: parsed.meta.kind })
  return { st: 'ok', chars, sc, truncated: parsed.truncated }
}

/** 一张图一条命令线:幂等由「sidecar 已存在就跳过」兑现;force = 用户点了「重新识别」,整文件覆写。 */
async function scanOne(src, signal, force) {
  const wf = wfRoot()
  const sc = sidecarPathFor(src, wf)
  if (!sc) return { st: 'failed', e: 'not-found', chars: 0 }
  if (!force) {
    let existing = null
    try { existing = await ctx.app.readFile(sc) } catch { existing = null }
    if (existing != null) return { st: 'ok', chars: 0, skipped: true, sc }
  }
  const cfg = await getCfg()
  // 没登录 = 传输层还没搭起来,**不是这张图的问题**:带 code 抛出去,绝不落成这张图的 failed
  if (!cfg.backendUrl || !cfg.token) throw Object.assign(new Error(t('notifyNoEngine')), { code: 'no-engine' })
  const abs = absVaultRoot()
  const message = buildExtractMessage(abs ? { absPath: `${abs}/${src}` } : { relPath: src })
  let raw = ''
  try {
    raw = await agentRunner(cfg, uuid(), message, signal, abs || '')
  } catch (e) {
    if (signal && signal.aborted) throw e
    const code = classifyError(e)
    // 引擎把 view_image 的错误当 HTTP 体抛回来时,归类为这一张的失败、继续下一张;
    // 认不出来的(未登录 / HTTP / SSE 断链 / 起 run 失败)是**传输层**故障 —— 往上抛,由 startScan
    // 停整批且**不落账**,否则一条断链会把剩下 49 张全烧成 failed、还永久毒化当前这张。
    if (isTransportCode(code)) throw e
    await setEntry(src, { fp: fpOf(src), st: 'failed', e: code, at: Date.now() })
    return { st: 'failed', e: code, chars: 0 }
  }
  return applyExtraction(src, raw)
}

// ══ 跨视图小总线 + 运行态 ════════════════════════════════════════════════════
const bus = (() => {
  const subs = new Set()
  return { on: (f) => (subs.add(f), () => subs.delete(f)), emit: (e) => subs.forEach((f) => { try { f(e) } catch { /* ignore */ } }) }
})()
/** 「跑到预算闸」这一条焦点信号(命令 → 已挂载的 queue 视图)。声明在 mountQueue **之前**,
 *  免得视图里引用一个还在 TDZ 里的 const —— 宿主哪天改成注册即挂载就当场炸。 */
const focusBus = (() => {
  const subs = new Set()
  return { on: (f) => (subs.add(f), () => subs.delete(f)), emit: () => subs.forEach((f) => { try { f() } catch { /* ignore */ } }) }
})()
const renderers = new Set()
const life = new AbortController()
const run = { active: false, total: 0, doneCount: 0, current: '', rows: [], controller: null, pending: 0, ok: 0, empty: 0, fail: 0 }

function updateStatus() {
  if (!sb || !sb.update) return
  let text
  if (run.active) text = `👁 ${t('runProgress', { i: run.doneCount, n: run.total })}`
  else if (run.pending > 0) text = `👁 ${t('sbPending', { n: run.pending })}`
  else text = `👁 ${t('sbReady')}`
  sb.update({ text, title: t('sbTitle') })
}

const readRootsLS = () => {
  try { const j = JSON.parse(getLS('roots', '[]')); return Array.isArray(j) ? j.map((x) => String(x == null ? '' : x)) : [] } catch { return [] }
}
/** 状态栏的待识别数**不许**绑在 queue 视图的 render 上 —— 状态栏的作用正是「不打开也能看见」,
 *  绑在渲染上 = 用户没开过 queue 就永远显示「已就绪」,哪怕有几百张待识别。 */
async function refreshPendingCount() {
  try {
    const roots = readRootsLS()
    if (!roots.length) { run.pending = 0 } else {
      const wf = wfRoot()
      const files = ctx.app && ctx.app.listFiles ? await ctx.app.listFiles() : null
      const pages = ctx.app && ctx.app.listPages ? await ctx.app.listPages() : []
      const idx = await readIndex(true)
      run.pending = buildPending(files || [], roots, idx, { workFolder: wf, retryFailed: retryFailed(), done: doneSetOf(pages, wf) }).length
    }
  } catch { /* 枚举失败:保留上次的数字,别把「问不到」显示成「没有」 */ }
  updateStatus()
  return run.pending
}

/** 引擎在不在(未登录 = 一张都跑不了)。null = 还没问过。 */
let engineOk = null
async function checkEngine() {
  const cfg = await getCfg()
  engineOk = !!(cfg.backendUrl && cfg.token)
  return engineOk
}

async function startScan(pending) {
  if (run.active) return
  const list = (pending || []).slice(0, maxPerRun())
  if (!list.length) return
  // ⚠️ 前置闸必须在 run.active 置位**之前**:未登录时一张都别发,更别把第一张烧成 failed。
  //    (置位之后再 return = run.active 永远卡在 true,界面只剩一个点不动的「停止」。)
  if (!(await checkEngine())) {
    bus.emit({ type: 'engine' })
    say(t('banEngineBody'), { level: 'warning' })
    return
  }
  const controller = new AbortController()
  Object.assign(run, { active: true, total: list.length, doneCount: 0, current: '', rows: [], controller, ok: 0, empty: 0, fail: 0 })
  bus.emit({ type: 'run' })
  updateStatus()
  let lastCode = ''
  let streak = 0
  let stoppedByFailures = false
  let transportBroke = ''
  for (const src of list) {
    if (controller.signal.aborted) break
    run.current = src
    bus.emit({ type: 'run' })
    let r
    try {
      r = await scanOne(src, controller.signal, false)
    } catch (e) {
      if (controller.signal.aborted) break
      // 未登录 / HTTP / SSE 断链:整批停,**当前这张一个字都不落账**。
      // ⚠️ 别改回 setEntry(…,'failed'):这张图根本没被读过,记 failed 之后默认 retryFailed=false
      //    就意味着「登录之后它再也不会被扫」—— 与提示语「已读完的全部保留,可接着跑」直接矛盾。
      //    不落账 = 它仍在待识别队列里,下次续跑自然轮到它。
      const code = classifyError(e)
      if (code === 'no-engine') engineOk = false
      run.rows.push({ src, st: 'failed', e: code })
      run.fail += 1
      run.doneCount += 1
      transportBroke = String((e && e.message) || e)
      bus.emit({ type: 'run' })
      break
    }
    run.doneCount += 1
    run.rows.push({ src, st: r.st, e: r.e || '', chars: r.chars || 0 })
    if (r.st === 'ok') { run.ok += 1; streak = 0; lastCode = '' }
    else if (r.st === 'empty') { run.empty += 1; streak = 0; lastCode = '' }
    else {
      run.fail += 1
      if (r.e && r.e === lastCode) streak += 1
      else { lastCode = r.e || 'unknown'; streak = 1 }
    }
    updateStatus()
    bus.emit({ type: 'run' })
    if (streak >= 3) { stoppedByFailures = true; break }
  }
  const aborted = controller.signal.aborted
  Object.assign(run, { active: false, current: '', controller: null })
  updateStatus()
  bus.emit({ type: 'run' })
  bus.emit({ type: 'index' })
  if (ctx.activity && ctx.activity.log) ctx.activity.log('scan-done', { ok: run.ok, empty: run.empty, fail: run.fail })
  if (stoppedByFailures) say(t('notifyRepeatFail', { code: failureLabel(lastCode) }), { level: 'error' })
  else if (transportBroke) say(t('notifyBroke', { err: transportBroke.slice(0, 120) }), { level: 'error' })
  else if (aborted) say(t('notifyStopped'), { level: 'info' })
  else say(t('notifyDone', { ok: run.ok, empty: run.empty, fail: run.fail }), { level: run.fail ? 'warning' : 'success' })
}

/** 阶梯 ②:让 Agent 扫库列图片,结果过同一个 normalizeFileList 收口。 */
async function agentScanFiles() {
  const cfg = await getCfg()
  if (!cfg.backendUrl || !cfg.token) { say(t('notifyNoEngine'), { level: 'warning' }); return [] }
  const abs = absVaultRoot()
  let raw = ''
  try {
    // 挂在 life 上:插件被禁用/重载时这条在飞的扫库 run 也要断(disposer 没人代管)
    raw = await agentRunner(cfg, uuid(), buildScanFilesMessage(abs ? { absPath: abs } : {}), life.signal, abs || '')
  } catch (e) {
    say(String((e && e.message) || e), { level: 'error' })
    return []
  }
  const fence = takeFence(String(raw || '').replace(/\r\n/g, '\n').split('\n'), FENCE_FILES)
  let data = null
  if (fence.found) { try { data = JSON.parse(fence.body.trim()) } catch { data = null } }
  const wf = wfRoot()
  const list = normalizeFileList(data)
    .map((x) => ({ path: abs && x.path.startsWith(abs + '/') ? x.path.slice(abs.length + 1) : x.path }))
    .filter((x) => isIndexableImage(x.path, wf))
  if (list.length) say(t('notifyScanFound', { n: list.length }), { level: 'success' })
  else say(t('notifyScanNone'), { level: 'warning' })
  return list.map((x) => x.path)
}

/** 转正式笔记:不带插件 frontmatter,该图此后永不再被扫描触碰(st:'promoted')。 */
async function promoteToNote(src, body) {
  const wf = wfRoot()
  const base = sanitizeFileName(baseNameOf(src).replace(/\.[^.]+$/, ''))
  const day = dayKeyOf(Date.now())
  let p = `${wf}/${NOTES_DIR}/${base}-${day}.md`
  let n = 2
  for (;;) {
    let exists = null
    try { exists = await ctx.app.readFile(p) } catch { exists = null }
    if (exists == null || n > 50) break
    p = `${wf}/${NOTES_DIR}/${base}-${day}-${n}.md`
    n += 1
  }
  await ctx.app.writeFile(p, `${String(body || '').replace(/\s+$/, '')}\n\n> ${t('noteFrom')} [[${src}]]\n`)
  await setEntry(src, { st: 'promoted', at: Date.now() })
  if (ctx.achievements && ctx.achievements.track) ctx.achievements.track('promote')
  return p
}

// ══ 视觉层 ═══════════════════════════════════════════════════════════════════
const STYLE = `
.vi-root{height:100%;min-height:0;display:flex;flex-direction:column;color:inherit;background:var(--bg);font-size:13px;line-height:1.55}
.vi-root *{box-sizing:border-box}
.vi-page{flex:1;min-height:0;overflow:auto;padding:16px 18px 26px;display:flex;flex-direction:column;gap:14px}
.vi-title{font-size:17px;font-weight:600;color:var(--text)}
.vi-sub{font-size:12.5px;color:var(--text-muted,#6f6f6f)}
.vi-card{border:1px solid var(--border,rgba(128,128,128,.34));border-radius:var(--radius-md,12px);background:var(--bg-card,transparent);padding:12px 14px;display:flex;flex-direction:column;gap:8px}
.vi-card.warn{border-color:var(--accent,#7a6cc4)}
.vi-sec{font-size:10.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--text-muted,#6f6f6f)}
.vi-h{font-size:13.5px;font-weight:600;color:var(--text)}
.vi-p{font-size:12.5px;color:var(--text-muted,#6f6f6f)}
.vi-strong{color:var(--text);font-weight:600}
.vi-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.vi-btn{padding:6px 12px;font:inherit;font-size:12.5px;color:var(--text);background:var(--bg-card,transparent);border:1px solid var(--border,rgba(128,128,128,.34));border-radius:var(--radius-sm,9px);cursor:pointer;white-space:nowrap}
.vi-btn:hover:not(:disabled){background:var(--accent-light,rgba(128,128,128,.14))}
.vi-btn:disabled{opacity:.55;cursor:default}
.vi-btn.primary{color:var(--on-accent);background:var(--accent);border-color:transparent;font-weight:500}
.vi-btn.sm{padding:3px 9px;font-size:11.5px;border-radius:7px}
.vi-fold{display:flex;gap:9px;align-items:center;padding:6px 8px;border-radius:9px;cursor:pointer}
.vi-fold:hover{background:var(--accent-light,rgba(128,128,128,.12))}
.vi-fold .nm{flex:1;min-width:0;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vi-fold .st{font-size:11.5px;color:var(--text-muted,#6f6f6f);white-space:nowrap}
.vi-track{height:5px;border-radius:999px;background:var(--border,rgba(128,128,128,.34));overflow:hidden}
.vi-fill{height:100%;width:0;border-radius:999px;background:var(--accent,#7a6cc4);transition:width .35s ease-out}
.vi-log{display:flex;flex-direction:column;gap:2px;max-height:220px;overflow:auto;font-size:12px}
.vi-logrow{display:flex;gap:8px;align-items:baseline}
.vi-logrow .p{flex:1;min-width:0;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vi-logrow .v{color:var(--text-muted,#6f6f6f);white-space:nowrap}
.vi-logrow.bad .v{color:var(--danger,#b03a2e)}
.vi-input{width:100%;padding:7px 11px;font:inherit;font-size:12.5px;color:var(--text);background:var(--bg-card,transparent);border:1px solid var(--border,rgba(128,128,128,.34));border-radius:var(--radius-sm,9px);outline:none}
.vi-item{border:1px solid var(--border,rgba(128,128,128,.34));border-radius:var(--radius-md,12px);padding:10px 12px;display:flex;flex-direction:column;gap:6px;background:var(--bg-card,transparent)}
.vi-item .path{font-size:12.5px;color:var(--text);word-break:break-all}
.vi-item .meta{font-size:11.5px;color:var(--text-muted,#6f6f6f)}
.vi-item .prev{font-size:12px;color:var(--text-muted,#6f6f6f)}
.vi-grp{font-size:11.5px;font-weight:600;color:var(--text-muted,#6f6f6f);margin-top:4px}
.vi-list{display:flex;flex-direction:column;gap:8px}
.vi-ok{color:var(--green,#2e7d4f)}
.vi-bad{color:var(--danger,#b03a2e)}
.vi-line{display:flex;flex-direction:column;gap:3px}
`

const el = (tag, cls, text) => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text != null) n.textContent = String(text)
  return n
}
const btn = (label, cls, onClick) => {
  const b = el('button', 'vi-btn' + (cls ? ' ' + cls : ''), label)
  if (onClick) b.addEventListener('click', onClick)
  return b
}
// 一切模型/用户产出文本都只经上面的 el(tag, cls, text) 走 textContent —— 全文件没有第二条入 DOM 的路,
// 也没有一处 HTML 字符串赋值面(check 的静态扫描把这条钉死)。XSS 断言直接打**真实渲染路径**
// (results 视图渲染一条恶意 sidecar),不再打一个没有调用点的示范函数。

// ══ 视图一:扫描队列 ══════════════════════════════════════════════════════════
function mountQueue(host) {
  host.textContent = ''
  const styleEl = el('style')
  styleEl.textContent = STYLE
  host.appendChild(styleEl)
  const root = el('div', 'vi-root')
  host.appendChild(root)

  const state = {
    files: [], done: new Set(), idx: { entries: {} },
    bridge: !!(ctx.app && ctx.app.listFiles), loaded: false, focusBudget: false,
    engine: engineOk, // null = 还没问过引擎,先不下结论、不画横幅
  }
  const readRoots = readRootsLS
  const writeRoots = (rs) => setLS('roots', JSON.stringify(rs))
  // 运行区的持久节点:运行中每张图会 emit 2-3 次 run 事件,整页重建会把用户正在点的复选框吃掉,
  // 还要把万级 state.files 重扫一遍。进度 tick 只重画这一块。
  let runHost = null
  let paintedActive = null

  function groupsOf() {
    const wf = wfRoot()
    const map = new Map()
    for (const it of state.files) {
      if (!isIndexableImage(it.path, wf)) continue
      const r = rootOf(it.path)
      const g = map.get(r) || { root: r, total: 0, done: 0 }
      g.total += 1
      const e = state.idx.entries[it.path]
      if (state.done.has(it.path) || (e && e.st === 'ok')) g.done += 1
      map.set(r, g)
    }
    return [...map.values()].sort((a, b) => (b.total - a.total) || a.root.localeCompare(b.root))
  }
  function pendingOf() {
    return buildPending(state.files, readRoots(), state.idx, { workFolder: wfRoot(), retryFailed: retryFailed(), done: state.done })
  }

  const canManual = () => !!(ctx.app && ctx.app.prompt)
  /** 四种状态横幅(SPEC「状态横幅四种」)。引擎那条排第一 —— 没登录时后面三条全是白忙:
   *  Agent 扫库要引擎、手动补录跑的也是同一条识别管线。 */
  function bannerOf() {
    if (state.engine === false) return { title: t('banEngineTitle'), body: t('banEngineBody'), acts: ['settings'] }
    if (!state.bridge) return { title: t('banBridgeTitle'), body: t('banBridgeBody'), acts: ['manual', 'settings'] }
    if (state.loaded && !state.files.length) return { title: t('banEnumTitle'), body: t('banEnumBody'), acts: ['agent', 'manual', 'settings'] }
    if (!absVaultRoot()) return { title: t('banVaultTitle'), body: t('banVaultBody'), acts: ['settings'] }
    return null
  }

  async function manualAdd() {
    // 宿主没有输入框接口时上面就不该画出这个按钮;真走到这里也别用「路径不对」这种驴唇不对马嘴的话搪塞
    if (!canManual()) { say(t('banBridgeBody'), { level: 'warning' }); return }
    const v = await ctx.app.prompt(t('promptManual'), '')
    const p = String(v == null ? '' : v).replace(/\\/g, '/').replace(/^\.\//, '').trim()
    if (!p) return
    if (!isIndexableImage(p, wfRoot())) { say(t('notifyBadPath'), { level: 'warning' }); return }
    const known = new Set(state.files.map((x) => x.path))
    if (!known.has(p)) state.files = state.files.concat([{ path: p }])
    const rs = readRoots()
    const r = rootOf(p)
    if (!rs.includes(r)) writeRoots(rs.concat([r]))
    render()
    void startScan([p])
  }

  /** 只重画运行区。**不碰**目录复选框与预算闸,所以运行中点勾选不会被下一个进度 tick 吃掉。 */
  function paintRun() {
    if (!runHost) return
    runHost.textContent = ''
    runHost.appendChild(el('div', 'vi-sec', t('secRun')))
    runHost.appendChild(el('div', 'vi-h', t('runProgress', { i: run.doneCount, n: run.total })))
    const track = el('div', 'vi-track')
    const fill = el('div', 'vi-fill')
    fill.style.width = `${run.total ? Math.round((run.doneCount / run.total) * 100) : 0}%`
    track.appendChild(fill)
    runHost.appendChild(track)
    if (run.active && run.current) runHost.appendChild(el('div', 'vi-p', t('runCurrent', { name: baseNameOf(run.current) })))
    const log = el('div', 'vi-log')
    for (const r of run.rows.slice(-40).reverse()) {
      const lr = el('div', 'vi-logrow' + (r.st === 'failed' ? ' bad' : ''))
      lr.appendChild(el('span', 'p', r.src))
      const mark = r.st === 'ok' ? `✓ ${t('resOk', { n: r.chars })}` : r.st === 'empty' ? `○ ${t('resEmpty')}` : `✕ ${failureLabel(r.e)}`
      lr.appendChild(el('span', 'v', mark))
      log.appendChild(lr)
    }
    runHost.appendChild(log)
  }

  function render() {
    root.textContent = ''
    const page = el('div', 'vi-page')
    root.appendChild(page)

    const head = el('div', 'vi-line')
    head.appendChild(el('div', 'vi-title', t('qTitle')))
    head.appendChild(el('div', 'vi-sub', t('qSubtitle')))
    page.appendChild(head)

    const ban = bannerOf()
    if (ban) {
      const c = el('div', 'vi-card warn')
      c.appendChild(el('div', 'vi-h', ban.title))
      c.appendChild(el('div', 'vi-p', ban.body))
      const row = el('div', 'vi-row')
      if (ban.acts.includes('agent')) {
        row.appendChild(btn(t('banBtnAgentScan'), 'sm', async () => {
          const found = await agentScanFiles()
          if (found.length) {
            const known = new Set(state.files.map((x) => x.path))
            state.files = state.files.concat(found.filter((p) => !known.has(p)).map((p) => ({ path: p })))
            state.loaded = true
          }
          render()
        }))
      }
      // 旧宿主没有 ctx.app.prompt 就别画这个按钮(阶梯 ④ 恰恰是给旧宿主的,画一个点了没反应的更糟)
      if (ban.acts.includes('manual') && canManual()) row.appendChild(btn(t('banBtnManual'), 'sm', () => { void manualAdd() }))
      // 宿主没有「打开某插件设置页」的 ctx 接口 —— 老老实实指路,别装一个点了没反应的按钮。
      if (ban.acts.includes('settings')) row.appendChild(btn(t('banBtnSettings'), 'sm', () => { say(t('banSettingsHint'), { level: 'info', sticky: true }) }))
      c.appendChild(row)
      page.appendChild(c)
    }

    // 圈定目录
    const groups = groupsOf()
    const folders = el('div', 'vi-card')
    const fh = el('div', 'vi-row')
    fh.appendChild(el('div', 'vi-sec', t('secFolders')))
    folders.appendChild(fh)
    if (!groups.length) {
      folders.appendChild(el('div', 'vi-p', t('noFolders')))
    } else {
      const rs = new Set(readRoots())
      for (const g of groups) {
        const rowEl = el('div', 'vi-fold')
        const cb = document.createElement('input')
        cb.setAttribute('type', 'checkbox')
        cb.checked = rs.has(g.root)
        cb.addEventListener('change', () => {
          const cur = new Set(readRoots())
          if (cb.checked) cur.add(g.root); else cur.delete(g.root)
          writeRoots([...cur])
          render()
        })
        rowEl.appendChild(cb)
        rowEl.appendChild(el('span', 'nm', g.root || t('folderRoot')))
        rowEl.appendChild(el('span', 'st', t('folderStat', { n: g.total, d: g.done })))
        folders.appendChild(rowEl)
      }
      const acts = el('div', 'vi-row')
      acts.appendChild(btn(t('selAll'), 'sm', () => { writeRoots(groups.map((g) => g.root)); render() }))
      acts.appendChild(btn(t('selNone'), 'sm', () => { writeRoots([]); render() }))
      acts.appendChild(btn(t('rescanMeta'), 'sm', () => { void refresh(true) }))
      acts.appendChild(btn(t('rebuildCache'), 'sm', async () => { await rebuildIndex(); say(t('notifyRebuilt'), { level: 'success' }); await refresh(true) }))
      folders.appendChild(acts)
    }
    page.appendChild(folders)

    // 预算闸
    const pending = pendingOf()
    run.pending = pending.length
    const budget = el('div', 'vi-card')
    budget.appendChild(el('div', 'vi-sec', t('secBudget')))
    const est = estimateBudget(pending, maxPerRun(), secondsPerImage())
    const hasRoots = readRoots().length > 0
    if (!hasRoots) budget.appendChild(el('div', 'vi-p', t('budgetPickFirst')))
    else if (!est.count) budget.appendChild(el('div', 'vi-p', t('budgetNothing')))
    else {
      budget.appendChild(el('div', 'vi-h', t('budgetLine', { n: est.count, dur: fmtDuration(est.seconds) })))
      if (est.capped) budget.appendChild(el('div', 'vi-p', t('budgetCapped', { n: est.count })))
    }
    const bRow = el('div', 'vi-row')
    if (run.active) bRow.appendChild(btn(t('btnStop'), 'primary', () => { if (run.controller) run.controller.abort() }))
    else {
      const start = btn(t('btnStart'), 'primary', () => { void startScan(pending) })
      start.disabled = !hasRoots || !est.count
      bRow.appendChild(start)
    }
    bRow.appendChild(btn(t('btnOpenResults'), null, () => { if (ctx.openView) ctx.openView('results') }))
    budget.appendChild(bRow)
    budget.appendChild(el('div', 'vi-p', t('dataAt', { path: `${wfRoot()}/${SIDECAR_DIR}/` })))
    page.appendChild(budget)
    if (state.focusBudget) { state.focusBudget = false; if (budget.scrollIntoView) budget.scrollIntoView() }

    // 运行区(内容由 paintRun 填,进度 tick 只重画它一个)
    if (run.active || run.rows.length) {
      runHost = el('div', 'vi-card')
      paintRun()
      page.appendChild(runHost)
    } else runHost = null
    paintedActive = run.active

    // 空态是真内容
    if (!groups.length || !hasRoots) {
      const intro = el('div', 'vi-card')
      intro.appendChild(el('div', 'vi-h', t('introTitle')))
      intro.appendChild(el('div', 'vi-p', t('introStep1')))
      intro.appendChild(el('div', 'vi-p', t('introStep2')))
      intro.appendChild(el('div', 'vi-p', t('introStep3')))
      intro.appendChild(el('div', 'vi-p', t('introHint')))
      page.appendChild(intro)
    }
    updateStatus()
  }

  async function refresh(force) {
    try {
      const wf = wfRoot()
      const files = ctx.app && ctx.app.listFiles ? await ctx.app.listFiles() : null
      if (files) state.files = normalizeFileList(files).filter((x) => isIndexableImage(x.path, wf))
      const pages = ctx.app && ctx.app.listPages ? await ctx.app.listPages() : []
      state.done = doneSetOf(pages, wf)
      state.idx = await readIndex(!!force)
    } catch { /* 枚举失败等同空:降级 UI 已在 banner 里 */ }
    state.loaded = true
    render()
    try { state.engine = await checkEngine() } catch { state.engine = null }
    render()
  }

  render()
  void refresh(false)
  renderers.add(render)
  const offBus = bus.on((e) => {
    if (e.type === 'engine') { state.engine = engineOk; render(); return }
    // 运行中的进度 tick:只重画运行区(整页重建会吃掉用户正在点的复选框)
    if (e.type === 'run' && runHost && paintedActive === run.active) { paintRun(); return }
    if (e.type === 'run' || e.type === 'index') render()
  })
  const offFocus = focusBus.on(() => { state.focusBudget = true; render() })
  return () => { renderers.delete(render); offBus(); offFocus() }
}

// ══ 视图二:识别结果 ══════════════════════════════════════════════════════════
function mountResults(host) {
  host.textContent = ''
  const styleEl = el('style')
  styleEl.textContent = STYLE
  host.appendChild(styleEl)
  const root = el('div', 'vi-root')
  host.appendChild(root)

  const state = { rows: [], query: '', hits: null, bodies: new Map(), verified: new Map(), fallback: false }

  async function load() {
    const wf = wfRoot()
    let pages = []
    try { pages = ctx.app && ctx.app.listPages ? await ctx.app.listPages() : [] } catch { pages = [] }
    const idx = await readIndex(true)
    const seen = new Map()
    for (const src of doneSetOf(pages, wf)) seen.set(src, { src, sc: sidecarPathFor(src, wf), at: 0 })
    for (const src of Object.keys(idx.entries || {})) {
      const e = idx.entries[src]
      if (!e || e.st !== 'ok') continue
      const cur = seen.get(src) || { src, sc: e.sc || sidecarPathFor(src, wf), at: 0 }
      cur.at = Number(e.at) || cur.at
      cur.chars = Number(e.c) || 0
      seen.set(src, cur)
    }
    state.rows = [...seen.values()].sort((a, b) => (b.at || 0) - (a.at || 0))
    render()
    void loadBodies()
  }
  /** 预热**渲染得出来的那一屏**的正文。⚠️ 上限必须与 render 的 MAX_RESULT_ROWS 是同一个常量:
   *  预热 30 条却渲染 60 条,第 31 条起 bodyOf() 恒为空 —— 「转正式笔记」就会转出空壳。 */
  async function loadBodies() {
    for (const r of state.rows.slice(0, MAX_RESULT_ROWS)) await ensureBody(r)
    render()
  }
  /** 按需确保这一条的正文已读。**一切要用正文的动作(转正式笔记 / 验证收录)一律走它**,
   *  绝不依赖预热缓存 —— 预热是异步的,用户在它落地前就能点到按钮(竞态)。 */
  async function ensureBody(r) {
    if (!r || !r.sc) return ''
    if (!state.bodies.has(r.src)) {
      let text = null
      try { text = await ctx.app.readFile(r.sc) } catch { text = null }
      if (text == null) return '' // 读不到就别缓存空串,下次还能再试
      state.bodies.set(r.src, parseSidecar(text).body)
    }
    return state.bodies.get(r.src) || ''
  }
  const bodyOf = (r) => state.bodies.get(r.src) || ''

  async function doSearch(q) {
    state.query = q
    if (!q.trim()) { state.hits = null; state.fallback = false; render(); return }
    const wf = wfRoot()
    let hits = null
    if (ctx.app && ctx.app.searchVault) {
      try {
        const raw = await ctx.app.searchVault(q)
        const prefix = `${wf}/${SIDECAR_DIR}/`
        hits = new Set((raw || []).map((x) => String((x && x.path) || '')).filter((p) => p.startsWith(prefix))
          .map((p) => sourceFromSidecar(p, wf)).filter(Boolean))
      } catch { hits = null }
    }
    if (!hits || !hits.size) {
      // 兜底只看已读入的正文(全库搜索被普通笔记占满时会走到这)。**说出来**,别让用户
      // 把「搜索被截断了」读成「库里没有」。
      state.fallback = true
      const low = q.toLowerCase()
      hits = new Set(state.rows.filter((r) => r.src.toLowerCase().includes(low) || bodyOf(r).toLowerCase().includes(low)).map((r) => r.src))
    } else state.fallback = false
    state.hits = hits
    render()
  }

  async function verify(r) {
    const body = await ensureBody(r)
    const probe = body.replace(/^#[^\n]*\n/, '').replace(/!\[\[[^\]]*\]\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 18)
    if (!(ctx.app && ctx.app.searchVault) || !probe) { state.verified.set(r.src, 'na'); render(); return }
    let ok = false
    try {
      const raw = await ctx.app.searchVault(probe)
      ok = (raw || []).some((x) => String((x && x.path) || '') === r.sc)
    } catch { ok = false }
    state.verified.set(r.src, ok ? 'ok' : 'no')
    render()
  }

  function render() {
    root.textContent = ''
    const page = el('div', 'vi-page')
    root.appendChild(page)

    const head = el('div', 'vi-line')
    head.appendChild(el('div', 'vi-title', t('viewResults')))
    head.appendChild(el('div', 'vi-sub', t('rCount', { n: state.rows.length })))
    page.appendChild(head)

    const search = document.createElement('input')
    search.className = 'vi-input'
    search.setAttribute('type', 'text')
    search.setAttribute('placeholder', t('rSearchPh'))
    search.value = state.query
    // 每次敲字就把值记进 state:整树重渲(切语言 / 索引变更)时用户还没回车的那半句才活得下来
    search.addEventListener('input', () => { state.query = search.value })
    search.addEventListener('keydown', (ev) => { if (ev && ev.key === 'Enter') void doSearch(search.value) })
    search.addEventListener('change', () => { void doSearch(search.value) })
    page.appendChild(search)

    if (!state.rows.length) {
      const empty = el('div', 'vi-card')
      empty.appendChild(el('div', 'vi-h', t('rEmptyTitle')))
      empty.appendChild(el('div', 'vi-p', t('rEmptyBody')))
      const row = el('div', 'vi-row')
      row.appendChild(btn(t('rGoScan'), 'primary', () => { if (ctx.openView) ctx.openView('queue') }))
      empty.appendChild(row)
      page.appendChild(empty)
      page.appendChild(el('div', 'vi-p', t('dataAt', { path: `${wfRoot()}/${SIDECAR_DIR}/` })))
      return
    }

    const shown = state.hits ? state.rows.filter((r) => state.hits.has(r.src)) : state.rows
    if (state.hits && state.fallback) page.appendChild(el('div', 'vi-p', t('rSearchLocal')))
    if (!shown.length) { page.appendChild(el('div', 'vi-p', t('rNoHit'))); return }
    const list = el('div', 'vi-list')
    let group = ''
    for (const r of shown.slice(0, MAX_RESULT_ROWS)) {
      const g = groupLabelOf(r.at)
      if (g !== group) { group = g; list.appendChild(el('div', 'vi-grp', g)) }
      const item = el('div', 'vi-item')
      item.appendChild(el('div', 'path', r.src))
      const v = state.verified.get(r.src)
      const metaText = v === 'ok' ? t('verifyOk') : v === 'no' ? t('verifyNo') : v === 'na' ? t('verifyNA') : t('resOk', { n: r.chars || countChars(bodyOf(r)) })
      const meta = el('div', 'meta' + (v === 'ok' ? ' vi-ok' : ''), metaText)
      item.appendChild(meta)
      const prev = previewOf(bodyOf(r).replace(/^#[^\n]*\n/, '').replace(/!\[\[[^\]]*\]\]/g, ''), PREVIEW_CHARS)
      if (prev) item.appendChild(el('div', 'prev', prev))
      const acts = el('div', 'vi-row')
      acts.appendChild(btn(t('actOpenText'), 'sm', () => { if (ctx.app && ctx.app.openFile && r.sc) ctx.app.openFile(r.sc) }))
      acts.appendChild(btn(t('actOpenSource'), 'sm', () => { if (ctx.app && ctx.app.openFile) ctx.app.openFile(r.src) }))
      acts.appendChild(btn(t('actPromote'), 'sm', async () => {
        // 空正文绝不转出:转出的是用户以为自己留住的那段字,而 promoteToNote 会把这张图记成
        // promoted(此后永不再被扫描触碰)—— 转一个空壳出去等于把这段字永久弄丢。
        const body = await ensureBody(r)
        if (!body.trim()) { say(t('notifyPromoteEmpty'), { level: 'warning' }); return }
        const p = await promoteToNote(r.src, body)
        say(t('notifyPromoted'), { level: 'success' })
        if (ctx.app && ctx.app.openFile) ctx.app.openFile(p)
        void load()
      }))
      acts.appendChild(btn(t('actRedo'), 'sm', async () => {
        try {
          await scanOne(r.src, life.signal, true) // 单张重识别也挂 life:禁用插件时这条 run 要断
          say(t('notifyRedone'), { level: 'success' })
          state.bodies.delete(r.src)
          void load()
        } catch (e) { say(String((e && e.message) || e), { level: 'error' }) }
      }))
      acts.appendChild(btn(t('actVerify'), 'sm', () => { void verify(r) }))
      item.appendChild(acts)
      list.appendChild(item)
    }
    page.appendChild(list)
  }

  render()
  void load()
  renderers.add(render)
  const offBus = bus.on((e) => { if (e.type === 'index') void load() })
  return () => { renderers.delete(render); offBus() }
}

// ══ 注册 ═════════════════════════════════════════════════════════════════════
ctx.registerSetting({ key: 'maxPerRun', label: t('setMaxLabel'), type: 'number', default: 50, min: 1, max: 500, description: t('setMaxDesc') })
ctx.registerSetting({ key: 'secondsPerImage', label: t('setSecLabel'), type: 'number', default: 9, min: 1, max: 120, description: t('setSecDesc') })
ctx.registerSetting({ key: 'vaultAbsPath', label: t('setVaultLabel'), type: 'text', default: '', description: t('setVaultDesc') })
ctx.registerSetting({ key: 'retryFailed', label: t('setRetryLabel'), type: 'boolean', default: false, description: t('setRetryDesc') })

if (ctx.registerView) {
  ctx.registerView({ id: 'queue', title: t('viewQueue'), mount: mountQueue, singleton: true })
  ctx.registerView({ id: 'results', title: t('viewResults'), mount: mountResults, singleton: true })
}
ctx.registerCommand({
  id: 'visionindex-open', title: t('cmdOpen'), keywords: 'visionindex 视觉索引 ocr 图片 截图 image text search',
  run: () => { if (ctx.openView) ctx.openView('queue'); else say(t('banBridgeBody'), { level: 'warning' }) },
})
ctx.registerCommand({
  id: 'visionindex-scan', title: t('cmdScan'), keywords: 'visionindex 视觉索引 扫描 识别 scan extract ocr',
  run: () => {
    const roots = readRootsLS()
    if (ctx.openView) ctx.openView('queue')
    if (!roots.length) say(t('notifyPickFolder'), { level: 'warning' })
    else focusBus.emit()
  },
})
const sb = ctx.registerStatusItem ? ctx.registerStatusItem({ id: 'status', side: 'right', text: '👁 —', title: t('sbTitle'), onClick: () => { if (ctx.openView) ctx.openView('queue') } }) : null
if (ctx.achievements && ctx.achievements.registerSeries) {
  ctx.achievements.registerSeries({
    id: 'visionindex', title: t('achSeries'),
    achievements: [
      { id: 'first', title: t('ach1'), desc: t('ach1d'), event: 'extract', goal: 1, points: 10 },
      { id: 'hundred', title: t('ach2'), desc: t('ach2d'), event: 'extract', goal: 100, points: 30 },
      { id: 'promote5', title: t('ach3'), desc: t('ach3d'), event: 'promote', goal: 5, points: 20 },
    ],
  })
}

// 状态栏的待识别数**不绑在 queue 视图的 render 上**:状态栏的作用正是「不打开也能看见」。
// 装载时先算一次,之后每次索引变更(一批跑完 / 重建缓存 / 单张重识别)再算一次。
// ⚠️ 必须写在 `const sb` **之后** —— refreshPendingCount 末尾同步调 updateStatus(),
//    roots 为空的分支一个 await 都不走,提前调用会撞上 sb 的 TDZ。
const offBusStatus = bus.on((e) => { if (e.type === 'index') void refreshPendingCount() })
void refreshPendingCount()

// 语言切换:原地重渲已挂载的视图(**不重挂、不重注册** —— 重注册会打断正在跑的识别队列)。
const offLocale = ctx.subscribeLocale ? ctx.subscribeLocale(() => {
  for (const r of [...renderers]) { try { r() } catch { /* ignore */ } }
  updateStatus()
}) : null
life.signal.addEventListener('abort', () => { if (run.controller) run.controller.abort() })

// ── check.mjs / probe.mjs 测试钩子 ──
if (globalThis.__VISIONINDEX_TEST__) {
  Object.assign(globalThis.__VISIONINDEX_TEST__, {
    MSG, t, L, VIEW_IMAGE_MAX_BYTES, IMAGE_EXTS,
    normalizeFileList, isIndexableImage, sidecarPathFor, sourceFromSidecar, fpOf,
    parseVisionOutput, classifyFailure, failureLabel, buildExtractMessage, buildScanFilesMessage,
    estimateBudget, fmtDuration, groupLabelOf, serializeSidecar, parseSidecar, takeFence,
    buildPending, rootOf, doneSetOf, decodeSseLine, previewOf, sanitizeFileName,
    dayKeyOf, daySerialOf, countChars, readIndex, setEntry, rebuildIndex, applyExtraction,
    scanOne, promoteToNote, startScan, setRunner, absVaultRoot, wfRoot, life, run, bus,
    runAgent, getCfg, uuid, writeSidecar, indexPath, classifyError, refreshPendingCount,
  })
}

return () => {
  life.abort()
  if (run.controller) run.controller.abort()
  if (offLocale) offLocale()
  offBusStatus()
  if (sb && sb.dispose) sb.dispose()
  renderers.clear()
}
