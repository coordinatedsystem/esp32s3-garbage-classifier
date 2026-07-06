import { useState, useCallback, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Trash, Leaf, Recycle, Warning, Cpu, Brain, Upload, HandPointing, Ruler, Sliders, Camera, ArrowsClockwise, Gear, CheckCircle } from '@phosphor-icons/react'
import { checkHealth, getRuntimeMetrics, getHardwareStatus, getQualityConfig, setQualityConfig } from './api'
import usePolling from './hooks/usePolling'
import ModelSelector from './components/ModelSelector.jsx'
import UploadPanel from './components/UploadPanel.jsx'
import ResultsDisplay from './components/ResultsDisplay.jsx'
import HistoryList from './components/HistoryList.jsx'
import HardwarePanel from './components/HardwarePanel.jsx'
import ConfigViewer from './components/ConfigViewer.jsx'

const CATEGORY_CONFIG = {
  recyclable:  { icon: Recycle,   label: '可回收物', labelZh: '可回收物', gradient: 'from-sky-500 to-blue-600',   bg: 'bg-sky-50',   text: 'text-sky-700',   ring: 'ring-sky-200' },
  kitchen:     { icon: Leaf,      label: '厨余垃圾', labelZh: '厨余垃圾', gradient: 'from-emerald-500 to-teal-600', bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-200' },
  hazardous:   { icon: Warning,   label: '有害垃圾', labelZh: '有害垃圾', gradient: 'from-red-500 to-rose-600',    bg: 'bg-red-50',    text: 'text-red-700',    ring: 'ring-red-200' },
  other:       { icon: Trash,     label: '其他垃圾', labelZh: '其他垃圾', gradient: 'from-zinc-500 to-zinc-700',    bg: 'bg-zinc-100',  text: 'text-zinc-600',   ring: 'ring-zinc-300' },
}

const NAV_ITEMS = [
  { key: 'hardware', label: '设备', icon: Cpu },
  { key: 'model',    label: '模型',   icon: Brain },
  { key: 'upload',   label: '识别', icon: Upload },
  { key: 'config',   label: '配置', icon: Gear },
]

const MODEL_LABELS = { clip: 'CLIP', doubao: '豆包', qwen: '千问', custom: '自定义', detect: 'YOLO' }
const TRIGGER_LABELS = { button: '按键', distance: '距离' }
const SYNC_LABELS = { synced: '配置同步', pending: '同步中', outofsync: '配置未同步' }
const SYNC_COLORS = {
  synced:    { dot: 'bg-emerald-500', bg: 'bg-emerald-50/60', text: 'text-emerald-700' },
  pending:   { dot: 'bg-amber-400',   bg: 'bg-amber-50/60',   text: 'text-amber-700' },
  outofsync: { dot: 'bg-red-500',     bg: 'bg-red-50/60',     text: 'text-red-700' },
}

export default function App() {
  const [mode, setMode] = useState('clip')
  const [result, setResult] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [historyKey, setHistoryKey] = useState(0)
  const [activeTab, setActiveTab] = useState('trigger')
  const [captureEventKey, setCaptureEventKey] = useState(0)
  const [esp32Result, setEsp32Result] = useState(null)
  const [esp32ImageKey, setEsp32ImageKey] = useState(0)

  // Quality
  const [quality, setQuality] = useState(85)
  const [qualitySaving, setQualitySaving] = useState(false)
  const [qualityMsg, setQualityMsg] = useState('')

  // Config sync status (synced | pending | outofsync)
  const [configSyncState, setConfigSyncState] = useState('synced')

  const fetchHealth = useCallback(() => checkHealth(), [])
  const { data: health, loading: healthLoading } = usePolling(fetchHealth, { interval: 5000 })
  const fetchMetrics = useCallback(() => getRuntimeMetrics(), [])
  const { data: metrics } = usePolling(fetchMetrics, { interval: 10000 })
  const fetchHwStatus = useCallback(() => getHardwareStatus(), [])
  const { data: hwStatus, loading: hwLoading, setData: setHwStatus } = usePolling(fetchHwStatus, { interval: 60000 })

  // Called by child components after saving config → mark pending
  const handleConfigChange = useCallback(() => {
    setConfigSyncState('pending')
  }, [])

  // Sync detection:
  const prevHwOnlineRef = useRef(null)
  useEffect(() => {
    const online = hwStatus?.online
    if (prevHwOnlineRef.current === false && online === true && configSyncState === 'pending') {
      setConfigSyncState('synced')
    }
    prevHwOnlineRef.current = online
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hwStatus?.online])

  useEffect(() => {
    if (configSyncState !== 'pending') return
    if (hwStatus?.online) {
      const t = setTimeout(() => setConfigSyncState('synced'), 10000)
      return () => clearTimeout(t)
    } else {
      const t = setTimeout(() => setConfigSyncState('outofsync'), 45000)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configSyncState, hwStatus?.online])

  // Load quality
  useEffect(() => {
    getQualityConfig().then(cfg => {
      if (cfg?.jpeg_quality) setQuality(cfg.jpeg_quality)
    }).catch(() => {})
  }, [])

  // Sync quality from health
  useEffect(() => {
    if (health?.quality_config?.jpeg_quality) {
      setQuality(health.quality_config.jpeg_quality)
    }
  }, [health])

  // SSE
  useEffect(() => {
    const es = new EventSource('/events')
    es.addEventListener('hw_status', (e) => {
      try { setHwStatus(JSON.parse(e.data)) } catch {}
    })
    es.addEventListener('new_capture', () => {
      setCaptureEventKey(k => k + 1)
      setEsp32ImageKey(k => k + 1)
    })
    es.addEventListener('new_result', (e) => {
      try {
        const data = JSON.parse(e.data)
        setEsp32Result(data)
        setHistoryKey(k => k + 1)
      } catch {}
    })
    return () => es.close()
  }, [setHwStatus])

  const handleQualitySave = async () => {
    setQualitySaving(true)
    setQualityMsg('')
    try {
      await setQualityConfig({ jpeg_quality: quality })
      setQualityMsg('已应用')
      handleConfigChange()
      setTimeout(() => setQualityMsg(''), 2000)
    } catch (e) {
      setQualityMsg('失败: ' + (e.message || '网络错误'))
      setTimeout(() => setQualityMsg(''), 3000)
    }
    setQualitySaving(false)
  }

  const serverOnline = health?.status === 'healthy'
  const hardwareOnline = hwStatus?.online
  const captures = hwStatus?.capture_count || 0
  const activeModel = health?.active_model || 'clip'
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

  const syncColor = SYNC_COLORS[configSyncState] || SYNC_COLORS.synced
  const syncLabel = SYNC_LABELS[configSyncState] || '已同步'

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="flex h-screen overflow-hidden">

        {/* ====== Sidebar ====== */}
        <nav className="w-56 flex-shrink-0 bg-white border-r border-slate-200 flex flex-col">
          <div className="px-5 py-5 border-b border-slate-100">
            <h1 className="text-[15px] font-bold text-slate-800 tracking-tight">垃圾分类系统</h1>
            <p className="text-[11px] text-slate-400 mt-0.5 font-medium">ESP32-S3 智能识别</p>
          </div>

          <div className="py-2.5 px-2.5 space-y-0.5 flex-1 overflow-y-auto">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              const isActive = activeTab === item.key
              return (
                <button key={item.key} onClick={() => setActiveTab(item.key)}
                  className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    isActive ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                  }`}>
                  <Icon weight={isActive ? 'fill' : 'regular'} className="w-[18px] h-[18px]" />
                  {item.label}
                </button>
              )
            })}
          </div>

          <div className="border-t border-slate-100 px-4 py-3 space-y-2.5">
            <StatusRow label="服务" loading={healthLoading} online={serverOnline} detail={healthLoading ? '检测中' : (serverOnline ? '在线' : '离线')} color="emerald" />
            <StatusRow label="硬件" loading={hwLoading} online={hardwareOnline} detail={hwLoading ? '检测中' : (hardwareOnline ? `${captures} 次` : '离线')} color="blue" />

            {/* Config sync status */}
            <div className={`px-3 py-2 rounded-lg ${syncColor.bg} transition-colors`}>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ring-2 ${syncColor.dot} ${configSyncState === 'synced' ? 'dot-online' : 'dot-pulse'}`} />
                <span className="text-[11px] font-medium text-slate-500">配置</span>
                <span className={`ml-auto text-[11px] font-semibold ${syncColor.text}`}>{syncLabel}</span>
              </div>
            </div>

            <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-violet-50/60">
              <Brain weight="bold" className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
              <span className="text-[11px] text-violet-700 font-semibold">{MODEL_LABELS[activeModel] || activeModel}</span>
            </div>
            <div className={`flex items-center gap-2.5 px-3 py-2 rounded-lg ${triggerMode === 'distance' ? 'bg-amber-50/60' : 'bg-emerald-50/60'}`}>
              {triggerMode === 'distance'
                ? <Ruler weight="bold" className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                : <HandPointing weight="bold" className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />}
              <span className="text-[11px] font-semibold text-slate-600">{TRIGGER_LABELS[triggerMode] || triggerMode}</span>
            </div>

            {/* Quality slider */}
            <div className="px-3 py-2.5 rounded-lg bg-slate-50">
              <div className="flex items-center gap-2 mb-1.5">
                <Sliders weight="bold" className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                <span className="text-[11px] font-medium text-slate-500">画质</span>
                <span className="ml-auto text-[11px] font-mono text-slate-500">{quality}%</span>
              </div>
              <input type="range" min="10" max="95" value={quality}
                onChange={e => setQuality(Number(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none bg-slate-200 accent-blue-500 cursor-pointer" />
              <div className="mt-1.5 flex items-center gap-2">
                <button onClick={handleQualitySave} disabled={qualitySaving}
                  className="flex-1 py-1 rounded-md bg-blue-600 text-white text-[10px] font-semibold hover:bg-blue-700 disabled:opacity-50">
                  {qualitySaving ? '保存中' : '应用'}
                </button>
                {qualityMsg && (
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                    qualityMsg.startsWith('失败') ? 'text-red-500 bg-red-50' : 'text-emerald-600 bg-emerald-50'}`}>
                    {qualityMsg}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="px-4 py-3 border-t border-slate-100">
            <p className="text-[10px] text-slate-400 font-medium">v5.2.0</p>
          </div>
        </nav>

        {/* ====== Main ====== */}
        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div className="flex items-center justify-between px-6 py-3 border-b border-slate-200 bg-white">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 dot-online" />
              <span className="text-xs font-medium text-slate-500">{serverOnline ? '服务在线' : '服务离线'}</span>
            </div>
            <button onClick={() => window.location.reload()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-all">
              <ArrowsClockwise weight="bold" className="w-3.5 h-3.5" />
              刷新
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-[960px] mx-auto space-y-5">
              <div className={activeTab === 'hardware' ? '' : 'hidden'}>
                <HardwarePanel status={hwStatus} loading={hwLoading} captureEventKey={captureEventKey} visible={activeTab === 'hardware'} onConfigChange={handleConfigChange} />
              </div>
              <div className={activeTab === 'model' ? '' : 'hidden'}>
                <ModelSelector mode={mode} setMode={setMode} disabled={isLoading} visible={activeTab === 'model'} />
              </div>
              <div className={activeTab === 'config' ? '' : 'hidden'}>
                <ConfigViewer />
              </div>
              <div className={activeTab === 'upload' ? '' : 'hidden'}>
                <div className="space-y-5">
                  <UploadPanel mode={mode} isLoading={isLoading} setIsLoading={setIsLoading}
                    setError={setError} onResult={handleResult} onClear={handleClear} />
                  <AnimatePresence mode="wait">
                    {isLoading ? (<LoadingSkeleton key="loading" />)
                    : error ? (<ErrorState key="error" message={error} onDismiss={() => setError(null)} />)
                    : result ? (<ResultsDisplay key="result" result={result} categoryConfig={CATEGORY_CONFIG} />) : null}
                  </AnimatePresence>
                </div>
              </div>
              <HistoryList categoryConfig={CATEGORY_CONFIG} refreshKey={historyKey} visible={activeTab === 'hardware' || activeTab === 'upload'} />
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

function StatusRow({ label, loading, online, detail, color }) {
  const colorMap = {
    emerald: { dot: 'bg-emerald-500', ring: 'ring-emerald-100', bg: 'bg-emerald-50/60', text: 'text-emerald-700' },
    blue:    { dot: 'bg-blue-500',    ring: 'ring-blue-100',    bg: 'bg-blue-50/60',    text: 'text-blue-700' },
    red:     { dot: 'bg-red-500',     ring: 'ring-red-100',     bg: 'bg-red-50/60',     text: 'text-red-700' },
  }
  const c = loading
    ? { dot: 'bg-slate-300', ring: 'ring-slate-100', bg: 'bg-slate-50', text: 'text-slate-400' }
    : online
      ? (colorMap[color] || { dot: 'bg-slate-300', ring: 'ring-slate-100', bg: 'bg-slate-50', text: 'text-slate-400' })
      : { dot: 'bg-slate-300', ring: 'ring-slate-100', bg: 'bg-slate-50', text: 'text-slate-400' }
  return (
    <div className={`px-3 py-2 rounded-lg ${c.bg}`}>
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ring-2 ${c.dot} ${c.ring} ${online ? 'dot-online' : ''}`} />
        <span className="text-[11px] font-medium text-slate-500">{label}</span>
        <span className={`ml-auto text-[11px] font-semibold ${c.text}`}>{detail}</span>
      </div>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
      <div className="skeleton-pulse rounded-lg h-4 w-24" />
      <div className="skeleton-pulse rounded-xl aspect-video w-full" />
      <div className="space-y-2">
        <div className="skeleton-pulse rounded-md h-3 w-3/4" />
        <div className="skeleton-pulse rounded-md h-3 w-1/2" />
      </div>
    </div>
  )
}

function ErrorState({ message, onDismiss }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="bg-white rounded-2xl border border-slate-200 p-6">
      <div className="flex flex-col items-center justify-center py-8 gap-4 text-center">
        <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center">
          <Warning weight="fill" className="w-6 h-6 text-red-500" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-slate-800">识别失败</h3>
          <p className="mt-1 text-xs text-slate-500 max-w-[40ch]">{message}</p>
        </div>
        <button onClick={onDismiss}
          className="mt-1 px-5 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800">
          重试
        </button>
      </div>
    </motion.div>
  )
}
