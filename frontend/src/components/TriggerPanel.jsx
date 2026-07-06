import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Target, Camera, Trash, Leaf, Recycle, Warning,
  Lightning, ClockCounterClockwise, Check
} from '@phosphor-icons/react'

const WS_URL = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/video`

const CATEGORY_META = {
  recyclable: { icon: Recycle, label: '可回收物', color: 'text-sky-600', bg: 'bg-sky-50', border: 'border-sky-200' },
  kitchen:    { icon: Leaf,    label: '厨余垃圾', color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  hazardous:  { icon: Warning, label: '有害垃圾', color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' },
  other:      { icon: Trash,   label: '其他垃圾', color: 'text-zinc-600', bg: 'bg-zinc-100', border: 'border-zinc-300' },
}

export default function TriggerPanel() {
  const canvasRef = useRef(null)
  const wsRef = useRef(null)
  const reconnectTimer = useRef(null)

  const [wsConnected, setWsConnected] = useState(false)
  const [testCount, setTestCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [lastTestTime, setLastTestTime] = useState(null)

  // ── WebSocket live video ──
  useEffect(() => {
    let running = true

    function connect() {
      if (!running) return
      const ws = new WebSocket(WS_URL)
      ws.binaryType = 'blob'
      wsRef.current = ws

      ws.onopen = () => {
        if (!running) { ws.close(); return }
        setWsConnected(true)
      }

      ws.onmessage = (e) => {
        if (!running) return
        if (e.data instanceof Blob) {
          const reader = new FileReader()
          reader.onload = () => {
            if (!running) return
            const img = new Image()
            img.onload = () => {
              if (!running) return
              const canvas = canvasRef.current
              if (!canvas) return
              const ctx = canvas.getContext('2d')
              canvas.width = img.width
              canvas.height = img.height
              ctx.drawImage(img, 0, 0)
            }
            img.src = reader.result
          }
          reader.readAsDataURL(e.data)
        }
      }

      ws.onclose = () => {
        setWsConnected(false)
        if (!running) return
        reconnectTimer.current = setTimeout(connect, 2000)
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    connect()

    return () => {
      running = false
      clearTimeout(reconnectTimer.current)
      if (wsRef.current) wsRef.current.close()
    }
  }, [])

  // ── 拍照测试 ──
  const handleTest = useCallback(async () => {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch('/trigger/classify', { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || `请求失败 (${res.status})`)
      }
      const data = await res.json()
      if (data?.result) {
        setResult(data.result)
      }
      setTestCount(n => n + 1)
      setLastTestTime(Date.now())
    } catch (e) {
      setError(e.message || '未知错误')
    } finally {
      setLoading(false)
    }
  }, [])

  // ── 分类结果渲染 ──
  const catMeta = result?.waste_category ? CATEGORY_META[result.waste_category] || CATEGORY_META.other : null
  const pct = result?.confidence ? Math.round(result.confidence * 100) : 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-[2.5rem] p-6 lg:p-8"
    >
      {/* 标题 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-200">
            <Lightning weight="fill" className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-zinc-800 tracking-tight">按键测试</h2>
            <p className="text-xs text-zinc-400">手动触发拍照识别 · 测试分类效果</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* 连接状态 */}
          <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${
            wsConnected ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-400'
          }`}>
            <span className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-emerald-500' : 'bg-zinc-300'}`} />
            {wsConnected ? '画面在线' : '重连中...'}
          </span>
          <span className="px-3 py-1.5 rounded-full bg-indigo-50 text-indigo-700 text-xs font-semibold">
            测试 {testCount} 次
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── 左侧：实时画面 + 触发按钮 ── */}
        <div className="space-y-4">
          {/* 摄像头实时画面 */}
          <div className="relative rounded-2xl overflow-hidden bg-zinc-900 aspect-[4/3] border border-zinc-200">
            {wsConnected ? (
              <canvas ref={canvasRef} className="w-full h-full object-contain" />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-900">
                <Camera weight="light" className="w-12 h-12 text-zinc-600" />
                <p className="text-sm text-zinc-500">等待视频流...</p>
              </div>
            )}
            <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-black/50 text-white/80 text-[10px] font-medium backdrop-blur-sm">
              实时预览
            </div>
          </div>

          {/* 拍照测试按钮 */}
          <button
            onClick={handleTest}
            disabled={loading}
            className="relative w-full py-5 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 text-white font-bold text-lg shadow-lg shadow-amber-200/50 transition-all hover:shadow-xl hover:shadow-amber-300/50 active:scale-[0.98] disabled:opacity-60 disabled:cursor-wait overflow-hidden group"
          >
            {/* 脉冲动画 */}
            {loading && (
              <motion.div
                className="absolute inset-0 bg-white/20"
                animate={{ opacity: [0, 0.3, 0] }}
                transition={{ duration: 1, repeat: Infinity }}
              />
            )}
            <div className="flex items-center justify-center gap-3">
              {loading ? (
                <>
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  >
                    <Camera weight="bold" className="w-6 h-6" />
                  </motion.div>
                  <span>识别中...</span>
                </>
              ) : (
                <>
                  <Target weight="fill" className="w-6 h-6" />
                  <span>测试拍照识别</span>
                </>
              )}
            </div>
          </button>

          {/* 按键反馈 */}
          {lastTestTime && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-50 border border-zinc-100">
              <ClockCounterClockwise weight="bold" className="w-4 h-4 text-zinc-400" />
              <span className="text-xs text-zinc-500">
                上次触发：{new Date(lastTestTime).toLocaleTimeString('zh-CN')}
              </span>
            </div>
          )}
        </div>

        {/* ── 右侧：分类结果 ── */}
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-zinc-500 uppercase tracking-wider">分类结果</h3>

          {loading && (
            <div className="rounded-2xl bg-zinc-50 border border-zinc-200 p-8">
              <div className="flex flex-col items-center gap-4">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                >
                  <Camera weight="bold" className="w-8 h-8 text-zinc-300" />
                </motion.div>
                <p className="text-sm text-zinc-400">正在识别...</p>
              </div>
            </div>
          )}

          {error && (
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="rounded-2xl bg-red-50 border border-red-200 p-6 text-center"
            >
              <p className="text-sm font-semibold text-red-600">识别失败</p>
              <p className="text-xs text-red-500 mt-1">{error}</p>
            </motion.div>
          )}

          {result && catMeta && !loading && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              {/* 分类卡片 */}
              <div className={`rounded-2xl ${catMeta.bg} border ${catMeta.border} p-6 text-center`}>
                <div className="flex justify-center mb-2">
                  <catMeta.icon weight="fill" className={`w-10 h-10 ${catMeta.color}`} />
                </div>
                <p className={`text-2xl font-black ${catMeta.color}`}>{catMeta.label}</p>
                <p className="text-sm text-zinc-400 mt-1">{result.waste_category_zh}</p>
              </div>

              {/* 置信度 */}
              <div className="rounded-2xl bg-zinc-50 border border-zinc-200 p-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-zinc-500">置信度</span>
                  <span className={`text-lg font-bold ${
                    pct >= 80 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-red-600'
                  }`}>{pct}%</span>
                </div>
                <div className="h-2.5 rounded-full bg-zinc-200 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
                    className={`h-full rounded-full ${
                      pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500'
                    }`}
                  />
                </div>
              </div>

              {/* 物品信息 */}
              <div className="rounded-2xl bg-zinc-50 border border-zinc-200 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-400">物品</span>
                  <span className="text-sm font-bold text-zinc-700">{result.item_label_zh || '未知'}</span>
                </div>
                {result.model_used && (
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-zinc-200">
                    <span className="text-sm text-zinc-400">模型</span>
                    <span className="text-xs font-mono text-zinc-500">{result.model_used}</span>
                  </div>
                )}
              </div>

              {/* Top 3 */}
              {result.top3 && result.top3.length > 1 && (
                <div className="rounded-2xl bg-zinc-50 border border-zinc-200 p-4">
                  <p className="text-xs font-semibold text-zinc-400 mb-2">候选 Top 3</p>
                  <div className="space-y-1.5">
                    {result.top3.slice(0, 3).map((item, i) => {
                      const ipct = Math.round((item.confidence || 0) * 100)
                      return (
                        <div key={i} className="flex items-center gap-3">
                          <span className="w-5 h-5 rounded-full bg-zinc-200 flex items-center justify-center text-[10px] font-bold text-zinc-500 flex-shrink-0">
                            {i + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-zinc-700 truncate">{item.item_label_zh || item.item_label}</span>
                              <span className="text-[11px] font-mono text-zinc-400">{ipct}%</span>
                            </div>
                            <div className="h-1 rounded-full bg-zinc-200 mt-0.5 overflow-hidden">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${ipct}%` }}
                                transition={{ duration: 0.5, delay: i * 0.08 }}
                                className="h-full rounded-full bg-zinc-400"
                              />
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* 识别成功落款 */}
              <div className="flex items-center justify-center gap-1.5 text-xs text-zinc-400">
                <Check weight="bold" className="w-3.5 h-3.5 text-emerald-500" />
                <span>识别完成</span>
              </div>
            </motion.div>
          )}

          {/* 空状态 */}
          {!result && !loading && !error && (
            <div className="rounded-2xl bg-zinc-50 border border-zinc-200 p-8 flex flex-col items-center justify-center text-center min-h-[200px]">
              <Target weight="light" className="w-12 h-12 text-zinc-300 mb-3" />
              <p className="text-sm font-medium text-zinc-400">点击左侧按钮开始测试</p>
              <p className="text-xs text-zinc-300 mt-1">每次测试将拍照并返回识别结果</p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}
