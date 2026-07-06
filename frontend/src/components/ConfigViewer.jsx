import { memo, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Code, CopySimple, Check, ArrowsClockwise } from '@phosphor-icons/react'
import { getAllConfig } from '../api'

const ConfigViewer = memo(function ConfigViewer() {
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState('')

  const fetchConfig = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const res = await getAllConfig()
      setConfig(res)
    } catch (e) {
      setErr(e.message || '获取配置失败')
    }
    setLoading(false)
  }, [])

  const handleToggle = useCallback(() => {
    if (!expanded && !config) fetchConfig()
    setExpanded(prev => !prev)
  }, [expanded, config, fetchConfig])

  const handleRefresh = useCallback(() => {
    fetchConfig()
  }, [fetchConfig])

  const handleCopy = useCallback(() => {
    if (!config) return
    navigator.clipboard.writeText(JSON.stringify(config, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [config])

  return (
    <div className="rounded-xl bg-zinc-50 border border-zinc-200 p-4">
      <button onClick={handleToggle}
        className="w-full flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Code weight="bold" className="w-4 h-4 text-zinc-500" />
          <span className="text-sm font-bold text-zinc-800">配置参数总览</span>
        </div>
        <span className={`text-xs font-medium text-zinc-400 transition-transform ${expanded ? 'rotate-180' : ''}`}>
          ▼
        </span>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden">
            <div className="mt-3 flex items-center gap-2">
              <button onClick={handleRefresh} disabled={loading}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50">
                <ArrowsClockwise weight="bold" className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                {loading ? '加载中' : '刷新'}
              </button>
              {config && (
                <button onClick={handleCopy}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-zinc-200 text-xs font-semibold text-zinc-500 hover:bg-white spring-transition">
                  {copied ? <Check weight="bold" className="w-3 h-3 text-emerald-500" /> : <CopySimple weight="bold" className="w-3 h-3" />}
                  {copied ? '已复制' : '复制JSON'}
                </button>
              )}
            </div>

            {loading && !config && (
              <div className="mt-3 flex items-center justify-center py-8 text-xs text-zinc-400">
                <div className="flex items-center gap-2">
                  <ArrowsClockwise weight="bold" className="w-3 h-3 animate-spin" />
                  加载配置中...
                </div>
              </div>
            )}

            {err && (
              <div className="mt-2 text-xs font-medium px-2 py-1 rounded-lg bg-red-50 text-red-500">{err}</div>
            )}

            {config && (
              <div className="mt-3 max-h-[400px] overflow-auto rounded-lg bg-zinc-900 text-xs font-mono">
                <div className="p-3 border-b border-zinc-700">
                  <div className="text-xs font-semibold text-emerald-400 mb-1.5">// 可修改参数 (Modifiable)</div>
                  <pre className="text-zinc-200 whitespace-pre-wrap break-all">
                    {JSON.stringify(config.modifiable, null, 2)}
                  </pre>
                </div>
                <div className="p-3">
                  <div className="text-xs font-semibold text-blue-400 mb-1.5">// 只读参数 (Read-Only)</div>
                  <pre className="text-zinc-300 whitespace-pre-wrap break-all">
                    {JSON.stringify(config.read_only, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})

export default ConfigViewer
