/**
 * 视觉索引 立项闸仪器(SPEC step 0,调试铁律 5:仪器留在仓里,下次从跑脚本开始)。
 *
 * 问的是**一个**问题:一次真实的 host run,能不能用 view_image 读出某张图里的字?
 *
 *   node probe.mjs --image /abs/path/to/shot.png                    # 绝对路径版(阶梯 ①)
 *   node probe.mjs --rel Attachments/2026/board.png                 # 相对路径版(阶梯 ③a:
 *                                                                   #   不给绝对路径,看 Agent 能不能
 *                                                                   #   靠系统提示里的 vault 路径自己解析)
 *   可选:--backend http://localhost:3001/api  --token <jwt>  --cwd <vault 绝对路径>  --raw
 *
 * ⚠️ 指令段**不在本文件里**:它经 main.js 文末 __VISIONINDEX_TEST__ 钩子取 buildExtractMessage ——
 *    probe 里再抄一份提示词,测的就不是真管线了(SPEC 明令禁止)。
 * ⚠️ token:优先 --token;缺省时在**本进程内**读 ~/.forsion-dev/auth.json → ~/.forsion/auth.json。
 *    绝不打印、绝不落盘、Authorization 头不进任何输出。
 * ⚠️ vault 绝对路径同样是敏感信息:本脚本只在内存里用它拼指令,不写进任何文件。
 *
 * 退出码:0 = 闸过(拿到 visionindex-text 围栏,内容可以为空——纯色图本来就没字);1 = 闸未过。
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const argv = process.argv.slice(2)
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt
}
const flag = (name) => argv.includes(`--${name}`)

const image = arg('image', '')
const rel = arg('rel', '')
if (!image && !rel) {
  console.error('用法: node probe.mjs --image <绝对路径> | --rel <vault 相对路径> [--backend url] [--token jwt] [--cwd vault绝对路径] [--raw]')
  process.exit(2)
}

/** 本进程内取 token —— 只回传字符串给 fetch,任何输出里都不出现。
 *  桌面端自带的**本机引擎**(127.0.0.1:<随机端口>)用 desktop-local-token;
 *  云端后端(server)用 auth.json 里的 JWT。 */
function localToken(forLocalEngine) {
  const homes = ['.forsion-dev', '.forsion']
  // 顺序与 desktop 的 backendManager.getToken() 一致:auth.json(登录态唯一真源)> 本地回退令牌。
  for (const home of homes) {
    try {
      const j = JSON.parse(readFileSync(path.join(homedir(), home, 'auth.json'), 'utf8'))
      const v = j.token || j.accessToken || j.access_token || j.jwt || (j.auth && j.auth.token) || ''
      if (typeof v === 'string' && v.length > 10) return v
    } catch { /* 下一个 */ }
  }
  if (forLocalEngine) {
    for (const home of homes) {
      try {
        const v = readFileSync(path.join(homedir(), home, 'desktop-local-token'), 'utf8').trim()
        if (v.length > 10) return v
      } catch { /* 下一个 */ }
    }
  }
  return ''
}
const backend = arg('backend', process.env.FORSION_BACKEND || 'http://localhost:3001/api')
const isLocalEngine = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/)?$/i.test(backend.replace(/\/+$/, ''))
const token = arg('token', process.env.FORSION_TOKEN || localToken(isLocalEngine))
if (!token) {
  console.error('❌ 没有 token:传 --token <jwt>,或先在 Forsion 桌面端登录(会写 ~/.forsion-dev/auth.json)')
  process.exit(2)
}

// ── 用宿主同款方式装载 main.js,取真管线的纯函数 ──
globalThis.__VISIONINDEX_TEST__ = {}
const src = readFileSync(new URL('./main.js', import.meta.url), 'utf8')
const noop = () => {}
const ctx = {
  registerSetting: noop, registerCommand: noop, registerView: noop,
  registerStatusItem: () => ({ update: noop, dispose: noop }),
  openView: noop, notify: noop,
  getLocale: () => 'zh',
  achievements: { registerSeries: noop, track: noop },
  activity: { log: noop },
  app: { notify: noop, readFile: async () => null, writeFile: async () => {}, openFile: noop, workFolder: () => '视觉索引' },
}
globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop }
const dispose = new Function('ctx', src)(ctx)
const T = globalThis.__VISIONINDEX_TEST__

const message = T.buildExtractMessage(image ? { absPath: image } : { relPath: rel })
const cwd = arg('cwd', image ? path.dirname(image) : '')

console.log('── 立项闸 probe ─────────────────────────────────────────────')
console.log(`模式    : ${image ? '绝对路径(阶梯 ①)' : '相对路径 + 系统提示解析(阶梯 ③a)'}`)
console.log(`目标    : ${image || rel}`)
console.log(`后端    : ${backend}`)
console.log(`指令段  : ${message.split('\n').length} 行,来自 buildExtractMessage(与插件运行时逐字相同)`)
console.log('')

const started = Date.now()
let raw = ''
let runError = null
try {
  raw = await T.runAgent({ backendUrl: backend, token }, T.uuid(), message, null, cwd)
} catch (e) {
  runError = e
}
const secs = ((Date.now() - started) / 1000).toFixed(1)

if (runError) {
  console.error(`❌ run 失败(${secs}s):${String((runError && runError.message) || runError).slice(0, 400)}`)
  console.error('   闸未过 → 按 SPEC「终极降级」收缩范围,并把本段原始输出贴进交付回复。')
  dispose()
  process.exit(1)
}

console.log(`── 原始产出(${secs}s,${raw.length} 字符)────────────────────`)
console.log(flag('raw') ? raw : raw.slice(0, 1500) + (raw.length > 1500 ? `\n…(还有 ${raw.length - 1500} 字符,加 --raw 看全)` : ''))
console.log('')

const parsed = T.parseVisionOutput(raw)
console.log('── parseVisionOutput ────────────────────────────────────────')
console.log(JSON.stringify({ ok: parsed.ok, reason: parsed.reason, empty: parsed.empty, truncated: parsed.truncated, meta: parsed.meta, chars: T.countChars(parsed.text) }, null, 2))
if (parsed.ok) console.log('\n── 识别出的正文(前 600 字符)───────────────────────────────\n' + parsed.text.slice(0, 600))
else console.log(`\nclassifyFailure → ${T.classifyFailure(raw)}`)

dispose()
if (parsed.ok) {
  console.log(parsed.empty
    ? '\n✅ 闸过(管线通:围栏结构正确,但这张图没读出字 —— 换一张有字的图复测再施工)'
    : '\n✅ 闸过:host run 真的用 view_image 读出了图里的字')
  process.exit(0)
}
console.log('\n❌ 闸未过:没有拿到 visionindex-text 围栏 → 按 SPEC「终极降级」收缩范围')
process.exit(1)
