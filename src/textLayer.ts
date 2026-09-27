import { SPLIT } from './cover'
import { SYSTEM_FONTS } from './types'
import type { TextLayer } from './types'

let _id = 0
export const newLayerId = () => `layer_${Date.now().toString(36)}_${(_id++).toString(36)}`
const uid = newLayerId

export function createDefaultLayer(partial?: Partial<TextLayer>): TextLayer {
  return {
    id: uid(),
    kind: 'text',
    text: '在这里输入标题',
    font: 'PingFang SC',
    sizePct: 7,
    color: '#FFFFFF',
    bold: true,
    italic: false,
    underline: false,
    strikethrough: false,
    align: 'center',
    x: 0.5,
    y: SPLIT / 2,
    rotation: 0,
    layout: 'horizontal',
    curveRadius: 35,
    curveArc: 90,
    curveFlip: false,
    bg: { enabled: false, color: '#000000', opacity: 50, paddingX: 1.2, paddingY: 1, radius: 0.8 },
    stroke: { enabled: false, color: '#000000', width: 0.6 },
    shadow: { enabled: false, color: '#000000', blur: 1.2, offsetX: 0.4, offsetY: 0.6 },
    ...partial,
  }
}

/** 检测系统已安装字体（优先使用 Font Access API，否则回退到经典测量法） */
export async function detectFonts(candidates: string[]): Promise<string[]> {
  const nav = navigator as Navigator & {
    queryLocalFonts?: () => Promise<{ family: string }[]>
  }
  if (typeof nav.queryLocalFonts === 'function') {
    try {
      const fonts = await nav.queryLocalFonts()
      if (fonts.length > 0) {
        // 返回全部已装字体，去重并按名称排序
        const families = Array.from(new Set(fonts.map((f) => f.family))).sort((a, b) =>
          a.localeCompare(b, 'zh-Hans-CN'),
        )
        return families
      }
    } catch (e) {
      console.warn('[detectFonts] queryLocalFonts failed:', e)
    }
  }
  // 回退：用测量法检测候选字体是否可用
  return candidates.filter((f) => isFontAvailable(f))
}

/** 请求字体权限并加载全部系统字体（需要在用户手势中调用） */
export async function loadSystemFonts(): Promise<string[]> {
  const nav = navigator as Navigator & {
    queryLocalFonts?: () => Promise<{ family: string }[]>
  }
  if (typeof nav.queryLocalFonts === 'function') {
    try {
      const fonts = await nav.queryLocalFonts()
      if (fonts.length > 0) {
        const families = Array.from(new Set(fonts.map((f) => f.family))).sort((a, b) =>
          a.localeCompare(b, 'zh-Hans-CN'),
        )
        return families
      }
    } catch (e) {
      console.warn('[loadSystemFonts] queryLocalFonts failed, using fallback:', e)
    }
  }
  // 回退：用测量法检测候选字体
  return SYSTEM_FONTS.filter((f) => isFontAvailable(f))
}

/** 已导入的自定义字体（FontFace 引用 + 名称） */
const importedFonts: { face: FontFace; name: string }[] = []

/** ---------- 字体持久化（IndexedDB，刷新后无需重复导入） ---------- */
const FONT_DB = 'cover-studio-fonts'
const FONT_STORE = 'fonts'

function openFontDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FONT_DB, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(FONT_STORE)) {
        req.result.createObjectStore(FONT_STORE, { keyPath: 'name' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** 将字体文件持久化保存 */
async function persistFont(name: string, buffer: ArrayBuffer) {
  try {
    const db = await openFontDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(FONT_STORE, 'readwrite')
      tx.objectStore(FONT_STORE).put({ name, buffer })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch (e) {
    console.warn('[persistFont] 字体保存失败:', e)
  }
}

/** 启动时恢复已导入的字体（注册 FontFace 并返回字体名列表） */
export async function restoreImportedFonts(): Promise<string[]> {
  try {
    const db = await openFontDB()
    const rows = await new Promise<{ name: string; buffer: ArrayBuffer }[]>(
      (resolve, reject) => {
        const tx = db.transaction(FONT_STORE, 'readonly')
        const req = tx.objectStore(FONT_STORE).getAll()
        req.onsuccess = () => resolve(req.result ?? [])
        req.onerror = () => reject(req.error)
      },
    )
    db.close()
    const names: string[] = []
    for (const row of rows) {
      try {
        const face = new FontFace(row.name, row.buffer)
        await face.load()
        document.fonts.add(face)
        importedFonts.push({ face, name: row.name })
        names.push(row.name)
      } catch {
        // 单个字体数据损坏时跳过
      }
    }
    return names
  } catch (e) {
    console.warn('[restoreImportedFonts] 字体恢复失败:', e)
    return []
  }
}

/** 从用户文件导入字体（.ttf / .otf / .woff / .woff2），同时持久化 */
export async function importFontFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  // 从文件名提取字体名（去后缀）
  const ext = file.name.replace(/\.[^.]+$/, '')
  const name = ext || '自定义字体'
  const face = new FontFace(name, buf)
  await face.load()
  document.fonts.add(face)
  importedFonts.push({ face, name })
  await persistFont(name, buf)
  return name
}

/** 获取已导入的自定义字体名列表 */
export function getImportedFonts(): string[] {
  return importedFonts.map((f) => f.name)
}

/** 常见字体英文名 -> 中文名映射，未命中则原样返回 */
const FONT_CN: Record<string, string> = {
  'PingFang SC': '苹方',
  'Hiragino Sans GB': '冬青黑体',
  'Microsoft YaHei': '微软雅黑',
  'Microsoft YaHei UI': '微软雅黑 UI',
  SimSun: '宋体',
  'NSimSun': '新宋体',
  SimHei: '黑体',
  KaiTi: '楷体',
  FangSong: '仿宋',
  'Heiti SC': '黑体-简',
  'Heiti TC': '黑体-繁',
  'Songti SC': '宋体-简',
  'Songti TC': '宋体-繁',
  'Kaiti SC': '楷体-简',
  'Kaiti TC': '楷体-繁',
  STKaiti: '华文楷体',
  STSong: '华文宋体',
  STHeiti: '华文黑体',
  STFangsong: '华文仿宋',
  'Yuanti SC': '圆体-简',
  'Yuanti TC': '圆体-繁',
  'Libian SC': '隶书-简',
  'Xingkai SC': '行楷-简',
  'Baoli SC': '报隶-简',
  'Caiyun Hanzi SC': '彩云汉字-简',
  'Wawati SC': '娃娃体-简',
  Arial: 'Arial',
  'Arial Black': 'Arial Black',
  'Times New Roman': 'Times New Roman',
  Georgia: 'Georgia',
  'Courier New': 'Courier New',
  Impact: 'Impact',
  Verdana: 'Verdana',
  'Comic Sans MS': 'Comic Sans MS',
  Tahoma: 'Tahoma',
  Trebuchet: 'Trebuchet MS',
}

export function localFontName(font: string): string {
  return FONT_CN[font] ?? font
}

function isFontAvailable(font: string): boolean {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 100
    canvas.height = 20
    const ctx = canvas.getContext('2d')!
    const text = 'mmmmmmmmmmlli'
    ctx.font = `72px "${font}", monospace`
    const w1 = ctx.measureText(text).width
    ctx.font = `72px monospace`
    const w2 = ctx.measureText(text).width
    return Math.abs(w1 - w2) > 0.5
  } catch {
    return true
  }
}
