import type { ImageLayer, ShapeKind, ShapeLayer } from './types'
import { newLayerId } from './textLayer'

/** 图形元数据：名称、是否锁定宽高比（圆/方/星/心/三角锁定，矩形/椭圆可自由拉伸） */
export const SHAPE_META: Record<ShapeKind, { label: string; lock: boolean; icon: string }> = {
  rect: { label: '矩形', lock: false, icon: '▭' },
  square: { label: '方形', lock: true, icon: '◻' },
  ellipse: { label: '椭圆', lock: false, icon: '▯' },
  circle: { label: '圆形', lock: true, icon: '●' },
  triangle: { label: '三角', lock: true, icon: '▲' },
  star: { label: '星形', lock: true, icon: '★' },
  heart: { label: '心形', lock: true, icon: '♥' },
}

export const SHAPE_ORDER: ShapeKind[] = ['rect', 'square', 'ellipse', 'circle', 'triangle', 'star', 'heart']

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

/** 生成图形的路径指令（三角形/星形/心形）；rect/circle/ellipse 由调用方用原语绘制 */
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
