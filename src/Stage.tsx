import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { coverLayout, RATIO_SIZE, SPLIT, zoomAt } from './cover'
import { SHAPE_EVENODD, SHAPE_META, shapePathCommands, pathToSvgD } from './shape'
import type {
  CanvasLayer,
  GradientCfg,
  ImageLayer,
  ImgTransform,
  RatioKey,
  ShapeLayer,
  TextLayer,
} from './types'

interface StageProps {
  ratioKey: RatioKey
  img: HTMLImageElement | null
  tf: ImgTransform
  gradient: GradientCfg
  layers: CanvasLayer[]
  selectedId: string | null
  onImgTransform: (tf: ImgTransform) => void
  onLayerChange: (id: string, patch: Partial<CanvasLayer>) => void
  onSelectLayer: (id: string | null) => void
  onRequestUpload: () => void
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

const hexToRgba = (hex: string, alpha: number) => {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha / 100})`
}

export default function Stage(props: StageProps) {
  const { ratioKey, img, tf, gradient, layers, selectedId } = props
  const areaRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [area, setArea] = useState({ w: 0, h: 0 })

  const tfRef = useRef(tf)
  tfRef.current = tf
  const imgRef = useRef(img)
  imgRef.current = img

  const { w: W, h: H } = RATIO_SIZE[ratioKey]

  useLayoutEffect(() => {
    const el = areaRef.current
    if (!el) return
    const update = () => {
      const rect = el.getBoundingClientRect()
      setArea({ w: rect.width, h: rect.height })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const image = imgRef.current
      if (!image) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const px = ((e.clientX - rect.left) / rect.width) * W
      const py = ((e.clientY - rect.top) / rect.height) * H
      const factor = Math.exp(-e.deltaY * 0.0015)
      props.onImgTransform(zoomAt(image, W, H, tfRef.current, factor, px, py))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [W, H, props])

  const pad = 32
  const scale = area.w && area.h ? Math.min((area.w - pad * 2) / W, (area.h - pad * 2) / H) : 0
  const sw = W * scale
  const sh = H * scale
  const splitY = H * SPLIT * scale

  const layout = img ? coverLayout(img, W, H, tf) : null

  // —— 图片拖拽 ——
  const dragImg = useRef<{ x: number; y: number; ux: number; uy: number } | null>(null)
  const onImgPointerDown = (e: React.PointerEvent) => {
    if (!img) return
    e.stopPropagation()
    props.onSelectLayer(null)
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    dragImg.current = { x: e.clientX, y: e.clientY, ux: tf.ux, uy: tf.uy }
  }
  const onImgPointerMove = (e: React.PointerEvent) => {
    const d = dragImg.current
    if (!d || !img) return
    const dux = (e.clientX - d.x) / sw
    const duy = (e.clientY - d.y) / sh
    const candidate = { ...tf, ux: d.ux + dux, uy: d.uy + duy }
    const l = coverLayout(img, W, H, candidate)
    props.onImgTransform({ scale: tf.scale, ux: l.drawX / W, uy: l.drawY / H })
  }
  const onImgPointerUp = (e: React.PointerEvent) => {
    dragImg.current = null
    try {
      ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  // —— 文字图层拖拽 ——
  const dragLayer = useRef<{ id: string; x: number; y: number; nx: number; ny: number } | null>(
    null,
  )
  // 拖动时的居中吸附提示
  const [guide, setGuide] = useState<{ x: boolean; y: boolean } | null>(null)
  const CENTER_THRESHOLD = 0.012
  const onLayerPointerDown = (e: React.PointerEvent, layer: CanvasLayer) => {
    e.stopPropagation()
    props.onSelectLayer(layer.id)
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    dragLayer.current = { id: layer.id, x: e.clientX, y: e.clientY, nx: layer.x, ny: layer.y }
    setGuide({ x: false, y: false })
  }
  const onLayerPointerMove = (e: React.PointerEvent) => {
    const d = dragLayer.current
    if (!d) return
    const nx = clamp01(d.nx + (e.clientX - d.x) / sw)
    const ny = clamp01(d.ny + (e.clientY - d.y) / sh)
    props.onLayerChange(d.id, { x: nx, y: ny })
    setGuide({ x: Math.abs(nx - 0.5) < CENTER_THRESHOLD, y: Math.abs(ny - 0.5) < CENTER_THRESHOLD })
  }
  const onLayerPointerUp = (e: React.PointerEvent) => {
    dragLayer.current = null
    setGuide(null)
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="stage-area" ref={areaRef}>
      {scale > 0 && (
        <div className="stage" ref={stageRef} style={{ width: sw, height: sh }}>
          {/* 整张画布：图片或上传占位 */}
          {img && layout ? (
            <img
              className="stage-img"
              src={img.src}
              alt="封面素材"
              draggable={false}
              style={{
                left: (layout.drawX / W) * sw,
                top: (layout.drawY / H) * sh,
                width: (layout.drawW / W) * sw,
                height: (layout.drawH / H) * sh,
                cursor: dragImg.current ? 'grabbing' : 'grab',
                touchAction: 'none',
              }}
              onPointerDown={onImgPointerDown}
              onPointerMove={onImgPointerMove}
              onPointerUp={onImgPointerUp}
            />
          ) : (
            <button
              className="stage-placeholder"
              style={{ top: 0, height: sh }}
              onClick={props.onRequestUpload}
            >
              <span className="ph-icon">＋</span>
              <span className="ph-text">点击导入图片</span>
              <span className="ph-hint">图片铺满画面，上 1/2 叠加半透明渐变</span>
            </button>
          )}

          {/* 上方 1/2：半透明渐变标题区，底部渐隐融入图片（仅导入图片后显示） */}
          {img && (
            <div
              className="stage-gradient"
              style={{
                height: splitY,
                opacity: gradient.opacity / 100,
                background: `linear-gradient(${gradient.angle}deg, ${gradient.from}, ${gradient.to})`,
                WebkitMaskImage: 'linear-gradient(to bottom, #000 60%, transparent 100%)',
                maskImage: 'linear-gradient(to bottom, #000 60%, transparent 100%)',
              }}
            />
          )}

          {/* 全部图层（文字 / 图形 / 图片），数组越靠后越在顶层 */}
          {layers.map((layer, index) => {
            const common = {
              sw,
              sh,
              order: index,
              selected: layer.id === selectedId,
              onPointerDown: (e: React.PointerEvent) => onLayerPointerDown(e, layer),
              onPointerMove: onLayerPointerMove,
              onPointerUp: onLayerPointerUp,
              onLayerChange: props.onLayerChange,
            }
            if (layer.kind === 'text') {
              if (!layer.text.trim()) return null
              return <LayerView key={layer.id} layer={layer} {...common} />
            }
            if (layer.kind === 'shape') {
              return <ShapeView key={layer.id} layer={layer} {...common} />
            }
            return <ImageView key={layer.id} layer={layer} {...common} />
          })}

          {/* 拖动时居中参考线 */}
          {guide && (guide.x || guide.y) && (
            <div className="center-guide" style={{ pointerEvents: 'none' }}>
              {guide.x && (
                <div
                  className="guide-line guide-v"
                  style={{ left: sw / 2, top: 0, height: sh }}
                />
              )}
              {guide.y && (
                <div
                  className="guide-line guide-h"
                  style={{ top: sh / 2, left: 0, width: sw }}
                />
              )}
              {(guide.x || guide.y) && (
                <div
                  className="guide-label"
                  style={{ left: sw / 2, top: sh / 2 }}
                >
                  居中{guide.x && guide.y ? '' : guide.x ? '（水平）' : '（垂直）'}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface LayerViewProps {
  layer: TextLayer
  sw: number
  sh: number
  order: number
  selected: boolean
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
  onLayerChange: (id: string, patch: Partial<CanvasLayer>) => void
}

function LayerView({
  layer,
  sw,
  sh,
  order,
  selected,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onLayerChange,
}: LayerViewProps) {
  const fs = (layer.sizePct / 100) * sw
  // 双击行内编辑状态
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(layer.text)
  // 拖拽缩放手柄状态：向右/向下拖增大字号
  const resizing = useRef<{ startX: number; startY: number; startSize: number } | null>(null)
  // 行内编辑器：进入编辑时自动全选，便于直接输入替换（默认文字会被覆盖）
  const editRef = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    if (editing) editRef.current?.select()
  }, [editing])
  const onResizeDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    resizing.current = { startX: e.clientX, startY: e.clientY, startSize: layer.sizePct }
  }
  const onResizeMove = (e: React.PointerEvent) => {
    const r = resizing.current
    if (!r) return
    // 向右或向下拖增大字号，取较大方向的增量
    const dx = (e.clientX - r.startX) / sw
    const dy = (e.clientY - r.startY) / sw
    const delta = Math.max(dx, dy)
    const next = Math.min(20, Math.max(1, r.startSize + delta * 30))
    onLayerChange(layer.id, { sizePct: Math.round(next * 10) / 10 })
  }
  const onResizeUp = (e: React.PointerEvent) => {
    resizing.current = null
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }
  const commonTextStyle: React.CSSProperties = {
    fontFamily: `"${layer.font}", "PingFang SC", sans-serif`,
    fontSize: fs,
    color: layer.color,
    fontWeight: layer.bold ? 700 : 500,
    fontStyle: layer.italic ? 'italic' : 'normal',
    textDecoration: [
      layer.underline ? 'underline' : '',
      layer.strikethrough ? 'line-through' : '',
    ]
      .filter(Boolean)
      .join(' ') || 'none',
    textShadow: layer.shadow.enabled
      ? `${(layer.shadow.offsetX / 100) * sw}px ${(layer.shadow.offsetY / 100) * sw}px ${
          (layer.shadow.blur / 100) * sw
        }px ${layer.shadow.color}`
      : 'none',
    WebkitTextStroke: layer.stroke.enabled
      ? `${(layer.stroke.width / 100) * sw}px ${layer.stroke.color}`
      : '0',
    // 描边画在填充下方，与导出一致，填充色不被描边吃掉
    paintOrder: 'stroke fill',
    lineHeight: 1.3,
    whiteSpace: 'nowrap',
  }

  const wrapperStyle: React.CSSProperties = {
    position: 'absolute',
    left: layer.x * sw,
    top: layer.y * sh,
    transform: `translate(-50%, -50%) rotate(${layer.rotation}deg)`,
    cursor: 'move',
    touchAction: 'none',
    outline: selected ? '2px dashed #6366f1' : 'none',
    outlineOffset: 4,
    zIndex: order,
  }

  // —— 双击行内编辑：覆盖在文字位置的多行编辑器 ——
  if (editing) {
    const commit = () => {
      onLayerChange(layer.id, { text: draft })
      setEditing(false)
    }
    return (
      <div
        className="inline-editor"
        style={{
          position: 'absolute',
          left: layer.x * sw,
          top: layer.y * sh,
          transform: `translate(-50%, -50%) rotate(${layer.rotation}deg)`,
          zIndex: 50,
        }}
      >
        <textarea
          ref={editRef}
          autoFocus
          value={draft}
          rows={Math.max(1, draft.split('\n').length)}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.target.select()}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setDraft(layer.text)
              setEditing(false)
            } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              commit()
            }
          }}
          style={{
            fontFamily: `"${layer.font}", "PingFang SC", sans-serif`,
            fontSize: fs,
            color: layer.color,
            fontWeight: layer.bold ? 700 : 500,
            textAlign: layer.align,
            lineHeight: 1.3,
            background: 'rgba(20,22,30,0.92)',
            border: '2px solid #6366f1',
            borderRadius: 6,
            outline: 'none',
            resize: 'none',
            padding: 4,
            whiteSpace: 'pre',
            overflow: 'hidden',
            minWidth: fs * 2,
          }}
        />
      </div>
    )
  }

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    setDraft(layer.text)
    setEditing(true)
  }

  // —— 弯曲排列：SVG textPath ——
  if (layer.layout === 'curved') {
    const r = (layer.curveRadius / 100) * sw
    const arcRad = (layer.curveArc * Math.PI) / 180
    const flip = layer.curveFlip
    const Ws = 2 * r + fs * 2
    const Hs = 2 * r + fs * 2
    const cx = Ws / 2
    const cy = flip ? Hs / 2 - r : Hs / 2 + r
    // 沿弧采样生成 path
    const steps = 40
    let d = ''
    for (let i = 0; i <= steps; i++) {
      const t = i / steps - 0.5
      const theta = t * arcRad
      const x = cx + r * Math.sin(theta)
      const y = flip ? cy + r * Math.cos(theta) : cy - r * Math.cos(theta)
      d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)} `
    }
    const pid = `arc-${layer.id}`
    return (
      <div
        style={wrapperStyle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={startEdit}
      >
        <svg width={Ws} height={Hs} style={{ overflow: 'visible', display: 'block' }}>
          <defs>
            <path id={pid} d={d} fill="none" />
          </defs>
          <text
            fill={layer.color}
            stroke={layer.stroke.enabled ? layer.stroke.color : 'none'}
            strokeWidth={layer.stroke.enabled ? (layer.stroke.width / 100) * sw : 0}
            paintOrder="stroke"
            style={{
              ...commonTextStyle,
              filter: layer.shadow.enabled
                ? `drop-shadow(${(layer.shadow.offsetX / 100) * sw}px ${
                    (layer.shadow.offsetY / 100) * sw
                  }px ${(layer.shadow.blur / 100) * sw}px ${layer.shadow.color})`
                : undefined,
            }}
          >
            <textPath href={`#${pid}`} startOffset="50%" textAnchor="middle">
              {layer.text}
            </textPath>
          </text>
        </svg>
        {selected && <ResizeHandle onDown={onResizeDown} onMove={onResizeMove} onUp={onResizeUp} />}
      </div>
    )
  }

  // —— 竖排 ——
  if (layer.layout === 'vertical') {
    return (
      <div
        style={wrapperStyle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={startEdit}
      >
        <div
          style={{
            ...commonTextStyle,
            writingMode: 'vertical-rl',
            textOrientation: 'upright',
            display: 'inline-block',
          }}
        >
          {layer.text}
        </div>
        {selected && <ResizeHandle onDown={onResizeDown} onMove={onResizeMove} onUp={onResizeUp} />}
      </div>
    )
  }

  // —— 横排 / 斜排 ——
  // 对齐由外层 translate 的 X 百分比控制：left=0%(左边贴锚点) / center=-50% / right=-100%(右边贴锚点)
  const alignTx =
    layer.align === 'left' ? '0%' : layer.align === 'right' ? '-100%' : '-50%'
  const bgPadX = layer.bg.enabled ? ((layer.bg.paddingX ?? layer.bg.paddingY) / 100) * sw : 0
  const innerStyle: React.CSSProperties = layer.bg.enabled
    ? {
        display: 'inline',
        background: hexToRgba(layer.bg.color, layer.bg.opacity),
        // 左右内边距控制宽度，上下内边距控制高度（与导出同单位：画布宽度百分比 → px）
        padding: `${((layer.bg.paddingY ?? layer.bg.paddingX) / 100) * sw}px ${
          (layer.bg.paddingX ?? layer.bg.paddingY) / 100 * sw
        }px`,
        // 负 margin 抵消水平 padding：外层宽度仍等于文字宽度，
        // 锚点对齐的是文字本身，背景向两侧对称扩展（开关背景文字不位移，与导出一致）
        marginLeft: -bgPadX,
        marginRight: -bgPadX,
        borderRadius: (layer.bg.radius / 100) * sw,
        WebkitBoxDecorationBreak: 'clone',
        boxDecorationBreak: 'clone',
      }
    : { display: 'inline' }

  return (
    <div
      style={{
        ...wrapperStyle,
        ...commonTextStyle,
        transform: `translate(${alignTx}, -50%) rotate(${layer.rotation}deg)`,
        textAlign: layer.align,
        whiteSpace: 'nowrap',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={startEdit}
    >
      <span className="stage-title-inner" style={innerStyle}>
        {layer.text}
      </span>
      {selected && <ResizeHandle onDown={onResizeDown} onMove={onResizeMove} onUp={onResizeUp} />}
    </div>
  )
}

function ResizeHandle({
  onDown,
  onMove,
  onUp,
}: {
  onDown: (e: React.PointerEvent) => void
  onMove: (e: React.PointerEvent) => void
  onUp: (e: React.PointerEvent) => void
}) {
  return (
    <div
      className="resize-handle"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      title="拖拽调整字号"
    />
  )
}

/* ================= 图形 / 图片元素视图 ================= */

interface BoxViewProps {
  sw: number
  sh: number
  order: number
  selected: boolean
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
  onLayerChange: (id: string, patch: Partial<CanvasLayer>) => void
}

function ShapeView({
  layer,
  sw,
  sh,
  order,
  selected,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onLayerChange,
}: BoxViewProps & { layer: ShapeLayer }) {
  const wPx = (layer.wPct / 100) * sw
  const hPx = (layer.hPct / 100) * sw
  const cmds = shapePathCommands(layer.shape, wPx, hPx)
  const strokeW = layer.stroke.enabled ? (layer.stroke.width / 100) * sw : 0

  let shapeEl: React.ReactNode = null
  if (cmds) {
    shapeEl = (
      <path
        d={pathToSvgD(cmds)}
        fill={layer.fill}
        fillOpacity={layer.opacity / 100}
        fillRule={SHAPE_EVENODD.has(layer.shape) ? 'evenodd' : undefined}
        stroke={layer.stroke.enabled ? layer.stroke.color : 'none'}
        strokeWidth={strokeW}
        strokeLinejoin="round"
      />
    )
  } else if (layer.shape === 'rect' || layer.shape === 'square') {
    shapeEl = (
      <rect
        x={strokeW / 2}
        y={strokeW / 2}
        width={Math.max(0, wPx - strokeW)}
        height={Math.max(0, hPx - strokeW)}
        fill={layer.fill}
        fillOpacity={layer.opacity / 100}
        stroke={layer.stroke.enabled ? layer.stroke.color : 'none'}
        strokeWidth={strokeW}
      />
    )
  } else {
    // circle / ellipse
    shapeEl = (
      <ellipse
        cx={wPx / 2}
        cy={hPx / 2}
        rx={Math.max(0, wPx / 2 - strokeW / 2)}
        ry={Math.max(0, hPx / 2 - strokeW / 2)}
        fill={layer.fill}
        fillOpacity={layer.opacity / 100}
        stroke={layer.stroke.enabled ? layer.stroke.color : 'none'}
        strokeWidth={strokeW}
      />
    )
  }

  return (
    <div
      style={{
        position: 'absolute',
        left: layer.x * sw,
        top: layer.y * sh,
        width: wPx,
        height: hPx,
        transform: `translate(-50%, -50%) rotate(${layer.rotation}deg)`,
        cursor: 'move',
        touchAction: 'none',
        outline: selected ? '2px dashed #6366f1' : 'none',
        outlineOffset: 4,
        zIndex: order,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <svg width={wPx} height={hPx} style={{ display: 'block', overflow: 'visible' }}>
        {shapeEl}
      </svg>
      {selected && (
        <ResizeBox
          layer={layer}
          sw={sw}
          onLayerChange={onLayerChange}
          keepAspect={SHAPE_META[layer.shape].lock}
        />
      )}
    </div>
  )
}

function ImageView({
  layer,
  sw,
  sh,
  order,
  selected,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onLayerChange,
}: BoxViewProps & { layer: ImageLayer }) {
  const wPx = (layer.wPct / 100) * sw
  const hPx = (layer.hPct / 100) * sw
  return (
    <div
      style={{
        position: 'absolute',
        left: layer.x * sw,
        top: layer.y * sh,
        width: wPx,
        height: hPx,
        transform: `translate(-50%, -50%) rotate(${layer.rotation}deg)`,
        cursor: 'move',
        touchAction: 'none',
        outline: selected ? '2px dashed #6366f1' : 'none',
        outlineOffset: 4,
        zIndex: order,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <img
        src={layer.src}
        alt=""
        draggable={false}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          opacity: layer.opacity / 100,
          pointerEvents: 'none',
          objectFit: 'fill',
        }}
      />
      {selected && (
        <ResizeBox layer={layer} sw={sw} onLayerChange={onLayerChange} keepAspect />
      )}
    </div>
  )
}

/** 8 向缩放手柄：拖动边缘/角点调节元素宽高（以中心为锚点对称缩放） */
function ResizeBox({
  layer,
  sw,
  onLayerChange,
  keepAspect,
}: {
  layer: ShapeLayer | ImageLayer
  sw: number
  onLayerChange: (id: string, patch: Partial<CanvasLayer>) => void
  keepAspect: boolean
}) {
  const drag = useRef<{ sx: number; sy: number; w: number; h: number } | null>(null)

  const onDown = (dir: string) => (e: React.PointerEvent) => {
    e.stopPropagation()
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    drag.current = { sx: e.clientX, sy: e.clientY, w: layer.wPct, h: layer.hPct }
    ;(e.currentTarget as HTMLElement).setAttribute('data-dir', dir)
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dir = (e.currentTarget as HTMLElement).getAttribute('data-dir') || ''
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    let dw = 0
    let dh = 0
    if (dir.includes('e')) dw += dx
    if (dir.includes('w')) dw -= dx
    if (dir.includes('s')) dh += dy
    if (dir.includes('n')) dh -= dy
    const perPx = 100 / sw
    const pw = Math.max(2, d.w + 2 * dw * perPx)
    const ph = Math.max(2, d.h + 2 * dh * perPx)
    if (keepAspect) {
      const kw = pw / d.w
      const kh = ph / d.h
      const scale = Math.max(0.05, Math.abs(kw - 1) >= Math.abs(kh - 1) ? kw : kh)
      onLayerChange(layer.id, { wPct: Math.round(d.w * scale * 10) / 10, hPct: Math.round(d.h * scale * 10) / 10 })
    } else {
      onLayerChange(layer.id, { wPct: Math.round(pw * 10) / 10, hPct: Math.round(ph * 10) / 10 })
    }
  }
  const onUp = (e: React.PointerEvent) => {
    drag.current = null
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  const handle = (dir: string, style: React.CSSProperties, cursor: string) => (
    <div
      key={dir}
      className="rz-handle"
      style={{ ...style, cursor }}
      onPointerDown={onDown(dir)}
      onPointerMove={onMove}
      onPointerUp={onUp}
    />
  )
  const H = 10
  return (
    <>
      {handle('nw', { left: -H / 2, top: -H / 2 }, 'nwse-resize')}
      {handle('n', { left: '50%', top: -H / 2, transform: 'translateX(-50%)' }, 'ns-resize')}
      {handle('ne', { right: -H / 2, top: -H / 2 }, 'nesw-resize')}
      {handle('e', { right: -H / 2, top: '50%', transform: 'translateY(-50%)' }, 'ew-resize')}
      {handle('se', { right: -H / 2, bottom: -H / 2 }, 'nwse-resize')}
      {handle('s', { left: '50%', bottom: -H / 2, transform: 'translateX(-50%)' }, 'ns-resize')}
      {handle('sw', { left: -H / 2, bottom: -H / 2 }, 'nesw-resize')}
      {handle('w', { left: -H / 2, top: '50%', transform: 'translateY(-50%)' }, 'ew-resize')}
    </>
  )
}
