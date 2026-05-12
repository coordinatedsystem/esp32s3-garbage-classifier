import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Trash, Leaf, Recycle, Warning, Cpu, Brain, Upload, HandPointing, Ruler } from '@phosphor-icons/react'
import { checkHealth, getRuntimeMetrics, getHardwareStatus } from './api'
import usePolling from './hooks/usePolling'
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

const NAV_ITEMS = [
  { key: 'hardware', label: '硬件与触发', icon: Cpu },
  { key: 'model',    label: '识别引擎',   icon: Brain },
  { key: 'upload',   label: '上传与结果', icon: Upload },
]

const MODEL_LABELS = { clip: 'CLIP', doubao: '豆包', qwen: '千问', custom: '自定义', detect: 'YOLO' }
const TRIGGER_LABELS = { button: '按键触发', distance: '距离触发' }

export default function App() {
  const [mode, setMode] = useState('clip')
  const [result, setResult] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [historyKey, setHistoryKey] = useState(0)
  const [activeTab, setActiveTab] = useState('hardware')

  const fetchHealth = useCallback(() => checkHealth(), [])
  const { data: health, loading: healthLoading } = usePolling(fetchHealth, { interval: 10000 })
  const fetchMetrics = useCallback(() => getRuntimeMetrics(), [])
  const { data: metrics } = usePolling(fetchMetrics, { interval: 10000 })
  const fetchHwStatus = useCallback(() => getHardwareStatus(), [])
  const { data: hwStatus, loading: hwLoading } = usePolling(fetchHwStatus, { interval: 6000 })

  const serverOnline = health?.status === 'healthy'
  const hardwareOnline = hwStatus?.online
  const latency = health?.latency
  const captures = hwStatus?.capture_count || 0
  const activeModel = health?.active_model || 'clip'
  const triggerMode = health?.trigger_config?.mode || 'button'
  const queueDepth = metrics?.queue_depth ?? 0
  const errorRatePct = metrics?.error_rate !== undefined ? (metrics.error_rate * 100).toFixed(1) : '—'

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
    <div className="min-h-[100dvh] bg-[#f8f8f8]">
      <div className="flex h-screen overflow-hidden">

        {/* ====== 左侧导航栏 ====== */}
        <nav className="w-[220px] flex-shrink-0 border-r border-zinc-200 bg-white flex flex-col">
          {/* 标题 */}
          <div className="px-5 py-4 border-b border-zinc-100">
            <h1 className="text-base font-bold text-zinc-900">垃圾分类系统</h1>
            <p className="text-xs text-zinc-400 mt-0.5">ESP32-S3 智能识别</p>
          </div>

          {/* 导航项 */}
          <div className="py-3 space-y-1 px-3">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              const isActive = activeTab === item.key
              return (
                <button
                  key={item.key}
                  onClick={() => setActiveTab(item.key)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                    isActive
                      ? 'bg-indigo-50 text-indigo-700 shadow-sm'
                      : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700'
                  }`}
                >
                  <Icon weight={isActive ? 'fill' : 'regular'} className="w-5 h-5" />
                  {item.label}
                </button>
              )
            })}
          </div>

          {/* 分隔线 */}
          <div className="mx-4 border-t border-zinc-100" />

          {/* 系统信息 */}
          <div className="flex-1 py-4 px-3 space-y-2.5 overflow-y-auto">
            <p className="px-3 pb-1 text-xs font-bold text-zinc-400 uppercase tracking-wider">系统状态</p>

            {/* 服务状态 */}
            <div className={`px-3 py-2.5 rounded-xl transition-colors ${
              healthLoading ? 'bg-zinc-50' : serverOnline ? 'bg-emerald-50/60' : 'bg-red-50/60'
            }`}>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ring-2 ${
                  healthLoading ? 'bg-zinc-300 ring-zinc-100' :
                  serverOnline ? 'bg-emerald-500 ring-emerald-100' : 'bg-red-500 ring-red-100'
                }`} />
                <span className="text-xs font-medium text-zinc-500">服务</span>
              </div>
              <p className={`text-[13px] font-semibold mt-0.5 pl-4 ${
                healthLoading ? 'text-zinc-400' : serverOnline ? 'text-emerald-700' : 'text-red-600'
              }`}>
                {healthLoading ? '检测中...' : serverOnline ? `在线 · ${latency ?? '—'}ms` : '已离线'}
              </p>
            </div>

            {/* 硬件状态 */}
            <div className={`px-3 py-2.5 rounded-xl transition-colors ${
              hwLoading ? 'bg-zinc-50' : hardwareOnline ? 'bg-indigo-50/60' : 'bg-zinc-50'
            }`}>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ring-2 ${
                  hwLoading ? 'bg-zinc-300 ring-zinc-100' :
                  hardwareOnline ? 'bg-indigo-500 ring-indigo-100' : 'bg-zinc-300 ring-zinc-100'
                }`} />
                <span className="text-xs font-medium text-zinc-500">硬件</span>
              </div>
              <p className={`text-[13px] font-semibold mt-0.5 pl-4 ${
                hwLoading ? 'text-zinc-400' : hardwareOnline ? 'text-indigo-700' : 'text-zinc-400'
              }`}>
                {hwLoading ? '检测中...' : hardwareOnline ? `在线 · ${captures} 次采集` : '离线'}
              </p>
            </div>

            {/* 当前模型 */}
            <div className="px-3 py-2.5 rounded-xl bg-violet-50/60 transition-colors">
              <div className="flex items-center gap-2">
                <Brain weight="bold" className="w-4 h-4 text-violet-500 flex-shrink-0" />
                <span className="text-xs font-medium text-zinc-500">模型</span>
              </div>
              <p className="text-[13px] font-semibold text-violet-700 mt-0.5 pl-6">
                {MODEL_LABELS[activeModel] || activeModel}
              </p>
            </div>

            {/* 触发模式 */}
            <div className={`px-3 py-2.5 rounded-xl transition-colors ${
              triggerMode === 'distance' ? 'bg-amber-50/60' : 'bg-emerald-50/60'
            }`}>
              <div className="flex items-center gap-2">
                {triggerMode === 'distance'
                  ? <Ruler weight="bold" className="w-4 h-4 text-amber-500 flex-shrink-0" />
                  : <HandPointing weight="bold" className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                }
                <span className="text-xs font-medium text-zinc-500">触发</span>
              </div>
              <p className={`text-[13px] font-semibold mt-0.5 pl-6 ${
                triggerMode === 'distance' ? 'text-amber-700' : 'text-emerald-700'
              }`}>
                {TRIGGER_LABELS[triggerMode] || triggerMode}
              </p>
            </div>

            {/* 推理队列 */}
            <div className={`px-3 py-2.5 rounded-xl transition-colors ${
              queueDepth > 0 ? 'bg-amber-50/60' : 'bg-zinc-50'
            }`}>
              <div className="flex items-center gap-2">
                <Cpu weight="bold" className={`w-4 h-4 flex-shrink-0 ${queueDepth > 0 ? 'text-amber-500' : 'text-zinc-400'}`} />
                <span className="text-xs font-medium text-zinc-500">推理队列</span>
              </div>
              <p className={`text-[13px] font-semibold mt-0.5 pl-6 ${queueDepth > 0 ? 'text-amber-700' : 'text-zinc-500'}`}>
                {queueDepth}
              </p>
            </div>

            {/* 请求错误率 */}
            <div className="px-3 py-2.5 rounded-xl bg-zinc-50">
              <div className="flex items-center gap-2">
                <Warning weight="bold" className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                <span className="text-xs font-medium text-zinc-500">请求错误率</span>
              </div>
              <p className="text-[13px] font-semibold text-zinc-600 mt-0.5 pl-6">
                {errorRatePct}%
              </p>
            </div>
          </div>

          {/* 底部版本 */}
          <div className="px-4 py-3 border-t border-zinc-100">
            <p className="text-[10px] text-zinc-400">v5.0.0</p>
          </div>
        </nav>

        {/* ====== 右侧主区域 ====== */}
        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* 内容区 */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-[960px] mx-auto space-y-6">
              {/* 选项卡内容 — 全部保持挂载，仅隐藏非活跃面板 */}
              <div className={activeTab === 'hardware' ? '' : 'hidden'}>
                <HardwarePanel status={hwStatus} loading={hwLoading} />
              </div>

              <div className={activeTab === 'model' ? '' : 'hidden'}>
                <ModelSelector mode={mode} setMode={setMode} disabled={isLoading} />
              </div>

              <div className={activeTab === 'upload' ? '' : 'hidden'}>
                <div className="space-y-6">
                  <UploadPanel
                    mode={mode}
                    isLoading={isLoading}
                    setIsLoading={setIsLoading}
                    setError={setError}
                    onResult={handleResult}
                    onClear={handleClear}
                  />

                  <AnimatePresence mode="wait">
                    {isLoading ? (
                      <LoadingSkeleton key="loading" />
                    ) : error ? (
                      <ErrorState key="error" message={error} onDismiss={() => setError(null)} />
                    ) : result ? (
                      <ResultsDisplay key="result" result={result} categoryConfig={CATEGORY_CONFIG} />
                    ) : null}
                  </AnimatePresence>
                </div>
              </div>

              {/* 历史记录 — 仅在硬件和上传标签时显示 */}
              {(activeTab === 'hardware' || activeTab === 'upload') && (
                <HistoryList categoryConfig={CATEGORY_CONFIG} refreshKey={historyKey} />
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

/* ---- 内部子组件 ---- */

function LoadingSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-zinc-200 p-8 space-y-5">
      <div className="skeleton rounded-lg h-5 w-28" />
      <div className="skeleton rounded-xl aspect-video w-full" />
      <div className="space-y-2.5">
        <div className="skeleton rounded-md h-4 w-3/4" />
        <div className="skeleton rounded-md h-4 w-1/2" />
        <div className="skeleton rounded-md h-4 w-2/3" />
      </div>
    </div>
  )
}

function ErrorState({ message, onDismiss }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.99 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.99 }}
      className="bg-white rounded-2xl border border-zinc-200 p-8"
    >
      <div className="flex flex-col items-center justify-center py-10 gap-4 text-center">
        <div className="w-14 h-14 rounded-xl bg-red-50 flex items-center justify-center">
          <Warning weight="fill" className="w-7 h-7 text-red-500" />
        </div>
        <div>
          <h3 className="text-base font-bold text-zinc-800">识别失败</h3>
          <p className="mt-1 text-sm text-zinc-500 max-w-[40ch]">{message}</p>
        </div>
        <button
          onClick={onDismiss}
          className="mt-2 px-5 py-2.5 rounded-lg bg-zinc-900 text-white text-sm font-semibold transition-colors active:scale-[0.98] hover:bg-zinc-800"
        >
          重试
        </button>
      </div>
    </motion.div>
  )
}
