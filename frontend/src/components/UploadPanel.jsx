import { useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Plus, UploadSimple } from '@phosphor-icons/react'
import { classifyImage, detectImage } from '../api'

export default function UploadPanel({ mode, isLoading, setIsLoading, setError, onResult, onClear }) {
  const [preview, setPreview] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef(null)

  const handleFile = useCallback(async (file) => {
    if (!file || !file.type.startsWith('image/')) {
      setError('请选择有效的图片文件（JPEG、PNG、WebP）')
      return
    }

    const url = URL.createObjectURL(file)
    setPreview(url)
    setIsLoading(true)
    setError(null)

    try {
      const isDetect = mode === 'detect'
      const data = isDetect
        ? await detectImage(file)
        : await classifyImage(file, mode)
      onResult(data, url)
    } catch (err) {
      setError(err.message || '网络错误，请检查后端服务是否运行')
    } finally {
      setIsLoading(false)
    }
  }, [mode, setIsLoading, setError, onResult])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handleClear = () => {
    if (preview) {
      URL.revokeObjectURL(preview)
      setPreview(null)
    }
    if (fileRef.current) fileRef.current.value = ''
    onClear()
  }

  const modeLabels = {
    clip: 'CLIP 分类', doubao: '豆包 Vision', qwen: '千问 Vision',
    custom: '自定义 Vision', detect: 'YOLO 检测'
  }
  const modeLabel = modeLabels[mode] || 'CLIP 分类'

  return (
    <div className="glass-card rounded-[2.5rem] p-6 lg:p-8">
      {/* 标题 */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-lg font-bold text-zinc-800 tracking-tight">图片测试</h3>
          <p className="text-xs text-zinc-400 mt-0.5">
            当前模式：<span className="font-semibold text-indigo-500">{modeLabel}</span>
          </p>
        </div>
      </div>

      {/* 上传区域 */}
      <AnimatePresence mode="wait">
        {preview ? (
          <motion.div
            key="preview"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="relative rounded-2xl overflow-hidden bg-zinc-100"
          >
            <img src={preview} alt="预览" className="w-full object-contain max-h-[240px]" />
            <button
              onClick={handleClear}
              disabled={isLoading}
              className="absolute top-3 right-3 w-8 h-8 rounded-xl bg-white/80 backdrop-blur-sm flex items-center justify-center spring-transition hover:bg-white active:scale-95"
            >
              <X weight="bold" className="w-4 h-4 text-zinc-600" />
            </button>
            {isLoading && (
              <div className="absolute inset-0 bg-white/60 backdrop-blur-sm flex items-center justify-center">
                <div className="flex items-center gap-3 px-5 py-3 rounded-2xl bg-white shadow-lg">
                  <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm font-medium text-zinc-700">
                    {mode === 'detect' ? 'YOLO 检测中...' : `${modeLabel} 识别中...`}
                  </span>
                </div>
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="dropzone"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className={`relative rounded-2xl border-2 border-dashed transition-colors cursor-pointer
              ${dragOver
                ? 'border-indigo-400 bg-indigo-50/50'
                : 'border-zinc-200 hover:border-zinc-300 bg-zinc-50/50'
              }`}
          >
            <div className="flex flex-col items-center justify-center py-12 px-6 gap-3">
              <motion.div
                animate={dragOver ? { scale: 1.05 } : { scale: 1 }}
                className={`w-12 h-12 rounded-2xl flex items-center justify-center spring-transition ${
                  dragOver ? 'bg-indigo-100' : 'bg-zinc-100'
                }`}
              >
                {dragOver
                  ? <Plus weight="bold" className="w-6 h-6 text-indigo-600" />
                  : <UploadSimple weight="bold" className="w-6 h-6 text-zinc-400" />
                }
              </motion.div>
              <div className="text-center">
                <p className="text-sm font-medium text-zinc-600">
                  {dragOver ? '释放以分析' : '拖拽图片到此处'}
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  或点击选择 — 支持 JPEG、PNG、WebP
                </p>
              </div>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }}
              className="hidden"
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 模式说明 */}
      <p className="mt-4 text-xs text-zinc-400 leading-relaxed px-1">
        {mode === 'detect'
          ? 'YOLO 目标检测：在图像中定位物体并用边界框标出'
          : mode === 'clip'
            ? 'CLIP 零样本分类：识别图像中的物体并自动匹配垃圾类别'
            : `${modeLabel}：云端大模型视觉识别，返回图片中物品的英文名称`
        }
      </p>
    </div>
  )
}
