import { memo, useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Cpu, Camera, ClockCounterClockwise, WifiHigh, Info, ImageSquare, Lightning, HandPointing, Ruler, Check, CaretDown } from '@phosphor-icons/react'
import { getHardwareImageUrl, getTriggerConfig, setTriggerConfig } from '../api'
import CameraControls from './CameraControls'

const HardwarePanel = memo(function HardwarePanel({ status, loading, captureEventKey, visible, onConfigChange }) {
  const [imgKey, setImgKey] = useState(0)
  const prevCaptureCount = useRef(null)
  const [imgError, setImgError] = useState(false)

  // 触发配置 state
  const [trigMode, setTrigMode] = useState('button')
  const [trigMin, setTrigMin] = useState(30)
  const [trigMax, setTrigMax] = useState(300)
  const [trigCooldown, setTrigCooldown] = useState(2000)
  const [trigInterval, setTrigInterval] = useState(10000)
  const [trigQuality, setTrigQuality] = useState(85)
  const [trigSaving, setTrigSaving] = useState(false)
  const [trigMsg, setTrigMsg] = useState('')
  const [trigExpanded, setTrigExpanded] = useState(true)

  const trigRef = useRef({})

  useEffect(() => {
    if (!visible) return
    getTriggerConfig().then(cfg => {
      const snap = {
        mode: cfg.mode || 'button',
        distance_min: cfg.distance_min ?? 30,
        distance_max: cfg.distance_max ?? 300,
        cooldown_ms: cfg.cooldown_ms ?? 2000,
        trigger_interval_ms: cfg.trigger_interval_ms ?? 10000,
        jpeg_quality: cfg.jpeg_quality ?? 85,
      }
      trigRef.current = snap
      setTrigMode(snap.mode)
      setTrigMin(snap.distance_min)
      setTrigMax(snap.distance_max)
      setTrigCooldown(snap.cooldown_ms)
      setTrigInterval(snap.trigger_interval_ms)
      setTrigQuality(snap.jpeg_quality)
    }).catch(() => {})
  }, [visible])

  const trigChanged = () => {
    const r = trigRef.current
    return trigMode !== r.mode || Number(trigMin) !== r.distance_min ||
      Number(trigMax) !== r.distance_max || Number(trigCooldown) !== r.cooldown_ms ||
      Number(trigInterval) !== r.trigger_interval_ms || Number(trigQuality) !== r.jpeg_quality
  }

  const msgTimers = useRef([])

  useEffect(() => {
    return () => msgTimers.current.forEach(clearTimeout)
  }, [])

  const handleTrigSave = async () => {
    setTrigSaving(true)
    msgTimers.current.forEach(clearTimeout)
    msgTimers.current = []
    setTrigMsg('')
    try {
      const res = await setTriggerConfig({
        mode: trigMode,
        distance_min: Number(trigMin),
        distance_max: Number(trigMax),
        cooldown_ms: Number(trigCooldown),
        trigger_interval_ms: Number(trigInterval),
        jpeg_quality: Number(trigQuality)
      })
      trigRef.current = {
        mode: trigMode, distance_min: Number(trigMin), distance_max: Number(trigMax),
        cooldown_ms: Number(trigCooldown), trigger_interval_ms: Number(trigInterval),
        jpeg_quality: Number(trigQuality)
      }
      setTrigMsg('已保存')
      if (onConfigChange) onConfigChange()
      msgTimers.current.push(setTimeout(() => setTrigMsg(''), 3000))
    } catch (e) {
      setTrigMsg('错误: ' + e.message)
      msgTimers.current.push(setTimeout(() => setTrigMsg(''), 3000))
      try {
        const cfg = await getTriggerConfig()
        const snap = {
          mode: cfg.mode || 'button',
          distance_min: cfg.distance_min ?? 30,
          distance_max: cfg.distance_max ?? 300,
          cooldown_ms: cfg.cooldown_ms ?? 2000,
          trigger_interval_ms: cfg.trigger_interval_ms ?? 10000,
          jpeg_quality: cfg.jpeg_quality ?? 85,
        }
        trigRef.current = snap
        setTrigMode(snap.mode)
        setTrigMin(snap.distance_min)
        setTrigMax(snap.distance_max)
        setTrigCooldown(snap.cooldown_ms)
        setTrigInterval(snap.trigger_interval_ms)
        setTrigQuality(snap.jpeg_quality)
      } catch (_) {}
    } finally {
      setTrigSaving(false)
    }
  }

  // 通过父组件 SSE 推送的 captureEventKey 驱动图像刷新
  useEffect(() => {
    if (captureEventKey > 0) {
      setImgKey(k => k + 1)
      setImgError(false)
    }
  }, [captureEventKey])

  useEffect(() => {
    if (status && status.capture_count !== undefined) {
      if (prevCaptureCount.current !== null && status.capture_count > prevCaptureCount.current) {
        setImgKey(k => k + 1)
        setImgError(false)
      }
      prevCaptureCount.current = status.capture_count
    }
  }, [status])

  const online = status?.online
  const imageUrl = getHardwareImageUrl()
  const lastCapture = status?.last_capture ? new Date(status.last_capture) : null
  const now = new Date()
  const secondsSinceCapture = lastCapture ? Math.floor((now - lastCapture) / 1000) : null

  function ago(sec) {
    if (sec === null) return '—'
    if (sec < 60) return `${sec}秒前`
    if (sec < 3600) return `${Math.floor(sec / 60)}分钟前`
    return `${Math.floor(sec / 3600)}小时前`
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-[2.5rem] p-6 lg:p-8"
    >
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-200">
            <Cpu weight="fill" className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-zinc-800 tracking-tight">硬件状态</h2>
            <p className="text-xs text-zinc-400">ESP32-S3 设备监控</p>
          </div>
        </div>
        <div className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold ${
          loading ? 'bg-zinc-100 text-zinc-400' :
          online ? 'bg-emerald-50 text-emerald-700' :
          'bg-zinc-100 text-zinc-500'
        }`}>
          <span className={`w-2.5 h-2.5 rounded-full ${
            loading ? 'bg-zinc-300' :
            online ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] status-dot-online' :
            'bg-zinc-300'
          }`} />
          {loading ? '检测中' : online ? '在线' : '离线'}
        </div>
      </div>

      {/* 状态卡片网格 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <div className="rounded-2xl bg-zinc-50 p-4 border border-zinc-100">
          <div className="flex items-center gap-2 mb-2">
            <WifiHigh weight="bold" className={`w-4 h-4 ${online ? 'text-emerald-500' : 'text-zinc-300'}`} />
            <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">连接</span>
          </div>
          <p className={`text-lg font-bold ${online ? 'text-emerald-600' : 'text-zinc-400'}`}>
            {online ? '已连接' : '未连接'}
          </p>
          <p className="text-xs text-zinc-400 mt-0.5">
            {online && status?.ip_address ? `IP ${status.ip_address}` : '等待设备接入'}
          </p>
        </div>

        <div className="rounded-2xl bg-zinc-50 p-4 border border-zinc-100">
          <div className="flex items-center gap-2 mb-2">
            <Camera weight="bold" className="w-4 h-4 text-indigo-400" />
            <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">采集</span>
          </div>
          <p className="text-lg font-bold text-zinc-800">{status?.capture_count ?? 0}</p>
          <p className="text-xs text-zinc-400 mt-0.5">累计拍照次数</p>
        </div>

        <div className="rounded-2xl bg-zinc-50 p-4 border border-zinc-100">
          <div className="flex items-center gap-2 mb-2">
            <ClockCounterClockwise weight="bold" className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">活跃</span>
          </div>
          <p className="text-lg font-bold text-zinc-800">{ago(secondsSinceCapture)}</p>
          <p className="text-xs text-zinc-400 mt-0.5 truncate">
            {lastCapture ? lastCapture.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '尚无数据'}
          </p>
        </div>

        <div className="rounded-2xl bg-zinc-50 p-4 border border-zinc-100">
          <div className="flex items-center gap-2 mb-2">
            <Info weight="bold" className="w-4 h-4 text-violet-400" />
            <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">固件</span>
          </div>
          <p className="text-lg font-bold text-zinc-800">{status?.firmware_version || '—'}</p>
          <p className="text-xs text-zinc-400 mt-0.5">{status?.device_id || 'ESP32-S3'}</p>
        </div>
      </div>

      {/* ====== Trigger config — collapsible ====== */}
      <div className="mb-5 rounded-2xl bg-zinc-50 border border-zinc-200">
        <button onClick={() => setTrigExpanded(e => !e)}
          className="w-full flex items-center justify-between p-5">
          <div className="flex items-center gap-2">
            <HandPointing weight="bold" className="w-5 h-5 text-amber-500" />
            <span className="text-base font-bold text-zinc-800">触发方式</span>
            {trigChanged() && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" title="未保存更改" />
            )}
          </div>
          <span className={`text-zinc-300 transition-transform ${trigExpanded ? '' : 'rotate-180'}`}>
            <CaretDown weight="bold" className="w-3.5 h-3.5" />
          </span>
        </button>

        <AnimatePresence>
          {trigExpanded && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden px-5 pb-5 space-y-4">

              <div className="flex rounded-xl bg-white border border-zinc-200 p-1">
                <button onClick={() => setTrigMode('button')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                    trigMode === 'button' ? 'bg-indigo-600 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}>
                  <HandPointing weight="bold" className="w-4 h-4" />
                  按键
                </button>
                <button onClick={() => setTrigMode('distance')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                    trigMode === 'distance' ? 'bg-indigo-600 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}>
                  <Ruler weight="bold" className="w-4 h-4" />
                  距离
                </button>
              </div>

              {trigMode === 'distance' && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                  <SliderField label="最小距离 (mm)" value={trigMin} min={0} max={1000} step={5} maxValidation={trigMax}
                    onChange={v => { if (v < trigMax) setTrigMin(v) }} />
                  <SliderField label="最大距离 (mm)" value={trigMax} min={10} max={2000} step={5} minValidation={trigMin}
                    onChange={v => { if (v > trigMin) setTrigMax(v) }} />
                  <SliderField label="缓冲 (ms)" value={trigCooldown} min={0} max={5000} step={100}
                    onChange={setTrigCooldown} />
                  <SliderField label="间隔 (秒)" value={Math.round(trigInterval / 1000)} min={1} max={60} step={1}
                    onChange={v => setTrigInterval(v * 1000)} />
                </motion.div>
              )}

              <div className="flex items-center gap-3 pt-2">
                <button onClick={handleTrigSave} disabled={trigSaving || !trigChanged()}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-all">
                  <Check weight="bold" className="w-3.5 h-3.5" />
                  {trigSaving ? '保存中...' : '保存'}
                </button>
                {trigMsg && (
                  <span className={`text-xs font-medium px-2 py-1 rounded-lg ${
                    trigMsg.startsWith('错误') ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'}`}>
                    {trigMsg}
                  </span>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ===== Camera controls — collapsible with save button ===== */}
      <CameraControls key={visible ? 'visible' : 'hidden'} onConfigChange={onConfigChange} />

      {/* 采集图像 — 大图展示 */}
      <div className="relative rounded-2xl overflow-hidden bg-zinc-100 aspect-video mb-3 border border-zinc-100">
        {online && !imgError ? (
          <img
            key={imgKey}
            src={`${imageUrl}?t=${imgKey}`}
            alt="硬件采集图像"
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-zinc-50 to-zinc-100">
            <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center shadow-sm">
              {online ? <ImageSquare weight="light" className="w-8 h-8 text-zinc-300" /> : <Cpu weight="light" className="w-8 h-8 text-zinc-300" />}
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-zinc-400">
                {online ? '等待新图像...' : '设备离线 — 等待 ESP32-S3 连接'}
              </p>
              <p className="text-xs text-zinc-300 mt-1">
                {online ? (trigMode === 'distance' ? '设备将自动检测距离触发采集' : '按下设备 BOOT 键触发采集') : '请检查设备电源与网络连接'}
              </p>
            </div>
          </div>
        )}
        {online && !imgError && (
          <div className="absolute top-3 left-3 px-3 py-1.5 rounded-full bg-black/40 backdrop-blur-sm text-white text-xs font-medium">
            最新采集
          </div>
        )}
      </div>

      {/* 底部提示 */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-indigo-50/50">
        <Lightning weight="fill" className="w-3.5 h-3.5 text-indigo-400" />
        <p className="text-xs text-indigo-500 font-medium">
          硬件状态每 6 秒自动刷新 · {trigMode === 'distance' ? 'TOF 距离自动触发 · ESP32 每 30 秒同步配置' : '按下设备 BOOT 键触发图像采集与识别'}
        </p>
      </div>
    </motion.div>
  )
})

function SliderField({ label, value, min, max, step, onChange, minValidation, maxValidation }) {
  const clampedOnChange = (v) => {
    if (maxValidation !== undefined && v > maxValidation) return
    if (minValidation !== undefined && v < minValidation) return
    onChange(v)
  }
  return (
    <div>
      <label className="text-sm font-semibold text-zinc-500 mb-1.5 block">{label}</label>
      <div className="flex items-center gap-3">
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={e => clampedOnChange(Number(e.target.value))}
          className="flex-1 h-2 rounded-full appearance-none bg-zinc-200 accent-indigo-500 cursor-pointer" />
        <input type="number" min={min} max={max} value={value}
          onChange={e => { const v = Number(e.target.value); if (v >= min && v <= max) clampedOnChange(v) }}
          className="w-20 px-3 py-1.5 rounded-lg border border-zinc-300 text-sm font-mono text-center focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400" />
      </div>
    </div>
  )
}

export default HardwarePanel
