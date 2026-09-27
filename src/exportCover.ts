import { coverLayout, SPLIT } from './cover'
import { shapePathCommands, tracePath } from './shape'
import type {
  CanvasLayer,
  GradientCfg,
  ImageLayer,
  ImgTransform,
  ShapeLayer,
  TextLayer,
} from './types'

interface RenderArgs {
  W: number
  H: number
  img: HTMLImageElement
  tf: ImgTransform
  gradient: GradientCfg
  layers: CanvasLayer[]
}

const FONT_FALLBACK =
  '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif'

function fontString(font: string, bold: boolean, italic: boolean, fs: number) {
  return `${bold ? 700 : 500} ${italic ? 'italic' : ''} ${fs}px "${font}", ${FONT_FALLBACK}`
}

/** CSS 角度转方向向量：0deg 朝上，90deg 朝右 */
function gradientPoints(angleDeg: number, x: number, y: number, w: number, h: number) {
  const rad = (angleDeg * Math.PI) / 180
  const dx = Math.sin(rad)
  const dy = -Math.cos(rad)
  const len = w * Math.abs(dx) + h * Math.abs(dy)
  const cx = x + w / 2
  const cy = y + h / 2
  return {
    x0: cx - (dx * len) / 2,
    y0: cy - (dy * len) / 2,
    x1: cx + (dx * len) / 2,
    y1: cy + (dy * len) / 2,
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

/** 将当前封面按给定像素尺寸渲染到 canvas（用于高清导出） */
export function renderCover({
  W,
  H,
  img,
  tf,
  gradient,
  layers,
  images,
}: RenderArgs & { images: Map<string, HTMLImageElement> }): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!

  const splitY = H * SPLIT

  // 1) 图片铺满整张画布
  const l = coverLayout(img, W, H, tf)
  ctx.drawImage(img, l.drawX, l.drawY, l.drawW, l.drawH)

  // 2) 上方 1/2 半透明渐变色块，底部渐隐融入图片
  //    用单独离屏 canvas 渲染渐变+渐隐，避免 destination-in 破坏主 canvas 上的图片
  const gradCanvas = document.createElement('canvas')
  gradCanvas.width = W
  gradCanvas.height = H
  const gctx = gradCanvas.getContext('2d')!
  gctx.globalAlpha = gradient.opacity / 100
  const g = gradientPoints(gradient.angle, 0, 0, W, splitY)
  const grad = gctx.createLinearGradient(g.x0, g.y0, g.x1, g.y1)
  grad.addColorStop(0, gradient.from)
  grad.addColorStop(1, gradient.to)
  gctx.fillStyle = grad
  gctx.fillRect(0, 0, W, splitY)
  // 底部渐隐
  gctx.globalCompositeOperation = 'destination-in'
  const fade = gctx.createLinearGradient(0, 0, 0, splitY)
  fade.addColorStop(0, 'rgba(0,0,0,1)')
  fade.addColorStop(0.55, 'rgba(0,0,0,1)')
  fade.addColorStop(1, 'rgba(0,0,0,0)')
  gctx.fillStyle = fade
  gctx.fillRect(0, 0, W, splitY)
  // 合成到主 canvas
  ctx.drawImage(gradCanvas, 0, 0)

  // 3) 逐个绘制图层（图形 / 图片 / 文字）
  for (const layer of layers) {
    if (layer.kind === 'shape') drawShapeLayer(ctx, layer, W, H)
    else if (layer.kind === 'image') drawImageLayer(ctx, layer, W, H, images)
    else if (layer.text.trim()) drawTextLayer(ctx, layer, W, H)
  }

  return canvas
}

/** 绘制图形元素（与预览 SVG 共用同一套路径指令） */
function drawShapeLayer(
  ctx: CanvasRenderingContext2D,
  layer: ShapeLayer,
  W: number,
  H: number,
) {
  const wPx = (layer.wPct / 100) * W
  const hPx = (layer.hPct / 100) * W
  const cx = layer.x * W
  const cy = layer.y * H
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate((layer.rotation * Math.PI) / 180)
  ctx.globalAlpha = layer.opacity / 100

  const ox = -wPx / 2
  const oy = -hPx / 2
  const cmds = shapePathCommands(layer.shape, wPx, hPx)
  ctx.save()
  ctx.translate(ox, oy)
  if (cmds) {
    tracePath(ctx, cmds)
  } else if (layer.shape === 'rect' || layer.shape === 'square') {
    ctx.beginPath()
    ctx.rect(0, 0, wPx, hPx)
  } else {
    // circle / ellipse
    ctx.beginPath()
    ctx.ellipse(wPx / 2, hPx / 2, wPx / 2, hPx / 2, 0, 0, Math.PI * 2)
  }
  ctx.fillStyle = layer.fill
  ctx.fill()
  if (layer.stroke.enabled) {
    ctx.globalAlpha = 1
    ctx.strokeStyle = layer.stroke.color
    ctx.lineWidth = (layer.stroke.width / 100) * W
    ctx.lineJoin = 'round'
    ctx.stroke()
  }
  ctx.restore()
  ctx.restore()
}

/** 绘制图片元素 */
function drawImageLayer(
  ctx: CanvasRenderingContext2D,
  layer: ImageLayer,
  W: number,
  H: number,
  images: Map<string, HTMLImageElement>,
) {
  const img = images.get(layer.src)
  if (!img || !img.complete || img.naturalWidth === 0) return
  const wPx = (layer.wPct / 100) * W
  const hPx = (layer.hPct / 100) * W
  ctx.save()
  ctx.translate(layer.x * W, layer.y * H)
  ctx.rotate((layer.rotation * Math.PI) / 180)
  ctx.globalAlpha = layer.opacity / 100
  ctx.drawImage(img, -wPx / 2, -hPx / 2, wPx, hPx)
  ctx.restore()
}

function drawTextLayer(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer,
  W: number,
  H: number,
) {
  const fs = (layer.sizePct / 100) * W
  ctx.font = fontString(layer.font, layer.bold, layer.italic, fs)
  ctx.fillStyle = layer.color
  ctx.textAlign = layer.align
  ctx.textBaseline = 'middle'

  const strokeW = layer.stroke.enabled ? (layer.stroke.width / 100) * W : 0
  if (layer.stroke.enabled) {
    ctx.lineWidth = strokeW
    ctx.strokeStyle = layer.stroke.color
    ctx.lineJoin = 'round'
  }

  // 阴影状态由 drawGlyph 逐字管理（阴影层与字形层分离，避免污染填充色）

  const anchorX = layer.x * W
  const anchorY = layer.y * H

  ctx.save()
  ctx.translate(anchorX, anchorY)
  ctx.rotate((layer.rotation * Math.PI) / 180)

  if (layer.layout === 'horizontal' || layer.layout === 'slanted') {
    drawHorizontal(ctx, layer, fs, W)
  } else if (layer.layout === 'vertical') {
    drawVertical(ctx, layer, fs, W)
  } else {
    drawCurved(ctx, layer, fs, W)
  }

  ctx.restore()
}

/**
 * 绘制一行/一字（横排行、竖排字、弯曲字通用）：
 * 1) 阴影层：字形 + 描边一起投出阴影（等价 CSS text-shadow 在文字后方）
 * 2) 关闭阴影后重画：先描边、后填充 —— 描边只露外侧一半，填充色保持纯净
 */
function drawGlyph(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  layer: TextLayer,
  W: number,
) {
  const s = layer.shadow
  if (s.enabled) {
    ctx.shadowColor = s.color
    ctx.shadowBlur = (s.blur / 100) * W
    ctx.shadowOffsetX = (s.offsetX / 100) * W
    ctx.shadowOffsetY = (s.offsetY / 100) * W
  }
  ctx.fillText(text, x, y)
  if (layer.stroke.enabled) ctx.strokeText(text, x, y)
  // 关闭阴影
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
  // 干净层：描边在填充下方
  if (layer.stroke.enabled) ctx.strokeText(text, x, y)
  ctx.fillText(text, x, y)
}

/** 横排 / 斜排：按 \n 分行（不自动换行，与预览 nowrap 一致） */
function drawHorizontal(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer,
  fs: number,
  W: number,
) {
  const lineHeight = fs * 1.3
  const lines = layer.text.split('\n')
  const totalH = lineHeight * lines.length
  const startY = -totalH / 2 + lineHeight / 2

  // 背景块（关闭阴影，避免背景带阴影）
  if (layer.bg.enabled) {
    ctx.save()
    ctx.globalAlpha = layer.bg.opacity / 100
    ctx.fillStyle = layer.bg.color
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 0
    // 左右内边距控制宽度，上下内边距控制高度
    const padX = ((layer.bg.paddingX ?? layer.bg.paddingY) / 100) * W
    const padY = ((layer.bg.paddingY ?? layer.bg.paddingX) / 100) * W
    const radius = (layer.bg.radius / 100) * W
    lines.forEach((line, i) => {
      const lw = ctx.measureText(line).width
      const cy = startY + i * lineHeight
      // 字形相对锚点的左边界
      let glyphLeft = 0
      if (layer.align === 'center') glyphLeft = -lw / 2
      else if (layer.align === 'right') glyphLeft = -lw
      // 背景块左右各留 padX（与预览 padding 一致）
      const bx = glyphLeft - padX
      const bw = lw + padX * 2
      const bh = fs + padY * 2
      const by = cy - bh / 2
      roundRect(ctx, bx, by, bw, bh, radius)
      ctx.fill()
    })
    ctx.restore()
  }

  lines.forEach((line, i) => {
    const y = startY + i * lineHeight
    drawGlyph(ctx, line, 0, y, layer, W)
    drawTextDecorations(ctx, line, 0, y, fs, layer, layer.align)
  })
}

/** 绘制下划线 / 删除线（save/restore 避免污染描边状态） */
function drawTextDecorations(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fs: number,
  layer: TextLayer,
  align: 'left' | 'center' | 'right',
) {
  if (!layer.underline && !layer.strikethrough) return
  const tw = ctx.measureText(text).width
  let lineX = x
  if (align === 'center') lineX = x - tw / 2
  else if (align === 'right') lineX = x - tw
  ctx.save()
  ctx.strokeStyle = layer.color
  ctx.lineWidth = Math.max(1, fs * 0.06)
  if (layer.underline) {
    const uy = y + fs * 0.35
    ctx.beginPath()
    ctx.moveTo(lineX, uy)
    ctx.lineTo(lineX + tw, uy)
    ctx.stroke()
  }
  if (layer.strikethrough) {
    ctx.beginPath()
    ctx.moveTo(lineX, y)
    ctx.lineTo(lineX + tw, y)
    ctx.stroke()
  }
  ctx.restore()
}

/** 竖排：逐字自上而下排列，字符保持正立 */
function drawVertical(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer,
  fs: number,
  W: number,
) {
  const chars = Array.from(layer.text)
  const totalH = fs * chars.length
  let y = -totalH / 2 + fs / 2
  for (const ch of chars) {
    drawGlyph(ctx, ch, 0, y, layer, W)
    y += fs
  }
}

/** 弯曲排列：沿圆弧逐字绘制 */
function drawCurved(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer,
  _fs: number,
  W: number,
) {
  const chars = Array.from(layer.text)
  const n = chars.length
  if (n === 0) return
  const r = (layer.curveRadius / 100) * W
  const arcRad = (layer.curveArc * Math.PI) / 180
  const flip = layer.curveFlip

  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1) - 0.5
    const theta = t * arcRad
    // 弧心在锚点正下方(flip=false)或正上方(flip=true)
    const x = r * Math.sin(theta)
    const y = flip ? -r * (1 - Math.cos(theta)) : r * (1 - Math.cos(theta))
    const charRot = flip ? -theta : theta

    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(charRot)
    drawGlyph(ctx, chars[i], 0, 0, layer, W)
    ctx.restore()
  }
}

export function downloadCover(canvas: HTMLCanvasElement, filename: string) {
  canvas.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }, 'image/png')
}
