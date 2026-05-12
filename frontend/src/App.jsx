import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Trash, Leaf, Recycle, Warning, Cpu, Brain, Upload } from '@phosphor-icons/react'
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

const NAV_ITEMS = [
  { key: 'hardware', label: '硬件与触发', icon: Cpu },
  { key: 'model',    label: '识别引擎',   icon: Brain },
  { key: 'upload',   label: '上传与结果', icon: Upload },
]

export default function App() {
  const [mode, setMode] = useState('clip')
  const [result, setResult] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [historyKey, setHistoryKey] = useState(0)
  const [activeTab, setActiveTab] = useState('hardware')

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

        {/* ====== 左侧导航栏 (窄) ====== */}
        <nav className="w-[200px] flex-shrink-0 border-r border-zinc-200 bg-white flex flex-col">
          <div className="px-5 py-5 border-b border-zinc-100">
            <h1 className="text-base font-bold text-zinc-900">垃圾分类系统</h1>
          </div>

          <div className="flex-1 py-4 space-y-1 px-3">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              const isActive = activeTab === item.key
              return (
                <button
                  key={item.key}
                  onClick={() => setActiveTab(item.key)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${
                    isActive
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700'
                  }`}
                >
                  <Icon weight={isActive ? 'fill' : 'regular'} className="w-5 h-5" />
                  {item.label}
                </button>
              )
            })}
          </div>

          <div className="px-4 py-4 border-t border-zinc-100">
            <p className="text-xs text-zinc-400">ESP32-S3 v4.0.0</p>
          </div>
        </nav>

        {/* ====== 右侧主区域 ====== */}
        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* 状态栏 */}
          <div className="px-6 py-3 border-b border-zinc-200 bg-white">
            <StatusBar />
          </div>

          {/* 内容区 */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-[960px] mx-auto space-y-6">
              {/* 选项卡内容 */}
              {activeTab === 'hardware' && <HardwarePanel />}

              {activeTab === 'model' && (
                <ModelSelector mode={mode} setMode={setMode} disabled={isLoading} />
              )}

              {activeTab === 'upload' && (
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
              )}

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
