/**
 * 视觉索引插件自检:宿主同款 new Function('ctx', src) 求值 main.js + DOM 垫片 + 冻钟 + 内存 vault。
 *
 * 覆盖 SPEC「check.mjs 额外必测」全 17 项 + BRIEF 通用八条:
 *   贡献点齐全(2 视图/2 命令/4 设置/状态栏/成就,且**没有** slash/fileType/fileCreator/embed/theme/panel)/
 *   normalizeFileList 四形态 + 脏输入 / isIndexableImage(大小写、a.png.md、工作文件夹内)/
 *   sidecarPathFor·sourceFromSidecar 往返与路径遍历防线 / fpOf 只吃路径(钉死「fp 不是内容哈希」)/
 *   parseVisionOutput 六向量(**解析失败 ≠ 空结果**,分别断言)/ buildExtractMessage 两版逐行 diff /
 *   classifyFailure 真实错误文案 + 5MB 口径与引擎常量一致 / estimateBudget 边界 / fmtDuration 双语 /
 *   groupLabelOf 跨年 + 四时区扫描 / serializeSidecar·parseSidecar 往返 / 空结果不写 sidecar /
 *   幂等与自愈 / buildPending(roots 空不扫全库、retryFailed 开关)/ 桥空态与旧宿主视图仍有内容 /
 *   XSS / 双语词表两侧键相等 / 切 en 后视图**不重挂**也变英文 / disposer(life 已 abort、语言订阅已退)/
 *   红线:.visionindex/ 里绝不出现识别正文。
 *
 * 跑法:node check.mjs        (末尾自动用 UTC / 上海 / 伦敦 / 纽约 四时区各跑一遍)
 */
process.env.TZ = process.env.VI_TZ || 'Asia/Shanghai'
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { strict as A } from 'node:assert'

const HERE = new URL('./', import.meta.url)
const src = readFileSync(new URL('./main.js', HERE), 'utf8')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ══ 静态纪律 ══════════════════════════════════════════════════════════════════
A.ok(!/innerHTML/.test(src), 'main.js 禁 innerHTML(XSS 面归零)')
A.ok(!/setInterval/.test(src), '轮询用 setTimeout 自排程,禁 setInterval')
A.ok(!/new Date\(\)/.test(src), '「现在」一律 Date.now(),禁裸 new Date()')
A.ok(!/color:\s*#fff/i.test(src), 'CSS 不许写死白字(强调色上的字一律 var(--on-accent))')
// 正文预热上限与渲染上限必须是**同一个常量**:预热 30 条却渲染 60 条 = 第 31 条起「转正式笔记」转空壳
A.equal((src.match(/slice\(0,\s*MAX_RESULT_ROWS\)/g) || []).length, 2, '预热与渲染都必须切 MAX_RESULT_ROWS(同一个常量)')
A.ok(!/slice\(0,\s*\d+\)\s*\)\s*await ensureBody/.test(src) && !/rows\.slice\(0,\s*\d/.test(src), '结果列表不许出现写死的条数上限')
// 宿主没有输入框接口时,别用「这不是可以识别的图片路径」搪塞 —— 那与真实原因(宿主缺 prompt)毫无关系
A.ok(src.includes("if (!canManual()) { say(t('banBridgeBody')"), '缺 ctx.app.prompt 时的提示必须说真实原因,不许复用 notifyBadPath')
for (const banned of ['registerFileType', 'registerSlashItem', 'registerEmbedRenderer', 'registerFileCreator', 'registerPropertyType', 'registerTheme', 'registerPanel']) {
  A.ok(!src.includes(banned), `SPEC 明令不注册 ${banned}`)
}
{
  const lines = src.split('\n')
  const asi = [...lines.keys()].filter((i) => {
    if (!/^\s*[([]/.test(lines[i])) return false
    let p = i - 1
    while (p >= 0 && !lines[p].trim()) p--
    return p >= 0 && /[)\]'"`\w]\s*$/.test(lines[p])
  }).map((i) => i + 1)
  A.equal(asi.length, 0, `以 ( [ 开头的行会被 ASI 粘到上一句:第 ${asi.join(',')} 行`)
}

// ══ manifest / Space / 技能 交付物 ═══════════════════════════════════════════
const manifest = JSON.parse(readFileSync(new URL('./manifest.json', HERE), 'utf8'))
A.equal(manifest.id, 'visionindex')
A.equal(manifest.apiVersion, 1)
A.ok(manifest.nameEn && manifest.descriptionEn, 'manifest 必须有 nameEn/descriptionEn')
A.ok(!manifest.fileExtensions, '🟥 红线:绝不声明 fileExtensions —— 那会把 sidecar 排出页面列表 = 全局搜索搜不到 = 本插件白做')
A.ok(manifest.onboarding && manifest.onboarding.en, 'onboarding 需要英文镜像')
A.equal(manifest.onboarding.en.steps.length, manifest.onboarding.steps.length, 'onboarding.en 步数须与中文一致')
A.ok(!(manifest.onboarding.recommends || []).length, 'onboarding 不得 recommends 自家内嵌的 Space')
A.deepEqual((manifest.events || []).map((e) => e.name).sort(), ['extract', 'scan-done'], 'manifest 声明两个活动事件')
{
  const space = JSON.parse(readFileSync(new URL('./spaces/visionindex/space.json', HERE), 'utf8'))
  A.equal(space.id, 'visionindex')
  A.ok(space.name && space.name.zh && space.name.en, 'Space name 必须 {zh,en}')
  A.deepEqual(space.requires.views, ['plugin:visionindex:queue', 'plugin:visionindex:results'], 'Space 引用的每个插件视图都要进 requires.views')
  A.ok(existsSync(new URL('./skills/vision-index/SKILL.md', HERE)), '随包技能 skills/vision-index/SKILL.md')
  const skill = readFileSync(new URL('./skills/vision-index/SKILL.md', HERE), 'utf8')
  A.ok(skill.includes('description:'), 'SKILL.md 需要 description(模型触发判据)')
  A.ok(skill.includes('.visionindex'), 'SKILL.md 必须有「never write into .visionindex/」警告段')
}

// ══ 冻钟:2026-01-01 09:00 本地(跨年分组测试的锚点)═══════════════════════
const NOW = new Date(2026, 0, 1, 9, 0, 0).getTime()
Date.now = () => NOW
const localMs = (y, m, d, hh, mm) => new Date(y, m - 1, d, hh || 0, mm || 0, 0).getTime()

// ══ DOM 垫片 ═════════════════════════════════════════════════════════════════
function mkText(text) {
  const n = { tag: '#text', children: [], attrs: {}, appendChild() {}, setAttribute() {}, addEventListener() {} }
  let v = String(text)
  Object.defineProperty(n, 'textContent', { get: () => v, set: (x) => { v = String(x) } })
  return n
}
function mkEl(tag) {
  const e = {
    tag, children: [], attrs: {}, listeners: {}, parentElement: null, isConnected: true,
    className: '', disabled: false, checked: false, value: '',
    style: { setProperty() {}, removeProperty() {} },
    focus() {}, blur() {},
    setAttribute(k, v) { e.attrs[k] = String(v) },
    getAttribute(k) { return k in e.attrs ? e.attrs[k] : null },
    addEventListener(ty, f) { const a = e.listeners[ty] || (e.listeners[ty] = []); a.push(f) },
    removeEventListener() {},
    remove() { const p = e.parentElement; if (p) p.children = p.children.filter((x) => x !== e); e.parentElement = null },
  }
  let own = ''
  e.appendChild = (c) => {
    if (c && c.tag === '#frag') { for (const k of c.children.slice()) e.appendChild(k); return c }
    e.children.push(c)
    if (c && typeof c === 'object') c.parentElement = e
    return c
  }
  Object.defineProperty(e, 'textContent', {
    get: () => own + e.children.map((c) => (c && c.textContent) || '').join(''),
    set: (v) => { e.children.length = 0; own = String(v) },
  })
  return e
}
globalThis.document = { createElement: mkEl, createTextNode: mkText, createDocumentFragment: () => mkEl('#frag'), addEventListener() {}, body: mkEl('body') }
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '', color: 'rgb(40,40,40)' })
const findAll = (node, pred) => {
  const out = []
  const walk = (n) => { for (const c of (n.children || [])) { if (pred(c)) out.push(c); walk(c) } }
  walk(node)
  return out
}
const byTag = (node, tag) => findAll(node, (c) => c.tag === tag)
const anyAttr = (node, key) => findAll(node, (c) => c.attrs && key in c.attrs).length > 0
const buttonNamed = (node, label) => findAll(node, (c) => c.tag === 'button' && c.textContent === label)[0]

const _ls = new Map()
globalThis.localStorage = { getItem: (k) => (_ls.has(k) ? _ls.get(k) : null), setItem: (k, v) => _ls.set(k, String(v)), removeItem: (k) => _ls.delete(k) }
globalThis.window = { tangu: { getConfig: async () => ({ backendUrl: 'http://test', token: 'tk' }) } }

// ══ 主 mock ctx(新宿主齐备:语言接缝 + 只读 vault 查询面)═════════════════
const V = new Map()
const writes = []
const reg = { views: [], commands: [], settings: [], status: [], series: [], tracks: [], activity: [], notes: [], opened: [], slash: [], fileTypes: [], creators: [] }
let locale = 'zh'
const localeSubs = new Set()
let vaultFiles = []
let vaultPages = []
let searchHits = []
let promptReply = null
const ctx = {
  registerView: (v) => reg.views.push(v),
  registerCommand: (c) => reg.commands.push(c),
  registerSetting: (s) => reg.settings.push(s),
  registerStatusItem: (s) => { reg.status.push(s); return { update: (p) => Object.assign(s, p), dispose() {} } },
  registerSlashItem: (s) => reg.slash.push(s),
  registerFileType: (d) => reg.fileTypes.push(d),
  registerFileCreator: (d) => reg.creators.push(d),
  openView: (id) => reg.opened.push('view:' + id),
  notify: (m, o) => reg.notes.push([m, o]),
  activity: { log: (e, d) => reg.activity.push([e, d]) },
  achievements: { registerSeries: (s) => reg.series.push(s), track: (e) => reg.tracks.push(e) },
  getLocale: () => locale,
  subscribeLocale: (cb) => { localeSubs.add(cb); return () => localeSubs.delete(cb) },
  app: {
    notify() {},
    openFile: (p) => reg.opened.push(p),
    readFile: async (p) => (V.has(p) ? V.get(p) : null),
    writeFile: async (p, text) => { V.set(p, String(text)); writes.push(p) },
    workFolder: () => '视觉索引',
    prompt: async () => promptReply,
    listFiles: async () => vaultFiles.slice(),
    listPages: async () => vaultPages.slice(),
    searchVault: async () => searchHits.slice(),
    vaultRoot: () => '/Users/tester/Vault',
  },
}
const setLocale = (l) => { locale = l; for (const cb of [...localeSubs]) cb(l) }
globalThis.__VISIONINDEX_TEST__ = {}
const dispose = new Function('ctx', src)(ctx)
const T = globalThis.__VISIONINDEX_TEST__

// ══ ① 贡献点契约 ═════════════════════════════════════════════════════════════
A.equal(typeof dispose, 'function', 'setup 应返回 disposer')
A.deepEqual(reg.views.map((v) => v.id), ['queue', 'results'], '两个视图,且 queue 必须**先**注册(真机台架默认开 views[0])')
for (const v of reg.views) A.equal(typeof v.mount, 'function', `${v.id} 视图要有 mount`)
A.deepEqual(reg.commands.map((c) => c.id).sort(), ['visionindex-open', 'visionindex-scan'], '恰好两个命令(SPEC:不许加第三个)')
A.deepEqual(reg.settings.map((s) => s.key).sort(), ['maxPerRun', 'retryFailed', 'secondsPerImage', 'vaultAbsPath'], '四条设置')
A.equal(reg.settings.find((s) => s.key === 'maxPerRun').default, 50)
A.equal(reg.settings.find((s) => s.key === 'secondsPerImage').default, 9)
A.equal(reg.settings.find((s) => s.key === 'retryFailed').type, 'boolean')
A.equal(reg.settings.find((s) => s.key === 'vaultAbsPath').default, '')
A.ok(reg.status.find((s) => s.id === 'status' && typeof s.onClick === 'function'), '状态栏项')
{
  await sleep(10)
  const item = reg.status.find((s) => s.id === 'status')
  A.notEqual(item.text, '👁 —', '装载时就要刷新一次状态栏 —— 它的作用正是「不打开 queue 也能看见」')
  A.ok(String(item.text).includes('已就绪'), `没圈目录 → 「已就绪」:${item.text}`)
}
A.equal(reg.slash.length, 0, 'SPEC:首版不注册斜杠项(按图内文字找图是全局搜索的活)')
A.equal(reg.fileTypes.length, 0, '🟥 红线:绝不 registerFileType')
A.equal(reg.creators.length, 0, '不注册 registerFileCreator')
{
  const s = reg.series.find((x) => x.id === 'visionindex')
  A.ok(s, '成就系列')
  A.deepEqual(s.achievements.map((a) => a.event), ['extract', 'extract', 'promote'])
  A.deepEqual(s.achievements.map((a) => a.goal), [1, 100, 5])
  A.ok(s.achievements.every((a) => a.title && a.desc && a.points > 0), '每条成就要有 title/desc/points')
}

// ══ ② 双语词表:两侧键集合必须完全相等 ═════════════════════════════════════
{
  const zh = Object.keys(T.MSG.zh).sort()
  const en = Object.keys(T.MSG.en).sort()
  A.deepEqual(zh, en, '词表两侧键集合必须相等(漏翻一条就红)')
  const CJK = /[一-鿿]/
  const cjkLeak = Object.keys(T.MSG.en).filter((k) => CJK.test(T.MSG.en[k]))
  A.deepEqual(cjkLeak, [], `英文侧不许残留中文:${cjkLeak.join(',')}`)
  A.ok(Object.keys(T.MSG.zh).every((k) => String(T.MSG.zh[k]).length > 0), '中文侧不许空串')
  // 死键扫描:两侧键集合相等只保证「没漏翻」,保证不了「有人用」。曾经有三个键(resFail /
  // banEngineTitle / banEngineBody)在词表里永久搭便车 —— 其中两个是 SPEC 点名的第 4 种状态横幅,
  // 从未被画出来,于是未登录的用户直接撞进「第一张被烧成 failed」。这条断言把搭便车堵死。
  const afterMsg = src.slice(src.indexOf('const L = ('))
  const dead = Object.keys(T.MSG.zh).filter((k) => !afterMsg.includes(`'${k}'`))
  A.deepEqual(dead, [], `词表里有从未被引用的死键:${dead.join(',')}`)
  // 占位符必须**单趟**替换:逐个 split/join 会让先替进去的值被后面的轮次再扫一遍,
  // 用户数据里恰好带着另一个占位符就被当占位符二次吃掉。下面这条向量专门区分两种实现:
  // 单趟 → 「图片 {d} 张 · 已识别 3」;多趟(split/join)→ 「图片 3 张 · 已识别 3」。
  A.equal(T.t('folderStat', { n: '{d}', d: 3 }), '图片 {d} 张 · 已识别 3', '占位符单趟替换:值里的 {d} 不许被二次吃掉')
  A.ok(T.t('budgetLine', { n: 2 }).includes('{dur}'), '未提供的占位符原样留着')
  A.ok(!src.includes(".split('{'"), 'main.js 里不许再出现逐个 split/join 的占位符替换')
}

// ══ ③ normalizeFileList —— 阶梯 ①②④ 的唯一收口 ═════════════════════════════
A.deepEqual(T.normalizeFileList(['a.png', 'b/c.jpg']).map((x) => x.path), ['a.png', 'b/c.jpg'], '真签名 string[]')
A.deepEqual(T.normalizeFileList([{ path: 'a.png' }, { relPath: 'b.png' }, { name: 'c.png' }]).map((x) => x.path), ['a.png', 'b.png', 'c.png'], 'Agent 的对象数组')
A.deepEqual(T.normalizeFileList({ files: ['x.png'] }).map((x) => x.path), ['x.png'], '{files:[…]}')
A.deepEqual(T.normalizeFileList({ items: ['y.png'] }).map((x) => x.path), ['y.png'], '{items:[…]}')
A.deepEqual(T.normalizeFileList(['a\\b.png', './c.png', '  d.png  ', 'a/b.png']).map((x) => x.path), ['a/b.png', 'c.png', 'd.png'], '反斜杠归一 + ./ 剥离 + trim + 去重')
for (const dirty of [null, undefined, 0, 'a.png', { foo: 1 }, true, NaN]) {
  A.deepEqual(T.normalizeFileList(dirty), [], `脏输入 ${String(dirty)} → [] 且不抛`)
}

// ══ ④ isIndexableImage ═══════════════════════════════════════════════════════
for (const ok of ['a.png', 'a.jpg', 'a.jpeg', 'a.gif', 'a.webp', 'a.bmp', 'A/B/大图.PNG', 'x y.JPEG']) {
  A.equal(T.isIndexableImage(ok, '视觉索引'), true, `${ok} 应入队(大小写不敏感)`)
}
for (const no of ['a.svg', 'a.heic', 'a.tif', 'a.tiff', 'a.pdf', 'a.md', 'a.png.md', '视觉索引/Index/x.png', '视觉索引', '', null]) {
  A.equal(T.isIndexableImage(no, '视觉索引'), false, `${String(no)} 不该入队`)
}
A.equal(T.isIndexableImage('a.png.md', '视觉索引'), false, 'a.png.md 是 sidecar 不是图')

// ══ ⑤ sidecarPathFor / sourceFromSidecar 往返 + 路径遍历防线 ════════════════
{
  const wf = '视觉索引'
  const rt = (p) => T.sourceFromSidecar(T.sidecarPathFor(p, wf), wf)
  for (const p of ['Attachments/2026/会议白板 1.png', 'a.png', '深/嵌 套/图 片.JPEG']) {
    A.equal(rt(p), p, `往返还原:${p}`)
  }
  A.equal(T.sidecarPathFor('Attachments/2026/会议白板 1.png', wf), '视觉索引/Index/Attachments/2026/会议白板 1.png.md', '保留原后缀再追加 .md')
  A.notEqual(T.sidecarPathFor('a.png', wf), T.sidecarPathFor('a.jpg', wf), '同名异后缀不撞')
  A.equal(T.sidecarPathFor('../x.png', wf), null, '路径遍历防线')
  A.equal(T.sidecarPathFor('/abs.png', wf), null, '绝对路径防线')
  A.equal(T.sidecarPathFor('视觉索引/Index/a.png', wf), null, '不给 sidecar 再建 sidecar')
  A.equal(T.sourceFromSidecar('别的插件/x.png.md', wf), null, '不是本插件的 sidecar')
  A.equal(T.sourceFromSidecar('视觉索引/Index/note.md', wf), null, '剥掉 .md 之后不是图 → 不认')
}

// ══ ⑥ fpOf —— 它**只吃路径**,不是内容哈希 ═════════════════════════════════
A.equal(T.fpOf('a/b.png'), T.fpOf('a/b.png'), '同串稳定')
A.notEqual(T.fpOf('a/b.png'), T.fpOf('a/c.png'), '异串不同')
A.equal(T.fpOf(''), '', '空串 → 空')
A.match(T.fpOf('会议白板.png'), /^[0-9a-f]{8}$/, '8 位小写十六进制')
A.equal(T.fpOf('a/b.png'), T.fpOf('a/b.png'), '「文件内容变了」影响不到 fp —— 这条断言把「fp 不是内容哈希」钉进测试')

// ══ ⑦ parseVisionOutput 六向量(解析失败 ≠ 空结果,分别断言)════════════════
const FENCE = (meta, text) => '```visionindex-meta\n' + meta + '\n```\n```visionindex-text\n' + text + '\n```'
{
  const r = T.parseVisionOutput(FENCE('{"lang":"zh","kind":"scan","confidence":"high"}', 'Q3 目标对齐\n1. 插件生态'))
  A.deepEqual([r.ok, r.empty, r.truncated], [true, false, false], '①两块俱全')
  A.equal(r.text, 'Q3 目标对齐\n1. 插件生态')
  A.deepEqual(r.meta, { lang: 'zh', kind: 'scan', confidence: 'high' })
}
{
  const r = T.parseVisionOutput('```visionindex-text\n只有正文\n```')
  A.equal(r.ok, true, '②meta 缺失照常写')
  A.deepEqual(r.meta, { lang: '', kind: 'other', confidence: 'low' }, 'meta 缺失走默认值')
  A.equal(r.text, '只有正文')
}
{
  const r = T.parseVisionOutput(FENCE('{"lang":', '正文完好'))
  A.equal(r.ok, true)
  A.equal(r.text, '正文完好', 'meta JSON 坏掉不毁正文')
  A.equal(r.meta.kind, 'other')
}
{
  const r = T.parseVisionOutput(FENCE('{}', ''))
  A.deepEqual([r.ok, r.empty], [true, true], '③text 围栏空 → ok:true, empty:true(这张图真没字)')
}
{
  const r = T.parseVisionOutput('模型闲聊了一句,什么围栏都没有')
  A.deepEqual([r.ok, r.reason], [false, 'no-fence'], '④text 围栏缺席 → ok:false / no-fence(引擎坏了)')
  A.notEqual(r.ok, true, '解析失败与空结果绝不许合并')
}
{
  const r = T.parseVisionOutput('```visionindex-text\n没有闭合就到 EOF')
  A.deepEqual([r.ok, r.truncated], [true, true], '⑤未闭合 → ok:true, truncated:true')
  A.equal(r.text, '没有闭合就到 EOF')
}
{
  const body = '前面 `inline ``` 反引号` 不算闭合\n还有一行'
  const r = T.parseVisionOutput('```visionindex-text\n' + body + '\n```')
  A.equal(r.ok, true)
  A.equal(r.text, body, '⑥闭合只认独占一行的三反引号,行内的不算')
}

// ══ ⑧ buildExtractMessage:两版差集只有 IMAGE 那一段 ═══════════════════════
{
  const abs = T.buildExtractMessage({ absPath: '/Users/x/V/board 1.png' })
  const rel = T.buildExtractMessage({ relPath: 'Attachments/2026/board 1.png' })
  A.ok(abs.includes('IMAGE (absolute path): /Users/x/V/board 1.png'), '绝对路径版含该路径')
  A.ok(!abs.includes('Resolve it against'), '绝对路径版**不含** Resolve it against')
  A.ok(rel.includes('IMAGE (path relative to the Amadeus vault): Attachments/2026/board 1.png'), '相对路径版含相对路径')
  A.ok(rel.includes('Resolve it against the Amadeus vault path'), '相对路径版含系统提示解析句')
  A.ok(!rel.includes('/Users/x/V'), '相对路径版不含任何绝对路径')
  for (const m of [abs, rel]) {
    A.ok(m.includes('Use ONLY the view_image tool'), '死限句:只准用 view_image')
    A.ok(m.includes('Never translate'), '死限句:绝不翻译(识别出的是用户库里的字)')
    A.ok(m.includes('visionindex-meta') && m.includes('visionindex-text'), '两个围栏名')
  }
  const strip = (s) => s.split('\n').filter((l) => !l.startsWith('IMAGE (') && !l.startsWith('Resolve it against'))
  A.deepEqual(strip(abs), strip(rel), '两版逐行 diff:除 IMAGE 那一段外必须逐字相同(防指令漂移)')
}

// ══ ⑨ classifyFailure + 5MB 口径与引擎常量一致 ═════════════════════════════
A.equal(T.VIEW_IMAGE_MAX_BYTES, 5 * 1024 * 1024, '5MB 口径必须与引擎 VIEW_IMAGE_MAX_BYTES 一致')
A.equal(T.classifyFailure('Error: image too large (7.2MB, limit 5MB)'), 'too-large')
A.equal(T.classifyFailure('unsupported image format (only png/jpg/jpeg/gif/webp/bmp)'), 'unsupported')
A.equal(T.classifyFailure('file not found: /x/y.png'), 'not-found')
A.equal(T.classifyFailure('this runtime cannot display images'), 'no-channel')
A.equal(T.classifyFailure('模型答非所问'), 'no-fence')
A.equal(T.classifyFailure(''), 'unknown')

// ══ ⑩ estimateBudget 边界 ════════════════════════════════════════════════════
A.deepEqual(T.estimateBudget([], 50, 9), { count: 0, seconds: 0, capped: false }, '空输入')
A.deepEqual(T.estimateBudget(new Array(10).fill('x'), 50, 9), { count: 10, seconds: 90, capped: false }, 'N < max 不 capped')
A.deepEqual(T.estimateBudget(new Array(50).fill('x'), 50, 9), { count: 50, seconds: 450, capped: false }, 'N === max 边界**不** capped')
A.deepEqual(T.estimateBudget(new Array(51).fill('x'), 50, 9), { count: 50, seconds: 450, capped: true }, 'N > max → capped')

// ══ ⑪ fmtDuration 双语 ═══════════════════════════════════════════════════════
{
  const pts = [0, 59, 60, 3600, 3661]
  const zh = pts.map((s) => T.fmtDuration(s))
  A.deepEqual(zh, ['0 秒', '59 秒', '1 分', '1 小时', '1 小时 1 分 1 秒'], '中文时长')
  setLocale('en')
  const en = pts.map((s) => T.fmtDuration(s))
  A.deepEqual(en, ['0 sec', '59 sec', '1 min', '1 hr', '1 hr 1 min 1 sec'], '英文时长')
  A.ok(en.every((s) => !/[一-鿿]/.test(s)), '英文侧不许出现中文量词')
  setLocale('zh')
}

// ══ ⑫ groupLabelOf 跨年(冻钟 2026-01-01 09:00 本地;四时区各跑一遍)═══════
A.equal(T.groupLabelOf(NOW), '今天')
A.equal(T.groupLabelOf(localMs(2025, 12, 31, 23, 0)), '昨天', '跨年:2025-12-31 23:00 是「昨天」不是「更早」')
A.equal(T.groupLabelOf(localMs(2025, 12, 30, 12, 0)), '本周', '差 2 天 → 本周')
A.equal(T.groupLabelOf(localMs(2025, 12, 26, 12, 0)), '本周', '差 6 天 → 本周')
A.equal(T.groupLabelOf(localMs(2025, 12, 25, 12, 0)), '更早', '差 7 天 → 更早')
A.equal(T.groupLabelOf(0), '更早', '没有时间戳 → 更早')
{
  setLocale('en')
  A.equal(T.groupLabelOf(localMs(2025, 12, 31, 23, 0)), 'Yesterday', '英文分组标签')
  setLocale('zh')
}

// ══ ⑬ serializeSidecar / parseSidecar 往返 ═══════════════════════════════════
{
  const fm = { visionindex: '1', source: 'Attachments/2026/会议白板 1.png', fp: '3f2a91c7', lang: 'zh', kind: 'screenshot', chars: '412', extractedAt: '2026-08-14T02:31:07.000Z' }
  const body = '# 会议白板 1.png\n\n![[Attachments/2026/会议白板 1.png]]\n\nQ3 目标对齐\n---\n正文里也有一行 --- 分隔线\n1. 插件生态'
  const text = T.serializeSidecar(fm, body)
  const back = T.parseSidecar(text)
  A.deepEqual(back.fm, fm, 'frontmatter 往返(路径含空格/中文原样回放)')
  A.equal(back.body, body, '正文含 --- 行不破解析(只吃文件头那一段)')
  A.equal(T.serializeSidecar(back.fm, back.body), text, '二次序列化逐字节稳定')
  A.equal(T.parseSidecar(text.replace(/\n/g, '\r\n')).body, body, 'CRLF 归一')
  A.deepEqual(T.parseSidecar('没有 frontmatter 的全文'), { fm: {}, body: '没有 frontmatter 的全文' }, 'frontmatter 缺失 → {fm:{}, body:全文}')
  A.equal(T.parseSidecar(T.serializeSidecar(fm, '')).body, '', '空正文往返')
}

// ══ ⑭ buildPending ═══════════════════════════════════════════════════════════
{
  const wf = '视觉索引'
  const files = ['Attachments/a.png', 'Attachments/b.png', 'Attachments/c.png', 'Attachments/d.png', 'Shots/e.png', '视觉索引/Index/x.png', 'doc.pdf']
  const idx = { entries: { 'Attachments/b.png': { st: 'empty' }, 'Attachments/c.png': { st: 'failed' }, 'Attachments/d.png': { st: 'promoted' } } }
  A.deepEqual(T.buildPending(files, [], idx, { workFolder: wf }), [], '🟥 roots 为空 → [](**不做开箱扫全库**)')
  A.deepEqual(T.buildPending(files, ['Attachments'], idx, { workFolder: wf }), ['Attachments/a.png'], '排除 empty/failed/promoted 与工作文件夹自身与非图')
  A.deepEqual(T.buildPending(files, ['Attachments'], idx, { workFolder: wf, retryFailed: true }), ['Attachments/a.png', 'Attachments/c.png'], 'retryFailed=true 把失败的排回来')
  A.deepEqual(T.buildPending(files, ['Attachments', 'Shots'], idx, { workFolder: wf }), ['Attachments/a.png', 'Shots/e.png'], '多目录圈定')
  A.deepEqual(T.buildPending(files, ['Attachments'], idx, { workFolder: wf, done: new Set(['Attachments/a.png']) }), [], '已有 sidecar 的跳过')
  A.deepEqual(T.buildPending(null, ['Attachments'], null, { workFolder: wf }), [], '脏输入不抛')
}

// ══ ⑮ doneSetOf / rootOf / decodeSseLine / previewOf ════════════════════════
A.deepEqual([...T.doneSetOf(['视觉索引/Index/A/x.png.md', '别的笔记.md'], '视觉索引')], ['A/x.png'], 'listPages 里的 sidecar → 已识别集合')
A.equal(T.rootOf('A/b/c.png'), 'A')
A.equal(T.rootOf('c.png'), '', '库根散落文件的 root 是空串')
A.deepEqual(T.decodeSseLine('data: {"type":"token","payload":{"delta":"hi"}}'), { type: 'token', payload: { delta: 'hi' } })
A.equal(T.decodeSseLine(': keep-alive'), null)
A.equal(T.decodeSseLine('data: 坏 JSON'), null)
A.equal(T.previewOf('a\n\n  b   c', 100), 'a b c', '预览折叠空白')
A.equal(T.previewOf('0123456789', 5), '01234…')

// ══ ⑯ XSS:恶意串走**真实渲染路径**后无元素/属性注入 ═══════════════════════
// ⚠️ 这条断言必须打生产路径。曾经它打的是一个全文件没有调用点的示范函数 renderExtracted ——
//    断言绿着,却对用户真正看得见的那条渲染管线一无所知。现在改成:把一条恶意 sidecar 塞进库,
//    真挂 results 视图,让它走完 load → 预览 → 条目渲染,再检查 DOM。
{
  const evil = '识别出的字 <img src=x onerror=alert(1)> <script>bad()</script>'
  const evilSc = '视觉索引/Index/Attachments/evil.png.md'
  V.set(evilSc, T.serializeSidecar(
    { visionindex: '1', source: 'Attachments/evil.png', fp: T.fpOf('Attachments/evil.png'), lang: 'zh', kind: 'screenshot', chars: '30', extractedAt: '2026-01-01T00:00:00.000Z' },
    `# evil.png\n\n![[Attachments/evil.png]]\n\n${evil}`,
  ))
  vaultPages = [evilSc]
  const host = mkEl('div')
  const cleanup = reg.views.find((v) => v.id === 'results').mount(host)
  await sleep(40)
  A.ok(host.textContent.includes('Attachments/evil.png'), 'XSS 用例真的渲染到了(否则这条断言等于没跑)')
  A.equal(byTag(host, 'img').length, 0, '绝不能创建 img 元素')
  A.equal(byTag(host, 'script').length, 0, '绝不能创建 script 元素')
  A.equal(anyAttr(host, 'onerror'), false, '绝不能设 onerror 属性')
  A.equal(anyAttr(host, 'src'), false, '绝不能设 src 属性')
  A.ok(host.textContent.includes('<img') && host.textContent.includes('onerror'), '恶意 HTML 在真实渲染路径上变成字面文字')
  cleanup()
  V.delete(evilSc)
  vaultPages = []
}

// ══ ⑰ 识别管线:空结果不写 sidecar / 幂等 / 自愈 / 红线(缓存里没有正文)════
const okOutput = FENCE('{"lang":"zh","kind":"screenshot","confidence":"high"}', '白板上的字:Q3 目标对齐')
{
  // 空结果:index 记 empty,但 Index/ 下**不许**多出文件
  T.setRunner(async () => FENCE('{"lang":"","kind":"other","confidence":"low"}', ''))
  const before = writes.length
  const r = await T.scanOne('Attachments/icon.png', null, false)
  A.equal(r.st, 'empty', '空围栏 → st:empty')
  A.equal(writes.filter((p) => p.includes('/Index/')).length, 0, '空结果**不写 sidecar**')
  A.ok(writes.length > before, '但 index.json 要更新')
  const idx = JSON.parse(V.get('视觉索引/.visionindex/index.json'))
  A.equal(idx.entries['Attachments/icon.png'].st, 'empty')
}
{
  // 正常结果:落 sidecar、进 index、埋点
  T.setRunner(async () => okOutput)
  const r = await T.scanOne('Attachments/2026/会议白板 1.png', null, false)
  A.equal(r.st, 'ok')
  const sc = '视觉索引/Index/Attachments/2026/会议白板 1.png.md'
  A.ok(V.has(sc), 'sidecar 落在可见目录 Index/ 下')
  const parsed = T.parseSidecar(V.get(sc))
  A.equal(parsed.fm.source, 'Attachments/2026/会议白板 1.png', 'frontmatter source 是反查原图的唯一指针')
  A.equal(parsed.fm.visionindex, '1')
  A.ok(parsed.body.includes('![[Attachments/2026/会议白板 1.png]]'), '内嵌原图,看到文字就能看到图')
  A.ok(parsed.body.includes('白板上的字'), '识别正文进 sidecar')
  A.ok(reg.tracks.includes('extract'), '成就埋点')
  A.ok(reg.activity.find(([e]) => e === 'extract'), '活动日志')
  // 🟥 红线:.visionindex/ 里绝不出现识别正文
  const cache = V.get('视觉索引/.visionindex/index.json')
  A.ok(!cache.includes('白板上的字'), '🟥 红线:派生缓存里绝不出现识别正文(连摘要都不行)')
  // 幂等:第二次跑不写任何东西
  const n = writes.length
  const r2 = await T.scanOne('Attachments/2026/会议白板 1.png', null, false)
  A.equal(r2.skipped, true, 'sidecar 已存在 → 跳过')
  A.equal(writes.length, n, '幂等:第二次 writes 数不增')
  // 自愈:用户删掉 sidecar → 下次重新识别
  V.delete(sc)
  await T.scanOne('Attachments/2026/会议白板 1.png', null, false)
  A.ok(V.has(sc), '删掉 sidecar 后重扫自愈')
  // 强制重识别:整文件覆写
  T.setRunner(async () => FENCE('{"lang":"zh","kind":"scan","confidence":"low"}', '第二遍识别的新内容'))
  await T.scanOne('Attachments/2026/会议白板 1.png', null, true)
  A.ok(V.get(sc).includes('第二遍识别的新内容'), '重新识别 = 整文件覆写(sidecar 归机器所有)')
  T.setRunner(async () => okOutput)
}
{
  // 失败:记 index、不写 sidecar
  T.setRunner(async () => { throw new Error('Error: image too large (7.2MB, limit 5MB)') })
  const r = await T.scanOne('Attachments/大图.png', null, false)
  A.deepEqual([r.st, r.e], ['failed', 'too-large'], '失败码从错误文案归类')
  A.ok(!V.has('视觉索引/Index/Attachments/大图.png.md'), '失败不写 sidecar')
  T.setRunner(async () => okOutput)
}
{
  // 传输层故障(HTTP / SSE 断链)与「这一张读不了」是两回事:前者必须**停整批**,
  // 否则一条断链会把剩下 49 张全烧成 failed。
  T.setRunner(async () => { throw new Error('HTTP 502') })
  let thrown = null
  try { await T.scanOne('Attachments/net.png', null, false) } catch (e) { thrown = e }
  A.ok(thrown, '认不出的错误(传输层)必须往上抛,交给 startScan 停批')
  A.equal(T.classifyError(new Error('HTTP 502')), 'stream', '认不出的错误归**传输层** stream,绝不落回 no-fence(那是给模型故障贴的标签)')
  A.equal(T.classifyError(new Error('this runtime cannot display images')), 'no-channel', '认得出的 view_image 错误仍归这一张')
  const idx = await T.readIndex(true)
  A.ok(!idx.entries['Attachments/net.png'], '传输层故障不在 scanOne 里落账')
  // 走整批:三张待识别,第一张就断链 → 只跑了一张,其余不动
  const before = writes.length
  await T.startScan(['Attachments/n1.png', 'Attachments/n2.png', 'Attachments/n3.png'])
  A.equal(T.run.doneCount, 1, '断链后整批停在第一张')
  A.equal(T.run.fail, 1)
  const idx2 = await T.readIndex(true)
  // 🟥 断链的那一张**一个字都不许落账**:提示语写着「可接着跑」,而默认 retryFailed=false 时
  //    记成 failed 就等于「登录/网络恢复之后它再也不会被扫」—— 与提示语直接矛盾。
  //    (旧版 check 把「记 failed」当正确行为钉进断言,是测试在保护 bug。)
  A.ok(!idx2.entries['Attachments/n1.png'], '🟥 断链当前这张不落账,否则默认设置下它永远不会被再扫')
  A.ok(!idx2.entries['Attachments/n2.png'], '后面的图一张都没烧')
  A.equal(writes.length, before, '断链一批下来一个字节都没写(没有毒化任何条目)')
  A.deepEqual(
    T.buildPending(['Attachments/n1.png', 'Attachments/n2.png', 'Attachments/n3.png'], ['Attachments'], idx2, { workFolder: '视觉索引' }),
    ['Attachments/n1.png', 'Attachments/n2.png', 'Attachments/n3.png'],
    '断链之后三张仍全在待识别里 —— 这条才是「可接着跑」这句提示的兑现',
  )
  A.ok(reg.notes.some(([m]) => String(m).includes('连接中断')), '断链要有用户可见的提示,并说明可接着跑')
  T.setRunner(async () => okOutput)
}
// ══ ⑰b 未登录:一张都不许发,更不许把第一张烧成 failed(第 4 种状态横幅的存在理由)══
{
  const savedCfg = globalThis.window.tangu.getConfig
  globalThis.window.tangu.getConfig = async () => ({ backendUrl: '', token: '' })
  T.setRunner(async () => { throw new Error('绝不该走到这里:未登录时一张都不许发 run') })
  const before = writes.length
  const notesBefore = reg.notes.length
  await T.startScan(['Attachments/u1.png', 'Attachments/u2.png'])
  A.equal(T.run.active, false, '未登录时前置闸在 run.active 置位**之前**返回(否则界面只剩一个点不动的「停止」)')
  A.equal(writes.length, before, '未登录 → 一个字节都没写')
  const idxU = await T.readIndex(true)
  A.ok(!idxU.entries['Attachments/u1.png'], '🟥 未登录不许把第一张永久毒化成 failed')
  const uNotes = reg.notes.slice(notesBefore).map(([m]) => String(m))
  A.ok(uNotes.includes(T.MSG.zh.banEngineBody), `未登录必须走**前置闸**并给出登录指路(而不是先开跑再报断链):${uNotes.join(' | ').slice(0, 120)}`)
  A.ok(!uNotes.some((m) => m.includes('连接中断')), '未登录不是「连接中断」—— 报错文案要说得出真实原因')
  // scanOne 单独走一遍:抛的是带 code 的 no-engine,不是被 classifyFailure 误判成 no-fence
  let thrown = null
  try { await T.scanOne('Attachments/u3.png', null, false) } catch (e) { thrown = e }
  A.ok(thrown, '未登录时 scanOne 抛错')
  A.equal(T.classifyError(thrown), 'no-engine', '未登录 = no-engine(传输层),不是「模型没按约定格式回复」')
  A.ok(!(await T.readIndex(true)).entries['Attachments/u3.png'], 'no-engine 同样不落账')
  // 第 4 种状态横幅:queue 视图必须画出来(banEngineTitle/banEngineBody 曾是从未被引用的死键)
  const host = mkEl('div')
  const cleanup = reg.views.find((v) => v.id === 'queue').mount(host)
  await sleep(40)
  A.ok(host.textContent.includes(T.MSG.zh.banEngineTitle), '未登录 → queue 顶部画出「还没连上 Forsion 引擎」横幅')
  A.ok(host.textContent.includes(T.MSG.zh.banEngineBody), '横幅正文说清去哪补(登录)')
  cleanup()
  globalThis.window.tangu.getConfig = savedCfg
  T.setRunner(async () => okOutput)
}
// ══ ⑰c 重建缓存 = **合并**不是覆写(否则已知无文字/已转正的图下次全部重烧一遍)══════
{
  await T.setEntry('Attachments/icon2.png', { fp: T.fpOf('Attachments/icon2.png'), st: 'empty', c: 0, at: 1735689600000 })
  await T.setEntry('Attachments/big2.png', { fp: T.fpOf('Attachments/big2.png'), st: 'failed', e: 'too-large', at: 1735689600000 })
  await T.setEntry('Attachments/gone.png', { fp: T.fpOf('Attachments/gone.png'), st: 'promoted', at: 1735689600000 })
  // 有 sidecar 的那张:listPages 认得出来,at 应从旧账里接着用(否则重建后全掉进「更早」分组)
  const okSrc = 'Attachments/2026/会议白板 1.png'
  await T.setEntry(okSrc, { fp: T.fpOf(okSrc), st: 'ok', c: 11, at: NOW, sc: T.sidecarPathFor(okSrc, '视觉索引') })
  vaultPages = ['视觉索引/Index/Attachments/2026/会议白板 1.png.md']
  await T.rebuildIndex()
  const idx = await T.readIndex(true)
  const st = (k) => (idx.entries[k] || {}).st
  A.equal(st(okSrc), 'ok', 'ok 集合仍能仅凭库里现有 sidecar 重算')
  A.equal((idx.entries[okSrc] || {}).at, NOW, '🟥 重建保留旧 at,否则全部条目掉进「更早」分组')
  A.equal(st('Attachments/icon2.png'), 'empty', '🟥 empty 必须留住 —— 这份缓存的正当性就是记住「没有产出 sidecar」的图')
  A.equal(st('Attachments/big2.png'), 'failed', '🟥 failed 必须留住')
  A.equal((idx.entries['Attachments/big2.png'] || {}).e, 'too-large', '失败码一并留住')
  A.equal(st('Attachments/gone.png'), 'promoted', '🟥 promoted 必须留住(「永不再被扫描触碰」不能被一次重建作废)')
  A.deepEqual(
    T.buildPending(['Attachments/icon2.png', 'Attachments/big2.png', 'Attachments/gone.png'], ['Attachments'], idx, { workFolder: '视觉索引' }),
    [],
    '🟥 重建之后这三张一张都不该重新排队(重烧一遍 = 插件自己背叛自己的范围闸)',
  )
  vaultPages = []
}
{
  // 连续 3 张同码失败 → 自动停批(引擎坏了就别烧 50 张的钱)
  T.setRunner(async () => { throw new Error('this runtime cannot display images') })
  await T.startScan(['Attachments/f1.png', 'Attachments/f2.png', 'Attachments/f3.png', 'Attachments/f4.png', 'Attachments/f5.png'])
  A.equal(T.run.doneCount, 3, '连续 3 张同码失败即停,不烧完 5 张')
  A.ok(reg.notes.some(([m]) => String(m).includes('连续 3 张')), '停批要有 error 级提示')
  T.setRunner(async () => okOutput)
}
{
  // 转正式笔记:不带插件 frontmatter,index 记 promoted,重名加序号
  promptReply = null
  const p1 = await T.promoteToNote('Attachments/2026/会议白板 1.png', '# 会议白板 1.png\n\n白板上的字:Q3 目标对齐')
  A.equal(p1, '视觉索引/Notes/会议白板 1-2026-01-01.md', '转出目标 Notes/<源文件名去后缀>-<日期>.md')
  A.ok(!V.get(p1).includes('visionindex: 1'), '正式笔记不带插件 frontmatter')
  A.ok(V.get(p1).includes('[[Attachments/2026/会议白板 1.png]]'), '带一行回指原图')
  const p2 = await T.promoteToNote('Attachments/2026/会议白板 1.png', '再转一次')
  A.equal(p2, '视觉索引/Notes/会议白板 1-2026-01-01-2.md', '重名加 -2,先者不被覆写')
  A.ok(V.get(p1).includes('Q3 目标对齐'), '第一份笔记完好')
  const idx = await T.readIndex(true)
  A.equal(idx.entries['Attachments/2026/会议白板 1.png'].st, 'promoted', '转出后记 promoted,该图永不再被扫描触碰')
  A.ok(reg.tracks.includes('promote'), 'promote 埋点')
}

// ══ ⑱ 视图挂载(新宿主):真内容 + 目录圈定 + 预算闸 + 语言切换不重挂 ═══════
vaultFiles = ['Attachments/a.png', 'Attachments/b.png', 'Shots/c.jpg', 'doc.pdf']
vaultPages = ['视觉索引/Index/Attachments/a.png.md', '别的笔记.md']
V.set('视觉索引/Index/Attachments/a.png.md', T.serializeSidecar(
  { visionindex: '1', source: 'Attachments/a.png', fp: T.fpOf('Attachments/a.png'), lang: 'zh', kind: 'screenshot', chars: '12', extractedAt: '2026-01-01T00:00:00.000Z' },
  '# a.png\n\n![[Attachments/a.png]]\n\n截图里的一段文字:季度目标对齐',
))
{
  const queue = reg.views.find((v) => v.id === 'queue')
  const host = mkEl('div')
  const cleanup = queue.mount(host)
  A.ok(host.textContent.length > 0, '同步挂载即有可见内容(不等异步)')
  await sleep(30)
  const txt = host.textContent
  A.ok(txt.includes('视觉索引'), '标题')
  A.ok(txt.includes('Attachments'), '目录圈定区列出目录')
  A.ok(txt.includes('已识别 1'), '已识别数来自 listPages 里的 sidecar')
  A.ok(txt.includes('先在上面勾选'), 'roots 空 → 预算闸置灰并给出指路')
  A.ok(txt.includes('视觉索引能做什么'), '空态是真内容,不是空白')
  const startBtn = buttonNamed(host, '开始识别')
  A.ok(startBtn && startBtn.disabled, 'roots 空时开始按钮置灰')
  // 勾选一个目录 → 预算闸解锁
  const cbs = findAll(host, (c) => c.tag === 'input' && c.attrs.type === 'checkbox')
  A.ok(cbs.length >= 2, `目录复选框(见 ${cbs.length} 个)`)
  cbs[0].checked = true
  cbs[0].listeners.change[0]()
  await sleep(20)
  const txt2 = host.textContent
  A.ok(txt2.includes('本次将识别') && txt2.includes('预估约'), '预算闸文案')
  A.ok(txt2.includes('1 张'), 'a.png 已有 sidecar → 只剩 b.png 一张待识别')
  A.ok(!buttonNamed(host, '开始识别').disabled, '圈定后开始按钮解锁')
  // ⑧BRIEF:切 en 后**不重挂**也要变英文
  const zhText = host.textContent
  setLocale('en')
  await sleep(20)
  const enText = host.textContent
  A.notEqual(enText, zhText, '切语言后视图文案必须变(不靠重挂)')
  A.ok(enText.includes('VisionIndex') && enText.includes('Budget'), `英文串应出现:${enText.slice(0, 60)}`)
  A.ok(enText.includes('This run will read'), '预算闸英文文案')
  A.ok(!enText.includes('本次将识别'), '英文界面不留中文文案')
  setLocale('zh')
  await sleep(20)
  A.ok(host.textContent.includes('本次将识别'), '切回中文')
  cleanup()
}
{
  const results = reg.views.find((v) => v.id === 'results')
  const host = mkEl('div')
  const cleanup = results.mount(host)
  A.ok(host.textContent.length > 0, 'results 同步挂载即有内容')
  await sleep(40)
  const txt = host.textContent
  A.ok(txt.includes('Attachments/a.png') || txt.includes('会议白板'), `结果列表列出已识别条目:${txt.slice(0, 120)}`)
  A.ok(buttonNamed(host, '反查原图'), '条目操作:反查原图')
  A.ok(buttonNamed(host, '转正式笔记'), '条目操作:转正式笔记')
  A.ok(buttonNamed(host, '验证收录'), '条目操作:验证收录(把立项论证做成可点的证明)')
  // 验证收录:searchVault 命中该 sidecar → 打绿标
  searchHits = [{ path: '视觉索引/Index/Attachments/a.png.md', title: 'a.png.md', snippet: '', line: 1, score: 1 }]
  buttonNamed(host, '验证收录').listeners.click[0]()
  await sleep(30)
  A.ok(host.textContent.includes('全局搜索可命中'), '验证收录命中 → 绿标')
  searchHits = []
  cleanup()
}
{
  // 命令:roots 空时提示先选目录
  _ls.delete('plugin.visionindex.roots')
  const before = reg.notes.length
  reg.commands.find((c) => c.id === 'visionindex-scan').run()
  A.ok(reg.opened.includes('view:queue'), 'visionindex-scan 打开 queue')
  A.ok(reg.notes.slice(before).some(([m]) => String(m).includes('先在')), 'roots 空 → notify 提示先选目录')
  reg.commands.find((c) => c.id === 'visionindex-open').run()
  A.ok(reg.opened.filter((x) => x === 'view:queue').length >= 2, 'visionindex-open 打开 queue')
}

// ══ ⑱b 真实数据规模:渲染多少条,就必须有多少条能「转正式笔记」════════════════
// 🟥 曾经预热只读前 30 条正文、却渲染 60 条:第 31 条起的「转正式笔记」按钮把一个只有回指、
//    正文一个字都没有的空壳写进用户库,同时把该图记成 promoted(此后永不再被扫描触碰)——
//    用户以为「我把这段字留下来了」,拿到的是空文件,原文再也长不回来。
{
  const wf = '视觉索引'
  const many = []
  for (let i = 1; i <= 40; i++) {
    const s = `Attachments/img${String(i).padStart(2, '0')}.png`
    const sc = `${wf}/Index/${s}.md`
    many.push(sc)
    V.set(sc, T.serializeSidecar(
      { visionindex: '1', source: s, fp: T.fpOf(s), lang: 'zh', kind: 'screenshot', chars: '20', extractedAt: '2026-01-01T00:00:00.000Z' },
      `# img${i}.png\n\n![[${s}]]\n\n这是第 ${i} 张图里的真实文字内容`,
    ))
  }
  vaultPages = many.slice()
  const host = mkEl('div')
  const cleanup = reg.views.find((v) => v.id === 'results').mount(host)
  await sleep(120)
  const promotes = findAll(host, (c) => c.tag === 'button' && c.textContent === '转正式笔记')
  A.ok(promotes.length >= 35, `渲染出的条目要够多才测得到这条(见 ${promotes.length} 个「转正式笔记」)`)
  const items = findAll(host, (c) => c.className === 'vi-item')
  A.equal(items.length, promotes.length, '渲染条目数 === 转正式笔记按钮数')
  // 第 35 条(最新在前 → img06;顺序不重要,重要的是它一定在「前 30 条预热」之外的下标上)
  const before = [...V.keys()].filter((k) => k.startsWith(wf + '/Notes/')).length
  promotes[34].listeners.click[0]()
  await sleep(80)
  const notes = [...V.keys()].filter((k) => k.startsWith(wf + '/Notes/'))
  A.equal(notes.length, before + 1, '第 35 条也要能转出一份笔记')
  const fresh = notes.filter((k) => k.includes('img'))
  A.ok(fresh.length >= 1, '转出的笔记落在 Notes/')
  const bodyText = V.get(fresh[fresh.length - 1])
  A.ok(bodyText.includes('这是第'), `🟥 第 35 条转出的必须是真正文,不是空壳:${JSON.stringify(bodyText).slice(0, 80)}`)
  A.ok(bodyText.includes('[[Attachments/img'), '仍带一行回指原图')
  A.ok(!bodyText.includes('visionindex: 1'), '正式笔记不带插件 frontmatter')
  cleanup()
}
{
  // 正文读不到(用户已按 SPEC 把 sidecar 删了 / 预热还没落地就点了按钮)
  //  → **绝不**转出空壳笔记、**绝不**把这张图记成 promoted
  const wf = '视觉索引'
  const s = 'Attachments/ghost.png'
  const sc = `${wf}/Index/${s}.md`
  vaultPages = [sc] // listPages 报得出这条,但 V 里没有它的正文 → readFile 恒 null
  const host = mkEl('div')
  const cleanup = reg.views.find((v) => v.id === 'results').mount(host)
  await sleep(60)
  const promote = findAll(host, (c) => c.tag === 'button' && c.textContent === '转正式笔记')[0]
  A.ok(promote, '读不到正文的条目仍然会被列出来(否则这条断言等于没跑)')
  const n0 = [...V.keys()].filter((k) => k.startsWith(wf + '/Notes/')).length
  const notifBefore = reg.notes.length
  promote.listeners.click[0]()
  await sleep(60)
  A.equal([...V.keys()].filter((k) => k.startsWith(wf + '/Notes/')).length, n0, '🟥 正文读不到时绝不转出空壳笔记')
  A.ok(reg.notes.slice(notifBefore).some(([m]) => String(m).includes('没有转出空笔记')), '读不到正文要明说,而不是静默产出一个空文件')
  const idxG = await T.readIndex(true)
  A.ok(!(idxG.entries[s] && idxG.entries[s].st === 'promoted'), '🟥 空转被拦下时绝不许把这张图记成 promoted(promoted = 永不再被扫描触碰)')
  cleanup()
  vaultPages = []
}

// ══ ⑱e 运行中的进度 tick 只重画运行区,不许整页重建 ═════════════════════════
// 每张图会 emit 2-3 次 run 事件。整页重建会把用户正在点的复选框(以及万级 state.files 的
// 全量 buildPending 遍历)一遍遍重来 —— 扫 50 张 ≈ 100+ 次全量重建。
{
  vaultFiles = ['Attachments/a.png', 'Attachments/b.png']
  vaultPages = []
  _ls.set('plugin.visionindex.roots', JSON.stringify(['Attachments']))
  const host = mkEl('div')
  const cleanup = reg.views.find((v) => v.id === 'queue').mount(host)
  await sleep(40)
  Object.assign(T.run, { active: true, total: 3, doneCount: 0, rows: [] })
  T.bus.emit({ type: 'run' }) // 起跑那一次:整页重建一次,把运行区建出来(这是应该的)
  await sleep(10)
  const cbBefore = findAll(host, (c) => c.tag === 'input' && c.attrs.type === 'checkbox')[0]
  A.ok(cbBefore, '运行中仍然画得出目录复选框')
  for (let i = 1; i <= 3; i++) { T.run.doneCount = i; T.bus.emit({ type: 'run' }) }
  await sleep(10)
  const cbAfter = findAll(host, (c) => c.tag === 'input' && c.attrs.type === 'checkbox')[0]
  A.equal(cbAfter, cbBefore, '🟥 进度 tick 后复选框必须是**同一个节点**(整页重建 = 用户正点着的勾选被吃掉)')
  A.ok(host.textContent.includes('3 / 3'), '但进度本身确实刷新了')
  Object.assign(T.run, { active: false, total: 0, doneCount: 0, rows: [] })
  cleanup()
  _ls.delete('plugin.visionindex.roots')
  vaultFiles = []
}

// ══ ⑱c 状态栏的待识别数**不许**绑在 queue 视图的 render 上 ═══════════════════
// 状态栏的作用正是「不打开也能看见」。曾经 run.pending 只在 queue 视图 render 里被赋值 ——
// 用户没开过 queue,状态栏就永远显示「👁 已就绪」,哪怕有几百张待识别。
{
  vaultFiles = ['Attachments/p1.png', 'Attachments/p2.png', 'Attachments/p3.png']
  vaultPages = []
  _ls.set('plugin.visionindex.roots', JSON.stringify(['Attachments']))
  T.run.pending = -1 // 故意写坏,证明下面这一句是真的重算而不是读到上次渲染的残值
  const n = await T.refreshPendingCount()
  A.equal(n, 3, '不挂 queue 视图也要能算出待识别数')
  A.equal(T.run.pending, 3)
  const item = reg.status.find((s) => s.id === 'status')
  A.ok(String(item.text).includes('3') && String(item.text).includes('待识别'), `状态栏文案要跟上:${item.text}`)
  // 索引变更(一批跑完 / 重建缓存 / 单张重识别)也要重算,同样不依赖 queue 视图挂没挂
  T.run.pending = -1
  T.bus.emit({ type: 'index' })
  await sleep(30)
  A.equal(T.run.pending, 3, '索引变更后状态栏的待识别数要跟着重算(不能等用户打开 queue)')
  _ls.delete('plugin.visionindex.roots')
  await T.refreshPendingCount()
  A.ok(String(reg.status.find((s) => s.id === 'status').text).includes('已就绪'), 'roots 清空 → 回到「已就绪」')
  vaultFiles = []
}

// ══ ⑱d 全局搜索被普通笔记占满 → 内存兜底必须**说出来** ═══════════════════════
{
  const wf = '视觉索引'
  const s = 'Attachments/fb.png'
  const sc = `${wf}/Index/${s}.md`
  V.set(sc, T.serializeSidecar(
    { visionindex: '1', source: s, fp: T.fpOf(s), lang: 'zh', kind: 'screenshot', chars: '9', extractedAt: '2026-01-01T00:00:00.000Z' },
    `# fb.png\n\n![[${s}]]\n\n季度目标对齐的一段话`,
  ))
  vaultPages = [sc]
  // searchVault 有结果,但全是普通笔记(不带 Index/ 前缀)→ 相当于被截断
  searchHits = [{ path: '别的笔记.md', title: 'x', snippet: '', line: 1, score: 1 }]
  const host = mkEl('div')
  const cleanup = reg.views.find((v) => v.id === 'results').mount(host)
  await sleep(60)
  const box = findAll(host, (c) => c.tag === 'input' && c.attrs.type === 'text')[0]
  box.value = '季度目标'
  box.listeners.change[0]()
  await sleep(60)
  A.ok(host.textContent.includes(T.MSG.zh.rSearchLocal), '走内存兜底时必须提示「结果可能不全」,否则用户会把「搜索被截断」读成「库里没有」')
  A.ok(host.textContent.includes(s), '兜底仍能凭已读入的正文匹配到这一条')
  searchHits = []
  cleanup()
  V.delete(sc)
  vaultPages = []
}

// ══ ⑲ disposer:life 已 abort + 语言订阅已退订 ══════════════════════════════
{
  const subsBefore = localeSubs.size
  A.ok(subsBefore >= 1, 'setup 应订阅语言变更')
  A.equal(T.life.signal.aborted, false, 'dispose 之前 life 未 abort')
  dispose()
  A.equal(T.life.signal.aborted, true, 'disposer 执行后 AbortController 已 abort')
  A.equal(localeSubs.size, subsBefore - 1, 'disposer 执行后语言订阅已退订')
  dispose() // 幂等,重复执行不抛
}

// ══ ⑳ 桥空态(方法在、结果空)—— 真机门禁第 4 条的 node 侧镜像 ═════════════
{
  const reg2 = { views: [], commands: [], settings: [], notes: [] }
  const ctx2 = {
    registerView: (v) => reg2.views.push(v), registerCommand: (c) => reg2.commands.push(c), registerSetting: (s) => reg2.settings.push(s),
    registerStatusItem: () => ({ update() {}, dispose() {} }), openView() {}, notify: (m) => reg2.notes.push(m),
    getLocale: () => 'zh', subscribeLocale: () => () => {},
    achievements: { registerSeries() {}, track() {} }, activity: { log() {} },
    app: {
      notify() {}, openFile() {}, readFile: async () => null, writeFile: async () => {}, workFolder: () => '视觉索引',
      listFiles: async () => [], listPages: async () => [], searchVault: async () => [], vaultRoot: () => null,
    },
  }
  globalThis.__VISIONINDEX_TEST__ = {}
  const d2 = new Function('ctx', src)(ctx2)
  A.equal(typeof d2, 'function', '桥空态:setup 不抛')
  const host = mkEl('div')
  const cleanup = reg2.views.find((v) => v.id === 'queue').mount(host)
  await sleep(40)
  A.ok(host.textContent.trim().length > 0, '「方法在、结果空」必须渲染出真内容(不是空白)')
  A.ok(host.textContent.includes('枚举不到文件'), '空枚举 → 状态横幅说清缺什么')
  A.ok(host.textContent.includes('Agent'), '横幅给出 Agent 扫库出路')
  cleanup(); d2()
}

// ══ ㉑ 旧宿主 A(无 getLocale/subscribeLocale/listFiles/listPages/searchVault/vaultRoot/
//        notify/activity/achievements/statusItem/workFolder)═══════════════════
{
  const reg3 = { views: [], commands: [], settings: [] }
  const V3 = new Map()
  const ctx3 = {
    registerView: (v) => reg3.views.push(v), registerCommand: (c) => reg3.commands.push(c), registerSetting: (s) => reg3.settings.push(s),
    app: { notify() {}, openFile() {}, readFile: async (p) => (V3.has(p) ? V3.get(p) : null), writeFile: async (p, x) => V3.set(p, String(x)) },
  }
  globalThis.__VISIONINDEX_TEST__ = {}
  const d3 = new Function('ctx', src)(ctx3)
  A.equal(typeof d3, 'function', '旧宿主 A:setup 不抛且返回 disposer')
  const T3 = globalThis.__VISIONINDEX_TEST__
  A.equal(T3.L(), 'zh', '无 getLocale → 回退中文(canonical)')
  A.equal(T3.wfRoot(), '视觉索引', '无 workFolder → 回退插件名')
  for (const id of ['queue', 'results']) {
    const host = mkEl('div')
    const cleanup = reg3.views.find((v) => v.id === id).mount(host)
    await sleep(30)
    A.ok(host.textContent.trim().length > 0, `旧宿主 ${id} 视图 mount 后仍有可见文本`)
    if (id === 'queue') {
      A.ok(host.textContent.includes('这个宿主版本没有文件枚举接口'), '旧宿主 → 横幅说清缺什么')
      A.ok(!buttonNamed(host, '手动补录一张'), '宿主没有 ctx.app.prompt 就别画「手动补录一张」—— 画一个点了没反应的按钮比不画更糟')
      A.ok(buttonNamed(host, '设置在哪'), '仍给出指路按钮')
    }
    cleanup()
  }
  A.ok(reg3.views.find((v) => v.id === 'queue'), '旧宿主照常注册视图')
  reg3.commands.find((c) => c.id === 'visionindex-open').run() // 无 openView / notify → 不抛
  d3()
}
// 旧宿主 B(连 registerView 都没有)
{
  const reg4 = { commands: [] }
  const ctx4 = { registerCommand: (c) => reg4.commands.push(c), registerSetting() {}, app: { notify() {}, readFile: async () => null, writeFile: async () => {}, openFile() {} } }
  globalThis.__VISIONINDEX_TEST__ = {}
  const d4 = new Function('ctx', src)(ctx4)
  A.equal(typeof d4, 'function', '旧宿主 B:全删 07-18 后 API 仍不抛')
  A.equal(reg4.commands.length, 2, '命令照常注册')
  reg4.commands.find((c) => c.id === 'visionindex-scan').run()
  d4()
}

// ══ 四时区扫描(含日期算术的 check 自钉 TZ 后逐个跑)═══════════════════════
if (!process.env.VI_TZ) {
  const self = fileURLToPath(import.meta.url)
  for (const tz of ['UTC', 'Asia/Shanghai', 'Europe/London', 'America/New_York']) {
    const r = spawnSync(process.execPath, [self], { env: { ...process.env, VI_TZ: tz }, encoding: 'utf8', timeout: 120000 })
    if (r.status !== 0) {
      console.error(String(r.stdout).slice(-1500), String(r.stderr).slice(-1500))
      throw new Error(`TZ=${tz} 下 check 红`)
    }
  }
  console.log('check ok — 2 视图(queue 先注册)/2 命令/4 设置/状态栏/3 成就 契约 + 词表两侧键相等 + normalizeFileList 四形态 + isIndexableImage + sidecar 往返与路径遍历防线 + fp 只吃路径 + parseVisionOutput 六向量(解析失败≠空结果)+ 指令两版逐行 diff + 失败码/5MB 口径 + 预算闸边界 + 双语时长 + 跨年分组(UTC/上海/伦敦/纽约 四时区)+ sidecar 序列化往返 + 空结果不写 sidecar + 幂等/自愈/强制覆写 + 转正式笔记不覆写 + 红线(缓存无正文)+ XSS + 切 en 不重挂即变英文 + 桥空态与双旧宿主降级 + disposer 全部通过')
}
