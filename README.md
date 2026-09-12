# 封面设计工作台（Cover Studio）

纯前端运行的封面设计工具：导入图片后，可在浏览器内完成裁剪比例、渐变标题区、多文字图层排版，并一键导出高清 PNG。无需后端，所有数据保存在浏览器本地。

## 功能

- **图片导入与画幅**：支持 3:4 / 9:16 / 4:3 三种比例，图片可拖拽定位、滚轮缩放
- **渐变标题区**：双色渐变、6 个方向、透明度可调，底部渐隐融入图片
- **文字图层**
  - 多图层新增 / 删除 / 选中，画布上直接拖拽定位，拖动时显示居中参考线
  - 调用电脑系统全部字体（Font Access API），中文字体名显示；支持导入 `.ttf / .otf / .woff / .woff2` 字体文件（IndexedDB 持久化，刷新无需重新导入）
  - 横排 / 竖排 / 斜排（任意旋转）/ 弯曲排列（SVG textPath + Canvas 沿弧绘制）
  - 字号（滑块或拖动手柄）、颜色、加粗 / 斜体 / 下划线 / 删除线、左 / 中 / 右对齐
  - 文字背景（宽度 / 高度 / 圆角 / 不透明度独立可调）、文字描边、文字阴影
- **模板**：当前设计可存为模板，随时应用 / 更新 / 删除（localStorage 持久化）
- **导出**：高清 PNG（3:4 → 1080×1440，9:16 → 1080×1920，4:3 → 1440×1080）

## 技术栈

- React 18 + TypeScript + Vite
- 预览为 DOM/SVG，导出为 Canvas 离屏渲染，两端同源参数保证所见即所得
- Font Access API（`queryLocalFonts`）、CSS Font Loading API（`FontFace`）、IndexedDB、localStorage

## 本地开发

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build     # 类型检查 + 产物输出到 dist/
npm run preview   # 本地预览构建产物
```

## 部署

构建产物为纯静态文件，可直接部署到 GitHub Pages / Vercel / Netlify 等任意静态托管。

部署到 GitHub Pages 的项目站点（`https://用户名.github.io/仓库名/`）时，需在 `vite.config.ts` 中设置：

```ts
export default defineConfig({
  base: '/仓库名/',
  // ...
})
```

## 浏览器支持

- 推荐使用最新版 Chrome / Edge（完整支持 `queryLocalFonts` 系统字体调取）
- Safari / Firefox 可正常使用，系统字体走内置候选列表检测
