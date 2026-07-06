import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Timer } from '@phosphor-icons/react'
import { getHardwareImageUrl } from '../api'

const WASTE_CATEGORY_STYLES = {
  recyclable: { gradient: 'from-sky-500 to-blue-600', dot: 'bg-sky-400', label: '可回收物', ring: 'shadow-sky-500/20' },
  kitchen:    { gradient: 'from-emerald-500 to-teal-600', dot: 'bg-emerald-400', label: '厨余垃圾', ring: 'shadow-emerald-500/20' },
  hazardous:  { gradient: 'from-red-500 to-rose-600', dot: 'bg-red-400', label: '有害垃圾', ring: 'shadow-red-500/20' },
  other:      { gradient: 'from-zinc-500 to-zinc-700', dot: 'bg-zinc-400', label: '其他垃圾', ring: 'shadow-zinc-500/20' },
}

export default function ResultOverlay({ result, categoryConfig, onDismiss, imageKey }) {
  const [visible, setVisible] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [progress, setProgress] = useState(100)

  // Auto-show on new result
  useEffect(() => {
    if (result) {
      setVisible(true)
      setDismissed(false)
      setProgress(100)
    }
  }, [result])

  // Auto-dismiss after 12 seconds with countdown
  useEffect(() => {
    if (!visible || dismissed || !result) return

    const duration = 12000
    const interval = 50
    const step = (interval / duration) * 100

    const timer = setInterval(() => {
      setProgress(prev => {
        const next = prev - step
        if (next <= 0) {
          clearInterval(timer)
          return 0
        }
        return next
      })
    }, interval)

    const dismissTimer = setTimeout(() => {
      setDismissed(true)
      setTimeout(() => {
        setVisible(false)
        onDismiss()
      }, 300)
    }, duration)

    return () => {
      clearInterval(timer)
      clearTimeout(dismissTimer)
    }
  }, [visible, dismissed, result, onDismiss])

  const handleDismiss = useCallback(() => {
    setDismissed(true)
    setTimeout(() => {
      setVisible(false)
      onDismiss()
    }, 300)
  }, [onDismiss])

  if (!result) return null

  const { item_label_zh, waste_category, waste_category_zh, confidence, top3, model_used } = result
  const style = WASTE_CATEGORY_STYLES[waste_category] || WASTE_CATEGORY_STYLES.other
  const pct = Math.round(confidence * 100)
  const imageUrl = getHardwareImageUrl()

  // Top 3 简短列表
  const top3Items = (top3 || []).slice(0, 3)

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -20, scale: 0.97 }}
          animate={{
            opacity: 1, y: 0, scale: 1,
            ...(dismissed ? { opacity: 0, y: -10, scale: 0.97 } : {})
          }}
          exit={{ opacity: 0, y: -10, scale: 0.97 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="absolute top-0 left-0 right-0 z-50 mx-6 mt-6"
        >
          <div className="relative bg-white rounded-[2rem] shadow-[0_8px_40px_-12px_rgba(0,0,0,0.15)] border border-zinc-100 overflow-hidden">
            {/* 自动消失进度条 */}
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-zinc-100">
              <motion.div
                className={`h-full bg-gradient-to-r ${style.gradient}`}
                style={{ width: `${progress}%` }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.05, ease: 'linear' }}
              />
            </div>

            {/* 关闭按钮 */}
            <button
              onClick={handleDismiss}
              className="absolute top-3 right-3 z-10 w-7 h-7 rounded-full bg-zinc-100 flex items-center justify-center spring-transition hover:bg-zinc-200 active:scale-90"
            >
              <X weight="bold" className="w-3.5 h-3.5 text-zinc-500" />
            </button>

            <div className="p-4 flex gap-4">
              {/* 左侧缩略图 */}
              <div className="w-24 h-24 rounded-2xl overflow-hidden bg-zinc-100 flex-shrink-0 border border-zinc-200">
                <img
                  key={imageKey}
                  src={`${imageUrl}?t=${imageKey}`}
                  alt=""
                  className="w-full h-full object-cover"
                />
              </div>

              {/* 右侧内容 */}
              <div className="flex-1 min-w-0 flex flex-col justify-center">
                {/* 分类标签 */}
                <div className="flex items-center gap-2 mb-1">
                  <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold text-white bg-gradient-to-r ${style.gradient}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${style.dot} opacity-80`} />
                    {waste_category_zh}
                  </span>
                  <span className="text-[11px] font-mono text-zinc-400">{model_used || 'CLIP'}</span>
                </div>

                {/* 物品名称 */}
                <h3 className="text-xl font-bold text-zinc-900 tracking-tight truncate">
                  {item_label_zh}
                </h3>

                {/* 置信度条 + Top3 */}
                <div className="flex items-center gap-3 mt-1.5">
                  <div className="flex-1 flex items-center gap-2">
                    <div className="flex-1 h-2 rounded-full bg-zinc-100 overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ delay: 0.15, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                        className={`h-full rounded-full bg-gradient-to-r ${style.gradient}`}
                      />
                    </div>
                    <span className={`text-sm font-bold ${pct >= 80 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                      {pct}%
                    </span>
                  </div>
                </div>

                {/* Top 3 迷你条 */}
                {top3Items.length > 1 && (
                  <div className="flex items-center gap-2 mt-1.5 text-[11px] text-zinc-400">
                    {top3Items.map((item, i) => (
                      <span key={i} className="flex items-center gap-1">
                        <span className="font-mono">{i + 1}.</span>
                        <span className="truncate max-w-[60px]">{item.item_label_zh}</span>
                        <span className="text-zinc-300">·</span>
                        <span className="font-mono">{Math.round(item.confidence * 100)}%</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 底部提示 */}
            <div className="px-4 pb-3 -mt-1 flex items-center justify-between">
              <p className="text-[11px] text-zinc-400">
                自动识别结果 · 滑动/点击查看详情
              </p>
              <div className="flex items-center gap-1 text-[10px] text-zinc-300">
                <Timer weight="bold" className="w-2.5 h-2.5" />
                <span>自动关闭</span>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
