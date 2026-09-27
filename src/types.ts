export type RatioKey = '3:4' | '9:16' | '4:3'

export interface GradientCfg {
  /** 起始色 */
  from: string
  /** 结束色 */
  to: string
  /** CSS 渐变角度（0deg=从下到上，90deg=从左到右，180deg=从上到下） */
  angle: number
  /** 渐变层不透明度 0-100，0 完全透明（露出图片），100 完全不透明 */
  opacity: number
}

/** 图片变换：scale 为相对 cover 填充的倍数；ux/uy 为绘制左上角相对画布的归一化位置 */
export interface ImgTransform {
  scale: number
  ux: number
  uy: number
}

export interface TitleBg {
  enabled: boolean
  color: string
  /** 背景不透明度 0-100 */
  opacity: number
  /** 背景水平内边距（左右，占画布宽度的百分比）→ 控制背景宽度 */
  paddingX: number
  /** 背景垂直内边距（上下，占画布宽度的百分比）→ 控制背景高度 */
  paddingY: number
  /** 圆角（占画布宽度的百分比） */
  radius: number
}

export interface TitleStroke {
  enabled: boolean
  color: string
  /** 描边宽度（占画布宽度的百分比） */
  width: number
}

export interface TitleShadow {
  enabled: boolean
  color: string
  /** 模糊半径（占画布宽度的百分比） */
  blur: number
  /** 水平偏移（占画布宽度的百分比） */
  offsetX: number
  /** 垂直偏移（占画布宽度的百分比） */
  offsetY: number
}

/** 文字排列方式 */
export type TextLayout = 'horizontal' | 'vertical' | 'slanted' | 'curved'

/** 画布图层种类：文字 / 图形 / 图片元素 */
export type LayerKind = 'text' | 'shape' | 'image'

/** 图形种类 */
export type ShapeKind = 'rect' | 'square' | 'circle' | 'ellipse' | 'triangle' | 'star' | 'heart'

/** 图层公共字段：锚点（中心）归一化坐标 + 旋转 */
export interface BaseLayer {
  id: string
  kind: LayerKind
  /** 锚点（中心）在画布中的归一化坐标 0-1 */
  x: number
  y: number
  /** 整体旋转角度（度） */
  rotation: number
}

export interface TextLayer extends BaseLayer {
  kind: 'text'
  text: string
  /** 字体族（系统字库） */
  font: string
  /** 字号占画布宽度的百分比，如 6 表示 6% */
  sizePct: number
  color: string
  bold: boolean
  italic: boolean
  underline: boolean
  strikethrough: boolean
  align: 'left' | 'center' | 'right'
  /** 锚点在画布中的归一化坐标 0-1 */
  x: number
  y: number
  /** 整体旋转角度（度），斜排时主要由它控制 */
  rotation: number
  /** 排列方式 */
  layout: TextLayout
  /** 弯曲排列：弧线半径（占画布宽度百分比） */
  curveRadius: number
  /** 弯曲排列：整段文字扫过的圆心角（度） */
  curveArc: number
  /** 弯曲排列：弧线是否向上凸（true=上凸，false=下凸） */
  curveFlip: boolean
  bg: TitleBg
  stroke: TitleStroke
  shadow: TitleShadow
}

/** 图形描边 */
export interface ShapeStroke {
  enabled: boolean
  color: string
  /** 描边宽度（占画布宽度的百分比） */
  width: number
}

/** 图形图层：方形、圆形、星形、心形等常规图形 */
export interface ShapeLayer extends BaseLayer {
  kind: 'shape'
  shape: ShapeKind
  /** 宽度（占画布宽度的百分比） */
  wPct: number
  /** 高度（占画布宽度的百分比，与宽度同基数保证等比） */
  hPct: number
  fill: string
  /** 填充不透明度 0-100 */
  opacity: number
  stroke: ShapeStroke
}

/** 图片元素图层：导入的本地图片作为可缩放/拖动的独立元素 */
export interface ImageLayer extends BaseLayer {
  kind: 'image'
  src: string
  /** 宽度（占画布宽度的百分比） */
  wPct: number
  /** 高度（占画布宽度的百分比） */
  hPct: number
  /** 不透明度 0-100 */
  opacity: number
  naturalWidth: number
  naturalHeight: number
}

/** 画布上的全部图层（文字 / 图形 / 图片） */
export type CanvasLayer = TextLayer | ShapeLayer | ImageLayer

/** 常见系统字库（中+英），可被自定义字体覆盖 */
export const SYSTEM_FONTS: string[] = [
  'PingFang SC',
  'Hiragino Sans GB',
  'Microsoft YaHei',
  'SimSun',
  'Heiti SC',
  'Songti SC',
  'Kaiti SC',
  'STKaiti',
  'Arial',
  'Arial Black',
  'Times New Roman',
  'Georgia',
  'Courier New',
  'Impact',
  'Verdana',
  'Comic Sans MS',
]
