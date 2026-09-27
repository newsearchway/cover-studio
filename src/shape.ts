import type { ImageLayer, ShapeKind, ShapeLayer } from './types'
import { newLayerId } from './textLayer'

/** 图形元数据：名称、是否锁定宽高比、按钮图标 */
export const SHAPE_META: Record<ShapeKind, { label: string; lock: boolean; icon: string }> = {
  rect: { label: '矩形', lock: false, icon: '▭' },
  square: { label: '方形', lock: true, icon: '◻' },
  ellipse: { label: '椭圆', lock: false, icon: '▯' },
  circle: { label: '圆形', lock: true, icon: '●' },
  triangle: { label: '三角', lock: true, icon: '▲' },
  star: { label: '星形', lock: true, icon: '★' },
  heart: { label: '心形', lock: true, icon: '♥' },
  arrow: { label: '箭头', lock: true, icon: '➤' },
  bubble: { label: '对话框', lock: false, icon: '💬' },
  moon: { label: '弯月', lock: true, icon: '☾' },
  ribbon: { label: '丝带', lock: false, icon: '🎗' },
}

export const SHAPE_ORDER: ShapeKind[] = [
  'rect',
  'square',
  'ellipse',
  'circle',
  'triangle',
  'star',
  'heart',
  'arrow',
  'bubble',
  'moon',
  'ribbon',
]

/** 需要 evenodd 填充规则的图形（弯月由两个圆相减得到） */
export const SHAPE_EVENODD: Set<ShapeKind> = new Set<ShapeKind>(['moon'])

/** 新建图形图层（默认居中、尺寸为画布宽 30%） */
export function createDefaultShape(shape: ShapeKind, partial?: Partial<ShapeLayer>): ShapeLayer {
  return {
    id: newLayerId(),
    kind: 'shape',
    shape,
    x: 0.5,
    y: 0.5,
    rotation: 0,
    wPct: 30,
    hPct: 30,
    fill: '#6366f1',
    opacity: 100,
    stroke: { enabled: false, color: '#ffffff', width: 0.5 },
    ...partial,
  }
}

/** 新建图片元素图层 */
export function createDefaultImageLayer(
  src: string,
  naturalWidth: number,
  naturalHeight: number,
  partial?: Partial<ImageLayer>,
): ImageLayer {
  // 默认宽度占画布 40%，高度按原图比例换算（与宽度同基数：占画布宽度百分比）
  const wPct = 40
  const hPct = (naturalHeight / naturalWidth) * wPct
  return {
    id: newLayerId(),
    kind: 'image',
    x: 0.5,
    y: 0.5,
    rotation: 0,
    src,
    wPct,
    hPct,
    opacity: 100,
    naturalWidth,
    naturalHeight,
    ...partial,
  }
}

/* ============================================================
 * 共享几何：预览(SVG) 与 导出(Canvas) 共用同一套路径指令，
 * 保证三角形/星形/心形在两端渲染完全一致。
 * ============================================================ */
export type PathCmd =
  | { t: 'M'; x: number; y: number }
  | { t: 'L'; x: number; y: number }
  | { t: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { t: 'Z' }

/** 多边形顶点（三角形、星形）：在 w×h 盒子内居中 */
function polygonPoints(kind: 'triangle' | 'star', w: number, h: number): { x: number; y: number }[] {
  const cx = w / 2
  const cy = h / 2
  const rx = w / 2
  const ry = h / 2
  if (kind === 'triangle') {
    return [
      { x: cx, y: cy - ry },
      { x: cx - rx, y: cy + ry },
      { x: cx + rx, y: cy + ry },
    ]
  }
  // 五角星：5 个外顶点 + 5 个内顶点交替
  const inner = 0.42
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 1 : inner
    // 起始顶点朝上：-90°
    const a = (Math.PI / 5) * i - Math.PI / 2
    pts.push({ x: cx + rx * r * Math.cos(a), y: cy + ry * r * Math.sin(a) })
  }
  return pts
}

/** 心形贝塞尔路径（经典心形参数方程，在 w×h 盒子内居中并占满） */
function heartPath(w: number, h: number): PathCmd[] {
  // 以 36×32 的经典心形盒为基准，缩放至 w×h 并居中
  const scale = Math.min(w / 36, h / 32)
  const ox = w / 2
  const oy = h / 2 - 1 * scale // 微调使视觉居中
  const P = (x: number, y: number) => ({ x: ox + x * scale, y: oy + y * scale })
  const c1 = P(-16, -2)
  const c2 = P(-16, -14)
  const mid = P(0, -8)
  const c3 = P(16, -14)
  const c4 = P(16, -2)
  const tip = P(0, 10)
  return [
    { t: 'M', x: tip.x, y: tip.y },
    { t: 'C', x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: mid.x, y: mid.y },
    { t: 'C', x1: c3.x, y1: c3.y, x2: c4.x, y2: c4.y, x: tip.x, y: tip.y },
    { t: 'Z' },
  ]
}

/** 用 4 段三次贝塞尔近似整圆（k=0.5522847），原点在左上角的 w×h 盒内 */
function circlePath(cx: number, cy: number, r: number): PathCmd[] {
  const k = 0.5522847 * r
  return [
    { t: 'M', x: cx + r, y: cy },
    { t: 'C', x1: cx + r, y1: cy + k, x2: cx + k, y2: cy + r, x: cx, y: cy + r },
    { t: 'C', x1: cx - k, y1: cy + r, x2: cx - r, y2: cy + k, x: cx - r, y: cy },
    { t: 'C', x1: cx - r, y1: cy - k, x2: cx - k, y2: cy - r, x: cx, y: cy - r },
    { t: 'C', x1: cx + k, y1: cy - r, x2: cx + r, y2: cy - k, x: cx + r, y: cy },
    { t: 'Z' },
  ]
}

/** 圆角矩形路径（用单段三次贝塞尔近似每个角），原点在左上角 */
function roundRectPath(x: number, y: number, w: number, h: number, r: number): PathCmd[] {
  const rr = Math.min(r, w / 2, h / 2)
  return [
    { t: 'M', x: x + rr, y },
    { t: 'L', x: x + w - rr, y },
    { t: 'C', x1: x + w, y1: y, x2: x + w, y2: y, x: x + w, y: y + rr },
    { t: 'L', x: x + w, y: y + h - rr },
    { t: 'C', x1: x + w, y1: y + h, x2: x + w, y2: y + h, x: x + w - rr, y: y + h },
    { t: 'L', x: x + rr, y: y + h },
    { t: 'C', x1: x, y1: y + h, x2: x, y2: y + h, x, y: y + h - rr },
    { t: 'L', x, y: y + rr },
    { t: 'C', x1: x, y1: y, x2: x, y2: y, x: x + rr, y },
    { t: 'Z' },
  ]
}

/** 箭头（朝上）：杆 + 三角箭头帽，在 w×h 盒内居中；旋转可调到任意方向 */
function arrowPath(w: number, h: number): PathCmd[] {
  const cx = w / 2
  const shaftHalf = w * 0.16 // 杆半宽
  const headY = h * 0.36 // 箭头帽与杆的分界
  return [
    { t: 'M', x: cx, y: 0 },
    { t: 'L', x: w, y: headY },
    { t: 'L', x: cx + shaftHalf, y: headY },
    { t: 'L', x: cx + shaftHalf, y: h },
    { t: 'L', x: cx - shaftHalf, y: h },
    { t: 'L', x: cx - shaftHalf, y: headY },
    { t: 'L', x: 0, y: headY },
    { t: 'Z' },
  ]
}

/** 对话框：圆角矩形主体 + 左下角三角尾巴（两个子路径） */
function bubblePath(w: number, h: number): PathCmd[] {
  const r = Math.min(w, h) * 0.1
  const bodyH = h * 0.8
  const cmds: PathCmd[] = roundRectPath(0, 0, w, bodyH, r)
  // 左下角三角尾巴
  cmds.push(
    { t: 'M', x: w * 0.22, y: bodyH },
    { t: 'L', x: w * 0.1, y: h },
    { t: 'L', x: w * 0.38, y: bodyH },
    { t: 'Z' },
  )
  return cmds
}

/** 弯月：外圆减内圆（evenodd），两个圆子路径 */
function moonPath(w: number, h: number): PathCmd[] {
  const cx = w / 2
  const cy = h / 2
  const r = Math.min(w, h) * 0.46
  const outer = circlePath(cx, cy, r)
  // 内圆向右上偏移，挖出月牙
  const inner = circlePath(cx + r * 0.42, cy - r * 0.28, r * 0.86)
  return [...outer, ...inner]
}

/** 丝带/横幅：矩形右侧带三角燕尾 */
function ribbonPath(w: number, h: number): PathCmd[] {
  const fork = w * 0.2
  return [
    { t: 'M', x: 0, y: h * 0.22 },
    { t: 'L', x: w - fork, y: h * 0.22 },
    { t: 'L', x: w - fork, y: 0 },
    { t: 'L', x: w, y: h * 0.5 },
    { t: 'L', x: w - fork, y: h },
    { t: 'L', x: w - fork, y: h * 0.78 },
    { t: 'L', x: 0, y: h * 0.78 },
    { t: 'Z' },
  ]
}

/** 生成图形的路径指令（三角形/星形/心形/箭头/对话框/弯月/丝带）；rect/circle/ellipse 由调用方用原语绘制 */
export function shapePathCommands(kind: ShapeKind, w: number, h: number): PathCmd[] | null {
  if (kind === 'triangle' || kind === 'star') {
    const pts = polygonPoints(kind, w, h)
    const cmds: PathCmd[] = []
    pts.forEach((pt, i) => {
      cmds.push(i === 0 ? { t: 'M', x: pt.x, y: pt.y } : { t: 'L', x: pt.x, y: pt.y })
    })
    cmds.push({ t: 'Z' })
    return cmds
  }
  if (kind === 'heart') return heartPath(w, h)
  if (kind === 'arrow') return arrowPath(w, h)
  if (kind === 'bubble') return bubblePath(w, h)
  if (kind === 'moon') return moonPath(w, h)
  if (kind === 'ribbon') return ribbonPath(w, h)
  return null
}

/** 路径指令 → SVG path d 字符串 */
export function pathToSvgD(cmds: PathCmd[]): string {
  return cmds
    .map((c) => {
      if (c.t === 'Z') return 'Z'
      if (c.t === 'M') return `M${c.x.toFixed(2)} ${c.y.toFixed(2)}`
      if (c.t === 'L') return `L${c.x.toFixed(2)} ${c.y.toFixed(2)}`
      return `C${c.x1.toFixed(2)} ${c.y1.toFixed(2)} ${c.x2.toFixed(2)} ${c.y2.toFixed(2)} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`
    })
    .join(' ')
}

/** 路径指令 → Canvas 描边（不填充，由调用方决定 fill/stroke） */
export function tracePath(ctx: CanvasRenderingContext2D, cmds: PathCmd[]) {
  ctx.beginPath()
  for (const c of cmds) {
    if (c.t === 'M') ctx.moveTo(c.x, c.y)
    else if (c.t === 'L') ctx.lineTo(c.x, c.y)
    else if (c.t === 'C') ctx.bezierCurveTo(c.x1, c.y1, c.x2, c.y2, c.x, c.y)
    else if (c.t === 'Z') ctx.closePath()
  }
}
