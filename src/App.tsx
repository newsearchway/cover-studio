import { useEffect, useRef, useState } from 'react'
import Stage from './Stage'
import { centerTransform, MAX_SCALE, MIN_SCALE, RATIO_SIZE, SPLIT, zoomAt } from './cover'
import { downloadCover, renderCover } from './exportCover'
import { createDefaultImageLayer, createDefaultShape, SHAPE_META, SHAPE_ORDER } from './shape'
import {
  createDefaultLayer,
  detectFonts,
  importFontFile,
  loadSystemFonts,
  localFontName,
  newLayerId,
  restoreImportedFonts,
} from './textLayer'
import type {
  CanvasLayer,
  GradientCfg,
  ImageLayer,
  ImgTransform,
  RatioKey,
  ShapeKind,
  ShapeLayer,
  TextLayer,
  TextLayout,
} from './types'

const RATIO_KEYS: RatioKey[] = ['3:4', '9:16', '4:3']

const DIRS = [
  { angle: 180, icon: '↓', label: '从上到下' },
  { angle: 0, icon: '↑', label: '从下到上' },
  { angle: 90, icon: '→', label: '从左到右' },
  { angle: 270, icon: '←', label: '从右到左' },
  { angle: 135, icon: '↘', label: '斜向右下' },
  { angle: 45, icon: '↗', label: '斜向右上' },
]

const LAYOUTS: { key: TextLayout; label: string }[] = [
  { key: 'horizontal', label: '横排' },
  { key: 'vertical', label: '竖排' },
  { key: 'slanted', label: '斜排' },
  { key: 'curved', label: '弯曲' },
]

/** 模板结构 */
interface CoverTemplate {
  name: string
  ratioKey: RatioKey
  gradient: GradientCfg
  layers: CanvasLayer[]
  savedAt: number
}

const TEMPLATE_KEY = 'cover-studio-templates'

function loadTemplates(): CoverTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATE_KEY)
    return raw ? (JSON.parse(raw) as CoverTemplate[]) : []
  } catch {
    return []
  }
}

function saveTemplates(list: CoverTemplate[]) {
  localStorage.setItem(TEMPLATE_KEY, JSON.stringify(list))
}

/** 兼容旧模板数据：读取背景水平/垂直内边距（旧版只有 padding 一个字段） */
function bgX(l: TextLayer): number {
  return l.bg.paddingX ?? (l.bg as unknown as { padding?: number }).padding ?? 1.2
}
function bgY(l: TextLayer): number {
  return l.bg.paddingY ?? (l.bg as unknown as { padding?: number }).padding ?? 1.2
}

export default function App() {
  const [ratioKey, setRatioKey] = useState<RatioKey>('3:4')
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [imgName, setImgName] = useState('')
  const [tf, setTf] = useState<ImgTransform>({ scale: 1, ux: 0, uy: 0 })
  const [gradient, setGradient] = useState<GradientCfg>({
    from: '#FF2E63',
    to: '#FF8E53',
    angle: 180,
    opacity: 100,
  })

  const firstLayer = createDefaultLayer()
  const [layers, setLayers] = useState<CanvasLayer[]>([firstLayer])
  const [selectedId, setSelectedId] = useState<string | null>(firstLayer.id)
  const [fontList, setFontList] = useState<string[]>([])
  const [fontLoading, setFontLoading] = useState(false)
  const [templates, setTemplates] = useState<CoverTemplate[]>(() => loadTemplates())
  const [templateName, setTemplateName] = useState('')

  const fileRef = useRef<HTMLInputElement>(null)
  const fontFileRef = useRef<HTMLInputElement>(null)
  const shapeImgRef = useRef<HTMLInputElement>(null)
  const objectUrlRef = useRef<string | null>(null)
  // 图形/图片元素的 object URL 引用（清理画板时一并回收）
  const layerUrlsRef = useRef<string[]>([])

  const { w: W, h: H } = RATIO_SIZE[ratioKey]

  // 启动时尝试检测系统字库（queryLocalFonts 需用户手势，先加载候选列表）
  useEffect(() => {
    detectFonts([
      'PingFang SC',
      'Hiragino Sans GB',
      'Microsoft YaHei',
      'SimSun',
      'Heiti SC',
      'Songti SC',
      'Arial',
      'Times New Roman',
      'Georgia',
      'Courier New',
      'Impact',
      'Verdana',
    ]).then(setFontList)
    // 恢复上次导入的字体（IndexedDB），无需重复导入
    restoreImportedFonts().then((names) => {
      if (names.length > 0) {
        setFontList((prev) => [...new Set([...prev, ...names])])
      }
    })
  }, [])

  // 首次用户交互时自动调取电脑全部字体（满足 queryLocalFonts 的用户手势要求）
  useEffect(() => {
    const handler = () => {
      loadAllFonts()
      window.removeEventListener('pointerdown', handler)
      window.removeEventListener('keydown', handler)
    }
    window.addEventListener('pointerdown', handler)
    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('pointerdown', handler)
      window.removeEventListener('keydown', handler)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selected = layers.find((l) => l.id === selectedId) ?? layers[0] ?? null

  const patchLayer = (id: string, patch: Partial<CanvasLayer>) =>
    setLayers((ls) => ls.map((l) => (l.id === id ? ({ ...l, ...patch } as CanvasLayer) : l)))

  const addLayer = () => {
    const nl = createDefaultLayer({ text: '新文字', y: 0.7 })
    setLayers((ls) => [...ls, nl])
    setSelectedId(nl.id)
  }

  const deleteLayer = (id: string) => {
    setLayers((ls) => {
      // 至少保留一个图层，避免编辑区消失
      if (ls.length <= 1) return ls
      const target = ls.find((l) => l.id === id)
      if (target?.kind === 'image') {
        URL.revokeObjectURL(target.src)
        layerUrlsRef.current = layerUrlsRef.current.filter((u) => u !== target.src)
      }
      const next = ls.filter((l) => l.id !== id)
      if (selectedId === id) setSelectedId(next[0]?.id ?? null)
      return next
    })
  }

  // 新增图形元素
  const addShape = (shape: ShapeKind) => {
    const nl = createDefaultShape(shape)
    setLayers((ls) => [...ls, nl])
    setSelectedId(nl.id)
  }

  // 调整图层上下层级：dir=+1 上移（置前，数组靠后=渲染在上方），-1 下移（置后）
  const moveLayer = (id: string, dir: -1 | 1) => {
    setLayers((ls) => {
      const i = ls.findIndex((l) => l.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= ls.length) return ls
      const next = [...ls]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  // 导入本地图片作为独立元素图层
  const onLayerImageImport = (file?: File) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      window.alert('请选择图片文件')
      return
    }
    const url = URL.createObjectURL(file)
    layerUrlsRef.current.push(url)
    const image = new Image()
    image.onload = () => {
      const nl = createDefaultImageLayer(url, image.naturalWidth, image.naturalHeight)
      setLayers((ls) => [...ls, nl])
      setSelectedId(nl.id)
    }
    image.onerror = () => window.alert(`图片加载失败：${file.name}`)
    image.src = url
  }

  useEffect(() => {
    if (img) setTf(centerTransform(img, W, H))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, ratioKey])

  const loadFile = (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      window.alert('请选择图片文件')
      return
    }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    const url = URL.createObjectURL(file)
    objectUrlRef.current = url
    const image = new Image()
    image.onload = () => {
      setImg(image)
      setImgName(file.name)
    }
    image.onerror = () => {
      window.alert(`图片加载失败：${file.name}`)
    }
    image.src = url
  }

  const onZoomSlider = (value: number) => {
    if (!img) return
    const factor = value / tf.scale
    setTf(zoomAt(img, W, H, tf, factor, W / 2, (H * SPLIT + H) / 2))
  }

  const onExport = async () => {
    if (!img) return
    // 预加载图片元素图层，确保导出时已解码
    const imageCache = new Map<string, HTMLImageElement>()
    await Promise.all(
      layers
        .filter((l): l is ImageLayer => l.kind === 'image')
        .map(
          (l) =>
            new Promise<void>((resolve) => {
              const im = new Image()
              im.crossOrigin = 'anonymous'
              im.onload = () => {
                imageCache.set(l.src, im)
                resolve()
              }
              im.onerror = () => resolve()
              im.src = l.src
            }),
        ),
    )
    const canvas = renderCover({ W, H, img, tf, gradient, layers, images: imageCache })
    downloadCover(canvas, `cover-${ratioKey.replace(':', 'x')}.png`)
  }

  const currentFont = selected?.kind === 'text' ? selected.font : ''

  const loadAllFonts = async () => {
    setFontLoading(true)
    const list = await loadSystemFonts()
    // 合并而非覆盖，保留已导入的自定义字体
    setFontList((prev) => [...new Set([...list, ...prev])])
    setFontLoading(false)
  }

  // 导入字体文件
  const onFontFileImport = async (file?: File) => {
    if (!file) return
    setFontLoading(true)
    try {
      const name = await importFontFile(file)
      setFontList((prev) => [...new Set([...prev, name])])
      if (selected) patchLayer(selected.id, { font: name })
    } catch (e) {
      console.error('字体导入失败:', e)
    }
    setFontLoading(false)
  }

  // 保存模板
  const saveTemplate = () => {
    const name = templateName.trim() || `模板 ${templates.length + 1}`
    const tpl: CoverTemplate = {
      name,
      ratioKey,
      gradient,
      layers,
      savedAt: Date.now(),
    }
    const next = [...templates, tpl]
    setTemplates(next)
    saveTemplates(next)
    setTemplateName('')
  }

  // 应用模板
  const applyTemplate = (tpl: CoverTemplate) => {
    setRatioKey(tpl.ratioKey)
    setGradient(tpl.gradient)
    setLayers(
      tpl.layers.map((l) => {
        // 兼容旧模板：缺失 kind 视为文字图层
        const kind = (l as { kind?: CanvasLayer['kind'] }).kind ?? 'text'
        if (kind === 'text') {
          const tl = l as TextLayer
          return {
            ...tl,
            id: newLayerId(),
            kind: 'text' as const,
            bg: { ...tl.bg, paddingX: bgX(tl), paddingY: bgY(tl) },
          }
        }
        if (kind === 'shape') {
          return { ...(l as ShapeLayer), id: newLayerId(), kind: 'shape' as const }
        }
        return { ...(l as ImageLayer), id: newLayerId(), kind: 'image' as const }
      }),
    )
    setSelectedId(tpl.layers[0]?.id ?? null)
  }

  // 更新模板：将当前设计覆盖保存到指定模板
  const updateTemplate = (idx: number) => {
    const next = templates.map((t, i) =>
      i === idx ? { ...t, ratioKey, gradient, layers, savedAt: Date.now() } : t,
    )
    setTemplates(next)
    saveTemplates(next)
  }

  // 删除模板
  const deleteTemplate = (idx: number) => {
    const next = templates.filter((_, i) => i !== idx)
    setTemplates(next)
    saveTemplates(next)
  }

  // 清空画板：移除图片、文字、渐变，恢复初始状态
  const clearBoard = () => {
    if (!window.confirm('确定清空画板？将移除图片、全部文字和渐变设置')) return
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
    layerUrlsRef.current.forEach((u) => URL.revokeObjectURL(u))
    layerUrlsRef.current = []
    setImg(null)
    setImgName('')
    const fresh = createDefaultLayer()
    setLayers([fresh])
    setSelectedId(fresh.id)
    setGradient({ from: '#FF2E63', to: '#FF8E53', angle: 180, opacity: 100 })
    setTf({ scale: 1, ux: 0, uy: 0 })
  }

  return (
    <div className="app">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          loadFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <input
        ref={fontFileRef}
        type="file"
        accept=".ttf,.otf,.woff,.woff2"
        hidden
        onChange={(e) => {
          onFontFileImport(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <input
        ref={shapeImgRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          onLayerImageImport(e.target.files?.[0])
          e.target.value = ''
        }}
      />

      <aside className="panel">
        <header className="panel-head">
          <h1>封面设计工作台</h1>
          <span className="step-badge">Step 1 · 导入图片</span>
        </header>

        <div className="panel-body">
          {/* 图片 */}
          <section className="block">
            <h2>图片</h2>
            <button className="btn primary wide" onClick={() => fileRef.current?.click()}>
              选择图片
            </button>
            {imgName && (
              <p className="filename" title={imgName}>
                {imgName}
              </p>
            )}
            <div className="row-between">
              <label className="field-label">缩放</label>
              <span className="value">{tf.scale.toFixed(2)}×</span>
            </div>
            <input
              type="range"
              min={MIN_SCALE}
              max={MAX_SCALE}
              step={0.01}
              value={tf.scale}
              disabled={!img}
              onChange={(e) => onZoomSlider(Number(e.target.value))}
            />
            <button
              className="btn ghost wide"
              disabled={!img}
              onClick={() => img && setTf(centerTransform(img, W, H))}
            >
              重置图片位置
            </button>
            <p className="hint">在预览区拖动图片调整位置，滚轮 / 触控板双指缩放</p>
          </section>

          {/* 画幅比例 */}
          <section className="block">
            <h2>画幅比例</h2>
            <div className="seg">
              {RATIO_KEYS.map((k) => (
                <button
                  key={k}
                  className={ratioKey === k ? 'seg-item active' : 'seg-item'}
                  onClick={() => setRatioKey(k)}
                >
                  {RATIO_SIZE[k].label}
                </button>
              ))}
            </div>
            <p className="hint">导出尺寸 {W} × {H} px</p>
          </section>

          {/* 渐变 */}
          <section className="block">
            <h2>渐变标题区（上 1/2）</h2>
            <div className="color-row">
              <div className="color-field">
                <input
                  type="color"
                  value={gradient.from}
                  onChange={(e) => setGradient((g) => ({ ...g, from: e.target.value }))}
                />
                <span>起始色</span>
                <code>{gradient.from.toUpperCase()}</code>
              </div>
              <div className="color-field">
                <input
                  type="color"
                  value={gradient.to}
                  onChange={(e) => setGradient((g) => ({ ...g, to: e.target.value }))}
                />
                <span>结束色</span>
                <code>{gradient.to.toUpperCase()}</code>
              </div>
            </div>
            <label className="field-label">渐变方向</label>
            <div className="dir-grid">
              {DIRS.map((d) => (
                <button
                  key={d.angle}
                  title={d.label}
                  className={gradient.angle === d.angle ? 'dir-item active' : 'dir-item'}
                  onClick={() => setGradient((g) => ({ ...g, angle: d.angle }))}
                >
                  <span className="dir-icon">{d.icon}</span>
                </button>
              ))}
            </div>
            <div className="row-between">
              <label className="field-label">渐变透明度</label>
              <span className="value">{gradient.opacity}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={gradient.opacity}
              onChange={(e) => setGradient((g) => ({ ...g, opacity: Number(e.target.value) }))}
            />
            <p className="hint">调低可隐约透出下方图片</p>
          </section>

          {/* 图形 / 元素 */}
          <section className="block">
            <h2>图形 / 元素</h2>
            <div className="shape-grid">
              {SHAPE_ORDER.map((s) => (
                <button
                  key={s}
                  className="shape-btn"
                  title={`新增${SHAPE_META[s].label}`}
                  onClick={() => addShape(s)}
                >
                  <span className="shape-icon">{SHAPE_META[s].icon}</span>
                  <span className="shape-label">{SHAPE_META[s].label}</span>
                </button>
              ))}
              <button
                className="shape-btn"
                title="导入本地图片作为元素"
                onClick={() => shapeImgRef.current?.click()}
              >
                <span className="shape-icon">🖼</span>
                <span className="shape-label">图片</span>
              </button>
            </div>
            <p className="hint">新增图形或导入图片，在画布上拖拽移动、拖手柄调节大小</p>
          </section>

          {/* 图层 */}
          <section className="block">
            <div className="row-between">
              <h2 style={{ margin: 0 }}>图层</h2>
              <button className="btn chip" onClick={addLayer}>
                + 文字
              </button>
            </div>
            <div className="layer-list">
              {layers.map((l, i) => (
                <div
                  key={l.id}
                  className={l.id === selectedId ? 'layer-item active' : 'layer-item'}
                  onClick={() => setSelectedId(l.id)}
                >
                  <span className="layer-kind">
                    {l.kind === 'text' ? 'T' : l.kind === 'shape' ? SHAPE_META[l.shape].icon : '🖼'}
                  </span>
                  <span className="layer-name">
                    {l.kind === 'text'
                      ? l.text || '(空)'
                      : l.kind === 'shape'
                        ? SHAPE_META[l.shape].label
                        : '图片'}
                  </span>
                  <span className="layer-actions">
                    <button
                      className="btn chip"
                      disabled={i === layers.length - 1}
                      onClick={(e) => {
                        e.stopPropagation()
                        moveLayer(l.id, 1)
                      }}
                      title="上移一层（置于更上层）"
                    >
                      ▲
                    </button>
                    <button
                      className="btn chip"
                      disabled={i === 0}
                      onClick={(e) => {
                        e.stopPropagation()
                        moveLayer(l.id, -1)
                      }}
                      title="下移一层（置于更下层）"
                    >
                      ▼
                    </button>
                    <button
                      className="btn chip"
                      disabled={layers.length <= 1}
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteLayer(l.id)
                      }}
                      title={layers.length <= 1 ? '至少保留一个图层' : '删除'}
                    >
                      ×
                    </button>
                  </span>
                  <span className="layer-idx">{i + 1}</span>
                </div>
              ))}
            </div>
            <p className="hint">
              ▲ 上移 / ▼ 下移 调整图层上下层关系（越靠后越在最上层，如让文字显示在图形上方），× 删除图层
            </p>

            {selected?.kind === 'text' && (
              <>
                <textarea
                  rows={2}
                  value={selected.text}
                  placeholder="输入文字，回车可换行（也可双击画布上的文字直接编辑）"
                  onChange={(e) => patchLayer(selected.id, { text: e.target.value })}
                />

                {/* 字体 */}
                <div className="row-between">
                  <label className="field-label">字体（{fontList.length}）</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      className="btn chip"
                      onClick={loadAllFonts}
                      disabled={fontLoading}
                    >
                      {fontLoading ? '加载中…' : '系统字体'}
                    </button>
                    <button
                      className="btn chip"
                      onClick={() => fontFileRef.current?.click()}
                      disabled={fontLoading}
                      title="导入 .ttf / .otf / .woff / .woff2 字体文件"
                    >
                      导入字体
                    </button>
                  </div>
                </div>
                <div className="font-row">
                  <div className="font-select-wrap">
                    <select
                      value={currentFont}
                      onChange={(e) => patchLayer(selected.id, { font: e.target.value })}
                      style={{ fontFamily: `"${currentFont}", sans-serif` }}
                    >
                      {fontList.map((f) => (
                        <option key={f} value={f} style={{ fontFamily: `"${f}", sans-serif` }}>
                          {localFontName(f)}
                        </option>
                      ))}
                    </select>
                    <span className="font-select-arrow">▾</span>
                  </div>
                  <input
                    type="text"
                    placeholder="自定义字体名，输入即生效"
                    value={currentFont}
                    onChange={(e) => patchLayer(selected.id, { font: e.target.value })}
                  />
                </div>

                {/* 字号 */}
                <div className="row-between">
                  <label className="field-label">字号</label>
                  <span className="value">
                    {selected.sizePct.toFixed(1)}%（约 {Math.round((selected.sizePct / 100) * W)}px）
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={20}
                  step={0.5}
                  value={selected.sizePct}
                  onChange={(e) => patchLayer(selected.id, { sizePct: Number(e.target.value) })}
                />

                {/* 文字颜色 */}
                <div className="row-between">
                  <label className="field-label">文字颜色</label>
                  <input
                    type="color"
                    value={selected.color}
                    onChange={(e) => patchLayer(selected.id, { color: e.target.value })}
                  />
                </div>

                {/* 粗体 / 斜体 / 下划线 / 删除线 */}
                <div className="seg">
                  <button
                    className={selected.bold ? 'seg-item active' : 'seg-item'}
                    onClick={() => patchLayer(selected.id, { bold: !selected.bold })}
                    title="加粗"
                  >
                    B
                  </button>
                  <button
                    className={selected.italic ? 'seg-item active' : 'seg-item'}
                    style={{ fontStyle: 'italic' }}
                    onClick={() => patchLayer(selected.id, { italic: !selected.italic })}
                    title="斜体"
                  >
                    I
                  </button>
                  <button
                    className={selected.underline ? 'seg-item active' : 'seg-item'}
                    style={{ textDecoration: 'underline' }}
                    onClick={() => patchLayer(selected.id, { underline: !selected.underline })}
                    title="下划线"
                  >
                    U
                  </button>
                  <button
                    className={selected.strikethrough ? 'seg-item active' : 'seg-item'}
                    style={{ textDecoration: 'line-through' }}
                    onClick={() =>
                      patchLayer(selected.id, { strikethrough: !selected.strikethrough })
                    }
                    title="删除线"
                  >
                    S
                  </button>
                </div>

                {/* 位置居中 */}
                <div className="row-between">
                  <label className="field-label">位置</label>
                  <button
                    className="btn chip"
                    onClick={() => patchLayer(selected.id, { x: 0.5, y: 0.5 })}
                  >
                    居中
                  </button>
                </div>

                {/* 对齐方式 */}
                <div className="row-between">
                  <label className="field-label">对齐方式</label>
                </div>
                <div className="seg tight">
                  {(['left', 'center', 'right'] as const).map((a) => (
                    <button
                      key={a}
                      className={selected.align === a ? 'seg-item active' : 'seg-item'}
                      onClick={() => patchLayer(selected.id, { align: a })}
                    >
                      {a === 'left' ? '左' : a === 'center' ? '中' : '右'}
                    </button>
                  ))}
                </div>

                {/* 排列方式 */}
                <label className="field-label">排列方式</label>
                <div className="seg">
                  {LAYOUTS.map((lo) => (
                    <button
                      key={lo.key}
                      className={selected.layout === lo.key ? 'seg-item active' : 'seg-item'}
                      onClick={() => patchLayer(selected.id, { layout: lo.key })}
                    >
                      {lo.label}
                    </button>
                  ))}
                </div>

                {/* 旋转（斜排/通用） */}
                <div className="row-between">
                  <label className="field-label">旋转角度</label>
                  <span className="value">
                    {selected.rotation.toFixed(0)}°
                    <button
                      className="btn chip"
                      style={{ marginLeft: 8 }}
                      onClick={() => patchLayer(selected.id, { rotation: 0 })}
                      title="旋转归零"
                    >
                      归零
                    </button>
                  </span>
                </div>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={1}
                  value={selected.rotation}
                  onChange={(e) =>
                    patchLayer(selected.id, { rotation: Number(e.target.value) })
                  }
                />

                {/* 弯曲参数 */}
                {selected.layout === 'curved' && (
                  <>
                    <div className="mini-row">
                      <span className="field-label">弧线半径 {selected.curveRadius.toFixed(0)}</span>
                      <input
                        type="range"
                        min={10}
                        max={80}
                        step={1}
                        value={selected.curveRadius}
                        onChange={(e) =>
                          patchLayer(selected.id, { curveRadius: Number(e.target.value) })
                        }
                      />
                    </div>
                    <div className="mini-row">
                      <span className="field-label">扫过角度 {selected.curveArc.toFixed(0)}°</span>
                      <input
                        type="range"
                        min={10}
                        max={270}
                        step={5}
                        value={selected.curveArc}
                        onChange={(e) =>
                          patchLayer(selected.id, { curveArc: Number(e.target.value) })
                        }
                      />
                    </div>
                    <div className="row-between">
                      <label className="field-label">弧线方向</label>
                      <button
                        className={selected.curveFlip ? 'toggle active' : 'toggle'}
                        onClick={() =>
                          patchLayer(selected.id, { curveFlip: !selected.curveFlip })
                        }
                      >
                        {selected.curveFlip ? '上凸' : '下凸'}
                      </button>
                    </div>
                  </>
                )}

                <p className="hint">在预览区直接拖动文字调整位置</p>

                {/* 文字背景 */}
                <StyleToggle
                  label="文字背景"
                  enabled={selected.bg.enabled}
                  onToggle={() =>
                    patchLayer(selected.id, { bg: { ...selected.bg, enabled: !selected.bg.enabled } })
                  }
                >
                  <div className="color-field">
                    <input
                      type="color"
                      value={selected.bg.color}
                      onChange={(e) =>
                        patchLayer(selected.id, { bg: { ...selected.bg, color: e.target.value } })
                      }
                    />
                    <span>颜色</span>
                  </div>
                  <SliderRow
                    label={`不透明度 ${selected.bg.opacity}%`}
                    min={0}
                    max={100}
                    value={selected.bg.opacity}
                    onChange={(v) => patchLayer(selected.id, { bg: { ...selected.bg, opacity: v } })}
                  />
                  <SliderRow
                    label={`背景宽度 ${bgX(selected).toFixed(1)}`}
                    min={0}
                    max={8}
                    step={0.1}
                    value={bgX(selected)}
                    onChange={(v) => patchLayer(selected.id, { bg: { ...selected.bg, paddingX: v } })}
                  />
                  <SliderRow
                    label={`背景高度 ${bgY(selected).toFixed(1)}`}
                    min={0}
                    max={8}
                    step={0.1}
                    value={bgY(selected)}
                    onChange={(v) => patchLayer(selected.id, { bg: { ...selected.bg, paddingY: v } })}
                  />
                  <SliderRow
                    label={`圆角 ${selected.bg.radius.toFixed(1)}`}
                    min={0}
                    max={3}
                    step={0.1}
                    value={selected.bg.radius}
                    onChange={(v) => patchLayer(selected.id, { bg: { ...selected.bg, radius: v } })}
                  />
                </StyleToggle>

                {/* 文字描边 */}
                <StyleToggle
                  label="文字描边"
                  enabled={selected.stroke.enabled}
                  onToggle={() =>
                    patchLayer(selected.id, {
                      stroke: { ...selected.stroke, enabled: !selected.stroke.enabled },
                    })
                  }
                >
                  <div className="color-field">
                    <input
                      type="color"
                      value={selected.stroke.color}
                      onChange={(e) =>
                        patchLayer(selected.id, {
                          stroke: { ...selected.stroke, color: e.target.value },
                        })
                      }
                    />
                    <span>颜色</span>
                  </div>
                  <SliderRow
                    label={`宽度 ${selected.stroke.width.toFixed(1)}`}
                    min={0.1}
                    max={3}
                    step={0.1}
                    value={selected.stroke.width}
                    onChange={(v) =>
                      patchLayer(selected.id, { stroke: { ...selected.stroke, width: v } })
                    }
                  />
                </StyleToggle>

                {/* 文字阴影 */}
                <StyleToggle
                  label="文字阴影"
                  enabled={selected.shadow.enabled}
                  onToggle={() =>
                    patchLayer(selected.id, {
                      shadow: { ...selected.shadow, enabled: !selected.shadow.enabled },
                    })
                  }
                >
                  <div className="color-field">
                    <input
                      type="color"
                      value={selected.shadow.color}
                      onChange={(e) =>
                        patchLayer(selected.id, {
                          shadow: { ...selected.shadow, color: e.target.value },
                        })
                      }
                    />
                    <span>颜色</span>
                  </div>
                  <SliderRow
                    label={`模糊 ${selected.shadow.blur.toFixed(1)}`}
                    min={0}
                    max={5}
                    step={0.1}
                    value={selected.shadow.blur}
                    onChange={(v) =>
                      patchLayer(selected.id, { shadow: { ...selected.shadow, blur: v } })
                    }
                  />
                  <SliderRow
                    label={`X 偏移 ${selected.shadow.offsetX.toFixed(1)}`}
                    min={-3}
                    max={3}
                    step={0.1}
                    value={selected.shadow.offsetX}
                    onChange={(v) =>
                      patchLayer(selected.id, { shadow: { ...selected.shadow, offsetX: v } })
                    }
                  />
                  <SliderRow
                    label={`Y 偏移 ${selected.shadow.offsetY.toFixed(1)}`}
                    min={-3}
                    max={3}
                    step={0.1}
                    value={selected.shadow.offsetY}
                    onChange={(v) =>
                      patchLayer(selected.id, { shadow: { ...selected.shadow, offsetY: v } })
                    }
                  />
                </StyleToggle>
              </>
            )}

            {selected?.kind === 'shape' && (
              <>
                <div className="row-between">
                  <label className="field-label">填充颜色</label>
                  <input
                    type="color"
                    value={selected.fill}
                    onChange={(e) => patchLayer(selected.id, { fill: e.target.value })}
                  />
                </div>
                <SliderRow
                  label={`不透明度 ${selected.opacity}%`}
                  min={0}
                  max={100}
                  value={selected.opacity}
                  onChange={(v) => patchLayer(selected.id, { opacity: v })}
                />
                <SliderRow
                  label={`宽度 ${selected.wPct.toFixed(0)}`}
                  min={2}
                  max={120}
                  value={selected.wPct}
                  onChange={(v) =>
                    patchLayer(selected.id, {
                      wPct: v,
                      hPct: SHAPE_META[selected.shape].lock ? v : selected.hPct,
                    })
                  }
                />
                <SliderRow
                  label={`高度 ${selected.hPct.toFixed(0)}`}
                  min={2}
                  max={120}
                  value={selected.hPct}
                  disabled={SHAPE_META[selected.shape].lock}
                  onChange={(v) => patchLayer(selected.id, { hPct: v })}
                />
                <SliderRow
                  label={`旋转 ${selected.rotation.toFixed(0)}°`}
                  min={-180}
                  max={180}
                  value={selected.rotation}
                  onChange={(v) => patchLayer(selected.id, { rotation: v })}
                />
                <div className="row-between">
                  <label className="field-label">位置</label>
                  <button
                    className="btn chip"
                    onClick={() => patchLayer(selected.id, { x: 0.5, y: 0.5 })}
                  >
                    居中
                  </button>
                </div>
                <StyleToggle
                  label="描边"
                  enabled={selected.stroke.enabled}
                  onToggle={() =>
                    patchLayer(selected.id, {
                      stroke: { ...selected.stroke, enabled: !selected.stroke.enabled },
                    })
                  }
                >
                  <div className="color-field">
                    <input
                      type="color"
                      value={selected.stroke.color}
                      onChange={(e) =>
                        patchLayer(selected.id, {
                          stroke: { ...selected.stroke, color: e.target.value },
                        })
                      }
                    />
                    <span>颜色</span>
                  </div>
                  <SliderRow
                    label={`宽度 ${selected.stroke.width.toFixed(1)}`}
                    min={0.1}
                    max={5}
                    step={0.1}
                    value={selected.stroke.width}
                    onChange={(v) =>
                      patchLayer(selected.id, { stroke: { ...selected.stroke, width: v } })
                    }
                  />
                </StyleToggle>
              </>
            )}

            {selected?.kind === 'image' && (
              <>
                <SliderRow
                  label={`不透明度 ${selected.opacity}%`}
                  min={0}
                  max={100}
                  value={selected.opacity}
                  onChange={(v) => patchLayer(selected.id, { opacity: v })}
                />
                <SliderRow
                  label={`宽度 ${selected.wPct.toFixed(0)}`}
                  min={2}
                  max={200}
                  value={selected.wPct}
                  onChange={(v) => {
                    const ratio = selected.naturalHeight / selected.naturalWidth
                    patchLayer(selected.id, { wPct: v, hPct: v * ratio })
                  }}
                />
                <SliderRow
                  label={`旋转 ${selected.rotation.toFixed(0)}°`}
                  min={-180}
                  max={180}
                  value={selected.rotation}
                  onChange={(v) => patchLayer(selected.id, { rotation: v })}
                />
                <div className="row-between">
                  <label className="field-label">位置</label>
                  <button
                    className="btn chip"
                    onClick={() => patchLayer(selected.id, { x: 0.5, y: 0.5 })}
                  >
                    居中
                  </button>
                </div>
              </>
            )}
          </section>

          {/* 模板管理 */}
          <section className="block">
            <h2>模板管理</h2>
            <div className="row-between">
              <input
                type="text"
                className="template-name-input"
                placeholder="模板名称"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
              />
              <button className="btn chip" onClick={saveTemplate} title="保存当前设计为模板">
                存模板
              </button>
            </div>
            {templates.length === 0 ? (
              <p className="hint" style={{ marginTop: 8 }}>
                暂无模板，设计完成后点击「存模板」保存
              </p>
            ) : (
              <div className="template-list">
                {templates.map((tpl, i) => (
                  <div key={i} className="template-item">
                    <span className="template-name" title={tpl.name}>
                      {tpl.name}
                    </span>
                    <span className="template-meta">
                      {tpl.ratioKey} · {tpl.layers.length}层
                    </span>
                    <button
                      className="btn chip"
                      onClick={() => applyTemplate(tpl)}
                      title="应用此模板"
                    >
                      应用
                    </button>
                    <button
                      className="btn chip"
                      onClick={() => updateTemplate(i)}
                      title="将当前设计覆盖保存到此模板"
                    >
                      更新
                    </button>
                    <button
                      className="btn chip danger"
                      onClick={() => deleteTemplate(i)}
                      title="删除"
                    >
                      删
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <footer className="panel-foot">
          <div className="foot-row">
            <button className="btn ghost danger" onClick={clearBoard}>
              清空画板
            </button>
            <button className="btn export wide" disabled={!img} onClick={onExport}>
              导出 PNG（{W} × {H}）
            </button>
          </div>
        </footer>
      </aside>

      <Stage
        ratioKey={ratioKey}
        img={img}
        tf={tf}
        gradient={gradient}
        layers={layers}
        selectedId={selectedId}
        onImgTransform={setTf}
        onLayerChange={patchLayer}
        onSelectLayer={setSelectedId}
        onRequestUpload={() => fileRef.current?.click()}
      />
    </div>
  )
}

function StyleToggle({
  label,
  enabled,
  onToggle,
  children,
}: {
  label: string
  enabled: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="sub-block">
      <div className="row-between">
        <label className="field-label">{label}</label>
        <button className={enabled ? 'toggle active' : 'toggle'} onClick={onToggle}>
          {enabled ? '开' : '关'}
        </button>
      </div>
      <div className="sub-controls" style={{ opacity: enabled ? 1 : 0.4 }}>
        {children}
      </div>
    </div>
  )
}

function SliderRow({
  label,
  min,
  max,
  step = 1,
  value,
  disabled,
  onChange,
}: {
  label: string
  min: number
  max: number
  step?: number
  value: number
  disabled?: boolean
  onChange: (v: number) => void
}) {
  return (
    <div className="mini-row">
      <span className="field-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}
