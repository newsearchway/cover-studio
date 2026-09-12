import type { ImgTransform, RatioKey } from './types'

/** 各比例导出的像素尺寸（短边 1080） */
export const RATIO_SIZE: Record<RatioKey, { w: number; h: number; label: string }> = {
  '3:4': { w: 1080, h: 1440, label: '3 : 4' },
  '9:16': { w: 1080, h: 1920, label: '9 : 16' },
  '4:3': { w: 1440, h: 1080, label: '4 : 3' },
}

/** 渐变标题区占画布高度的比例（上 1/2） */
export const SPLIT = 1 / 2

export const MIN_SCALE = 1
export const MAX_SCALE = 4

export interface CoverLayout {
  /** 图片绘制左上角与尺寸（导出像素空间） */
  drawX: number
  drawY: number
  drawW: number
  drawH: number
  splitY: number
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/**
 * 计算图片在整张画布内的 cover 填充布局。
 * 图片铺满整张画布，上方 1/2 会被半透明渐变覆盖，从而隐约透出图片。
 */
export function coverLayout(
  img: HTMLImageElement,
  W: number,
  H: number,
  tf: ImgTransform,
): CoverLayout {
  const splitY = H * SPLIT
  const base = Math.max(W / img.naturalWidth, H / img.naturalHeight)
  const drawW = img.naturalWidth * base * tf.scale
  const drawH = img.naturalHeight * base * tf.scale

  const drawX = clamp(tf.ux * W, W - drawW, 0)
  const drawY = clamp(tf.uy * H, H - drawH, 0)

  return { drawX, drawY, drawW, drawH, splitY }
}

/** 居中、缩放为 1 的初始变换 */
export function centerTransform(
  img: HTMLImageElement,
  W: number,
  H: number,
): ImgTransform {
  const base = Math.max(W / img.naturalWidth, H / img.naturalHeight)
  const drawW = img.naturalWidth * base
  const drawH = img.naturalHeight * base
  return {
    scale: 1,
    ux: (W - drawW) / 2 / W,
    uy: (H - drawH) / 2 / H,
  }
}

/**
 * 以画布上某点 (px, py) 为锚点缩放图片，锚点下的图像内容保持不动。
 */
export function zoomAt(
  img: HTMLImageElement,
  W: number,
  H: number,
  tf: ImgTransform,
  factor: number,
  px: number,
  py: number,
): ImgTransform {
  const before = coverLayout(img, W, H, tf)
  const scale = clamp(tf.scale * factor, MIN_SCALE, MAX_SCALE)
  const k = scale / tf.scale

  // 光标对应的图片内归一化坐标
  const ix = (px - before.drawX) / before.drawW
  const iy = (py - before.drawY) / before.drawH

  const nextW = before.drawW * k
  const nextH = before.drawH * k
  let drawX = px - ix * nextW
  let drawY = py - iy * nextH
  drawX = clamp(drawX, W - nextW, 0)
  drawY = clamp(drawY, H - nextH, 0)

  return { scale, ux: drawX / W, uy: drawY / H }
}
