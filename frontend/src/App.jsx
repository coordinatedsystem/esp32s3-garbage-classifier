import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Trash, Leaf, Recycle, Warning, Flask } from '@phosphor-icons/react'
import StatusBar from './components/StatusBar.jsx'
import ModelSelector from './components/ModelSelector.jsx'
import UploadPanel from './components/UploadPanel.jsx'
import ResultsDisplay from './components/ResultsDisplay.jsx'
import HistoryList from './components/HistoryList.jsx'
import HardwarePanel from './components/HardwarePanel.jsx'

const CATEGORY_CONFIG = {
  recyclable:  { icon: Recycle,   label: '可回收物', labelZh: '可回收物', gradient: 'from-sky-500 to-blue-600',   bg: 'bg-sky-50',   text: 'text-sky-700',   ring: 'ring-sky-200' },
  kitchen:     { icon: Leaf,      label: '厨余垃圾', labelZh: '厨余垃圾', gradient: 'from-emerald-500 to-teal-600', bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-200' },
  hazardous:   { icon: Warning,   label: '有害垃圾', labelZh: '有害垃圾', gradient: 'from-red-500 to-rose-600',    bg: 'bg-red-50',    text: 'text-red-700',    ring: 'ring-red-200' },
  other:       { icon: Trash,     label: '其他垃圾', labelZh: '其他垃圾', gradient: 'from-zinc-500 to-zinc-700',    bg: 'bg-zinc-100',  text: 'text-zinc-600',   ring: 'ring-zinc-300' },
}

const stagger = {
  animate: { transition: { staggerChildren: 0.06 } }
}

const fadeUp = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] } }
}

export default function App() {
  const [mode, setMode] = useState('classify')
  const [result, setResult] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [historyKey, setHistoryKey] = useState(0)

  const handleResult = useCallback((data, imageUrl) => {
    setResult(data)
    setError(null)
    setHistoryKey(k => k + 1)
  }, [])

  const handleClear = useCallback(() => {
    setResult(null)
    setError(null)
  }, [])

  return (
    <div className="min-h-[100dvh] bg-[#fafafa]">
      {/* 环境光晕 */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 right-0 w-[700px] h-[700px] bg-indigo-100/30 rounded-full blur-[140px] translate-x-1/3 -translate-y-1/3" />
        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-violet-100/25 rounded-full blur-[120px] -translate-x-1/4 translate-y-1/4" />
        <div className="absolute top-1/2 left-1/2 w-[400px] h-[400px] bg-amber-50/20 rounded-full blur-[100px] -translate-x-1/2 -translate-y-1/2" />
      </div>

      <div className="relative z-10 max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-10">
        {/* 顶部状态栏 */}
        <StatusBar />

        {/* 标题 */}
        <motion.header
          {...fadeUp}
          className="mt-5 mb-6 lg:mb-8"
        >
          <div className="flex items-center gap-3 mb-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em] bg-indigo-50 text-indigo-500 border border-indigo-100">
              <Flask weight="bold" className="w-3 h-3" />
              ESP32-S3
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em] bg-emerald-50 text-emerald-600 border border-emerald-100">
              <Leaf weight="bold" className="w-3 h-3" />
              智能分类
            </span>
          </div>
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-zinc-900 text-balance max-w-3xl">
            智能垃圾分类系统
          </h1>
          <p className="mt-2 text-sm text-zinc-500 leading-relaxed max-w-[65ch]">
            基于 CLIP 和 YOLO 模型驱动的实时垃圾识别平台。
            ESP32-S3 采集图像，云端 AI 识别，精准分类投放。
          </p>
        </motion.header>

        {/* ====== 核心区域：硬件 + 模型状态（主要展示） ====== */}
        <motion.div
          variants={stagger}
          initial="initial"
          animate="animate"
          className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-6 mb-6"
        >
          <motion.div variants={fadeUp}>
            <HardwarePanel />
          </motion.div>
          <motion.div variants={fadeUp}>
            <ModelSelector mode={mode} setMode={setMode} disabled={isLoading} />
          </motion.div>
        </motion.div>

        {/* ====== 次区域：上传 + 识别结果（放后面） ====== */}
        <motion.div
          variants={stagger}
          initial="initial"
          animate="animate"
          className="grid grid-cols-1 lg:grid-cols-[1fr_1.618fr] gap-5 lg:gap-6 mb-8"
        >
          {/* 上传面板 */}
          <motion.div variants={fadeUp}>
            <UploadPanel
              mode={mode}
              setMode={setMode}
              isLoading={isLoading}
              setIsLoading={setIsLoading}
              setError={setError}
              onResult={handleResult}
              onClear={handleClear}
            />
          </motion.div>

          {/* 识别结果 */}
          <motion.div variants={fadeUp}>
            <AnimatePresence mode="wait">
              {isLoading ? (
                <LoadingSkeleton key="loading" />
              ) : error ? (
                <ErrorState key="error" message={error} onDismiss={() => setError(null)} />
              ) : result ? (
                <ResultsDisplay key="result" result={result} categoryConfig={CATEGORY_CONFIG} />
              ) : (
                <EmptyState key="empty" />
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>

        {/* ====== 历史记录（底部通栏） ====== */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        >
          <HistoryList categoryConfig={CATEGORY_CONFIG} refreshKey={historyKey} />
        </motion.section>
      </div>
    </div>
  )
}

/* ---- 内部子组件 ---- */

function LoadingSkeleton() {
  return (
    <div className="glass-card rounded-[2rem] p-8 lg:p-10 space-y-6">
      <div className="skeleton rounded-xl h-6 w-32" />
      <div className="skeleton rounded-2xl aspect-video w-full" />
      <div className="space-y-3">
        <div className="skeleton rounded-lg h-4 w-3/4" />
        <div className="skeleton rounded-lg h-4 w-1/2" />
        <div className="skeleton rounded-lg h-4 w-2/3" />
      </div>
    </div>
  )
}

function ErrorState({ message, onDismiss }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      className="glass-card rounded-[2rem] p-8 lg:p-10"
    >
      <div className="flex flex-col items-center justify-center py-10 gap-4 text-center">
        <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center">
          <Warning weight="fill" className="w-7 h-7 text-red-500" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-zinc-800">识别失败</h3>
          <p className="mt-1 text-sm text-zinc-500 max-w-[40ch]">{message}</p>
        </div>
        <button
          onClick={onDismiss}
          className="mt-2 px-5 py-2.5 rounded-xl bg-zinc-900 text-white text-sm font-medium spring-transition active:scale-[0.98] hover:bg-zinc-800"
        >
          重试
        </button>
      </div>
    </motion.div>
  )
}

function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="glass-card rounded-[2rem] p-8 lg:p-10"
    >
      <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
        <div className="w-16 h-16 rounded-2xl bg-zinc-100 flex items-center justify-center">
          <Recycle weight="light" className="w-8 h-8 text-zinc-400" />
        </div>
        <div className="max-w-[32ch]">
          <h3 className="text-lg font-semibold text-zinc-700">等待分析</h3>
          <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
            上传图片或通过 ESP32-S3 设备采集图像，查看 AI 分类结果。
          </p>
        </div>
      </div>
    </motion.div>
  )
}
