import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ClockCounterClockwise, CaretDown, CaretUp, ImageSquare, Trash } from '@phosphor-icons/react'
import { getHistory, clearHistory } from '../api'

const FILTER_OPTIONS = [
  { key: 'all', label: '全部' },
  { key: 'classify', label: '分类' },
  { key: 'detect', label: 'YOLO' },
  { key: 'hardware', label: '硬件' }
]

export default function HistoryList({ categoryConfig, refreshKey }) {
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)

  const fetchHistory = useCallback(async () => {
    try {
      setLoading(true)
      const data = await getHistory(1, 100)
      setItems(data.items || [])
      setTotal(data.total || 0)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchHistory()
  }, [fetchHistory, refreshKey])

  const handleClear = async () => {
    try {
      await clearHistory()
      setItems([])
      setTotal(0)
    } catch { /* silent */ }
  }

  const filtered = filter === 'all' ? items : items.filter(i => i.mode === filter)
  const visible = expanded ? filtered : filtered.slice(0, 6)

  return (
    <div>
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-zinc-100 flex items-center justify-center">
            <ClockCounterClockwise weight="bold" className="w-5 h-5 text-zinc-500" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-zinc-800 tracking-tight">历史记录</h2>
            <p className="text-[11px] text-zinc-400">{total} 条记录</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* 筛选 */}
          <div className="flex rounded-lg bg-zinc-100 p-0.5">
            {FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setFilter(opt.key)}
                className={`px-3 py-1.5 rounded-md text-[11px] font-semibold spring-transition ${
                  filter === opt.key ? 'bg-white text-zinc-800 shadow-sm' : 'text-zinc-400 hover:text-zinc-600'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {total > 0 && (
            <button
              onClick={handleClear}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-zinc-400 hover:text-red-500 hover:bg-red-50 spring-transition"
            >
              <Trash weight="bold" className="w-3 h-3" />
              清空
            </button>
          )}
          {filtered.length > 6 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-[11px] font-semibold text-zinc-400 hover:text-zinc-600 spring-transition"
            >
              {expanded ? '收起' : `全部 (${filtered.length})`}
              {expanded ? <CaretUp weight="bold" className="w-3 h-3" /> : <CaretDown weight="bold" className="w-3 h-3" />}
            </button>
          )}
        </div>
      </div>

      {/* 内容 */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-2xl bg-white border border-zinc-100 overflow-hidden">
              <div className="aspect-[4/3] skeleton" />
              <div className="p-3 space-y-2">
                <div className="skeleton rounded-lg h-3 w-2/3" />
                <div className="skeleton rounded-lg h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <div className="w-14 h-14 rounded-2xl bg-zinc-100 flex items-center justify-center">
            <ClockCounterClockwise weight="light" className="w-7 h-7 text-zinc-300" />
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-500">暂无记录</p>
            <p className="text-xs text-zinc-400 mt-1">上传图片或通过 ESP32 采集图像后，记录将显示在此处</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          <AnimatePresence>
            {visible.map((entry, i) => {
              const isClassify = entry.mode === 'classify'
              const isHardware = entry.mode === 'hardware'
              const itemZh = isClassify
                ? entry.data?.item_label_zh
                : entry.data?.item_label || (isHardware ? '硬件采集' : '未知')
              const catKey = isClassify ? entry.data?.waste_category : null
              const cat = catKey ? (categoryConfig[catKey] || categoryConfig.other) : null
              const time = new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
              const pct = entry.data?.confidence !== undefined ? Math.round(entry.data.confidence * 100) : null

              return (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ delay: Math.min(i * 0.03, 0.2) }}
                  className="group relative rounded-2xl bg-white border border-zinc-100 overflow-hidden spring-transition hover:border-zinc-200 hover:shadow-[0_4px_24px_-12px_rgba(0,0,0,0.06)]"
                >
                  <div className="aspect-[4/3] bg-zinc-50 flex items-center justify-center overflow-hidden">
                    {entry.imageUrl ? (
                      <img src={entry.imageUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <ImageSquare weight="light" className="w-8 h-8 text-zinc-300" />
                    )}
                  </div>
                  <div className="p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-zinc-800 truncate">{itemZh}</span>
                      <span className="text-[10px] text-zinc-400 font-mono shrink-0">{time}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">
                        {entry.mode === 'hardware' ? '硬件' : entry.mode === 'detect' ? 'YOLO' : (() => {
                          const mu = entry.data?.model_used || 'CLIP'
                          return mu === 'clip (fallback)' ? 'CLIP' : mu
                        })()}
                      </span>
                      {cat && (
                        <span className={`text-[10px] font-semibold ${cat.text}`}>{cat.labelZh}</span>
                      )}
                      {pct !== null && (
                        <span className="text-[10px] text-zinc-300 ml-auto">{pct}%</span>
                      )}
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
