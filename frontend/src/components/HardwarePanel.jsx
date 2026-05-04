import { useState, useCallback, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Cpu, Camera, ClockCounterClockwise, WifiHigh, WifiX, ImageSquare, Info, Microscope, Lightning, Circle, Tray } from '@phosphor-icons/react'
import { getHardwareStatus, getHardwareImageUrl } from '../api'
import usePolling from '../hooks/usePolling'

export default function HardwarePanel() {
  const [imgKey, setImgKey] = useState(0)
  const prevCaptureCount = useRef(null)
  const [imgError, setImgError] = useState(false)

  const fetchStatus = useCallback(() => getHardwareStatus(), [])
  const { data: status, loading } = usePolling(fetchStatus, { interval: 6000 })

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
        {/* 连接状态 */}
        <div className="rounded-2xl bg-zinc-50 p-4 border border-zinc-100">
          <div className="flex items-center gap-2 mb-2">
            <WifiHigh weight="bold" className={`w-4 h-4 ${online ? 'text-emerald-500' : 'text-zinc-300'}`} />
            <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">连接</span>
          </div>
          <p className={`text-lg font-bold ${online ? 'text-emerald-600' : 'text-zinc-400'}`}>
            {online ? '已连接' : '未连接'}
          </p>
          <p className="text-[10px] text-zinc-400 mt-0.5">
            {online && status?.ip_address ? `IP ${status.ip_address}` : '等待设备接入'}
          </p>
        </div>

        {/* 采集次数 */}
        <div className="rounded-2xl bg-zinc-50 p-4 border border-zinc-100">
          <div className="flex items-center gap-2 mb-2">
            <Camera weight="bold" className="w-4 h-4 text-indigo-400" />
            <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">采集</span>
          </div>
          <p className="text-lg font-bold text-zinc-800">{status?.capture_count ?? 0}</p>
          <p className="text-[10px] text-zinc-400 mt-0.5">累计拍照次数</p>
        </div>

        {/* 最后活跃 */}
        <div className="rounded-2xl bg-zinc-50 p-4 border border-zinc-100">
          <div className="flex items-center gap-2 mb-2">
            <ClockCounterClockwise weight="bold" className="w-4 h-4 text-amber-400" />
            <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">活跃</span>
          </div>
          <p className="text-lg font-bold text-zinc-800">{ago(secondsSinceCapture)}</p>
          <p className="text-[10px] text-zinc-400 mt-0.5 truncate">
            {lastCapture ? lastCapture.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '尚无数据'}
          </p>
        </div>

        {/* 固件版本 */}
        <div className="rounded-2xl bg-zinc-50 p-4 border border-zinc-100">
          <div className="flex items-center gap-2 mb-2">
            <Info weight="bold" className="w-4 h-4 text-violet-400" />
            <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">固件</span>
          </div>
          <p className="text-lg font-bold text-zinc-800">{status?.firmware_version || '—'}</p>
          <p className="text-[10px] text-zinc-400 mt-0.5">{status?.device_id || 'ESP32-S3'}</p>
        </div>
      </div>

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
              <p className="text-[10px] text-zinc-300 mt-1">
                {online ? '按下设备 BOOT 键触发采集' : '请检查设备电源与网络连接'}
              </p>
            </div>
          </div>
        )}
        {/* 图像标签 */}
        {online && !imgError && (
          <div className="absolute top-3 left-3 px-3 py-1.5 rounded-full bg-black/40 backdrop-blur-sm text-white text-[11px] font-medium">
            最新采集
          </div>
        )}
      </div>

      {/* 底部提示 */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-indigo-50/50">
        <Lightning weight="fill" className="w-3.5 h-3.5 text-indigo-400" />
        <p className="text-[11px] text-indigo-500 font-medium">
          硬件状态每 6 秒自动刷新 · 按下设备 BOOT 键触发图像采集与识别
        </p>
      </div>
    </motion.div>
  )
}
