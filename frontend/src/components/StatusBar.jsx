import { useCallback } from 'react'
import { motion } from 'framer-motion'
import { CloudCheck, CloudX, CloudSlash, Cpu, WifiHigh, WifiX, ClockCounterClockwise } from '@phosphor-icons/react'
import { checkHealth } from '../api'
import usePolling from '../hooks/usePolling'

export default function StatusBar() {
  const fetchHealth = useCallback(() => checkHealth(), [])
  const { data: health, loading } = usePolling(fetchHealth, { interval: 10000 })

  const serverOnline = health?.status === 'healthy'
  const hardwareOnline = health?.hardware_online
  const latency = health?.latency
  const uptime = health?.uptime_seconds
  const captures = health?.hardware_captures || 0
  const labelCount = health?.clip_labels || 0

  const ServerIcon = loading ? CloudSlash : serverOnline ? CloudCheck : CloudX
  const HwIcon = hardwareOnline ? WifiHigh : WifiX

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-2.5 flex-wrap"
    >
      {/* 后端服务 */}
      <div className={`flex items-center gap-2 px-3.5 py-2 rounded-full text-[12px] font-semibold spring-transition ${
        loading ? 'bg-zinc-100 text-zinc-400' :
        serverOnline ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-red-50 text-red-600 border border-red-100'
      }`}>
        <ServerIcon weight="bold" className="w-4 h-4" />
        <span>{loading ? '检测服务...' : serverOnline ? `服务在线 · ${latency ?? '—'}ms` : '服务离线'}</span>
      </div>

      {/* 硬件状态 */}
      <div className={`flex items-center gap-2 px-3.5 py-2 rounded-full text-[12px] font-semibold spring-transition ${
        loading ? 'bg-zinc-100 text-zinc-400' :
        hardwareOnline ? 'bg-indigo-50 text-indigo-700 border border-indigo-100' : 'bg-zinc-100 text-zinc-500 border border-zinc-200'
      }`}>
        <span className={`w-2 h-2 rounded-full ${
          loading ? 'bg-zinc-300' :
          hardwareOnline ? 'bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.4)] status-dot-online' :
          'bg-zinc-300'
        }`} />
        <Cpu weight="bold" className="w-3.5 h-3.5" />
        <span>{loading ? '检测硬件...' : hardwareOnline ? `硬件在线 · ${captures} 次采集` : '硬件离线'}</span>
      </div>

      {/* 服务运行时间 */}
      {serverOnline && uptime && (
        <div className="flex items-center gap-2 px-3.5 py-2 rounded-full text-[12px] font-semibold bg-zinc-100 text-zinc-500 border border-zinc-200">
          <ClockCounterClockwise weight="bold" className="w-3.5 h-3.5" />
          <span>运行 {formatUptime(uptime)}</span>
        </div>
      )}

      {/* 标签数量 */}
      <div className="flex items-center gap-2 px-3.5 py-2 rounded-full text-[12px] font-semibold bg-zinc-100 text-zinc-500 border border-zinc-200">
        <span className="w-2 h-2 rounded-full bg-amber-400" />
        <span>{labelCount} 个物品标签</span>
      </div>
    </motion.div>
  )
}

function formatUptime(sec) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h}小时${m}分钟`
  if (m > 0) return `${m}分钟`
  return `${Math.floor(sec)}秒`
}
