import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CaretUp, CaretDown, CheckCircle, Info, Target, ChartBar, BookOpen, Timer } from '@phosphor-icons/react'
import ConfidenceGauge from './ConfidenceGauge'

const barColors = ['bg-indigo-500', 'bg-indigo-300', 'bg-zinc-300']

const CATEGORY_INFO = {
  recyclable: '可回收物包括废纸、塑料、玻璃、金属和布料五大类。投放时应保持清洁干燥，避免污染，方便后续回收加工。',
  kitchen: '厨余垃圾包括剩菜剩饭、果皮、菜叶、骨头等易腐烂的生物质废弃物。投放前应沥干水分，去除包装袋。',
  hazardous: '有害垃圾包括废电池、废灯管、废药品、废油漆等对人体健康或自然环境造成直接或潜在危害的物质。需单独投放至有害垃圾收集容器。',
  other: '其他垃圾指除可回收物、厨余垃圾、有害垃圾之外的其他生活垃圾，如餐巾纸、一次性餐具、灰土等。'
}

export default function ResultsDisplay({ result, categoryConfig }) {
  const isClassify = result.result && result.result.top3 !== undefined
  const isDetect = result.result && result.result.detections !== undefined

  if (isClassify) return <ClassifyResult result={result} categoryConfig={categoryConfig} />
  if (isDetect) return <DetectResult result={result} categoryConfig={categoryConfig} />
  return null
}

function ClassifyResult({ result, categoryConfig }) {
  const { item_label_zh, waste_category, waste_category_zh, confidence, top3, tip, response_time_ms, model_used } = result.result
  const cat = categoryConfig[waste_category] || categoryConfig.other
  const Icon = cat.icon
  const [showInfo, setShowInfo] = useState(false)

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* 结果判定 */}
      <div className="glass-card rounded-[2.5rem] p-6 lg:p-8">
        <div className="flex items-center gap-2 mb-4">
          <Target weight="bold" className="w-4 h-4 text-zinc-400" />
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">结果判定</span>
        </div>
        <div className="flex items-center justify-between">
          <div className={`inline-flex items-center gap-3 px-5 py-3 rounded-2xl bg-gradient-to-r ${cat.gradient} text-white shadow-lg`}>
            <Icon weight="fill" className="w-6 h-6" />
            <span className="text-base font-bold">{waste_category_zh}</span>
          </div>
          <motion.span
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            className="text-xs text-zinc-400 font-mono"
          >
            置信度 {(confidence * 100).toFixed(1)}%
          </motion.span>
        </div>
        {(response_time_ms !== undefined || model_used) && (
          <div className="flex items-center gap-4 mt-3 text-[10px] text-zinc-400">
            {response_time_ms !== undefined && (
              <span className="flex items-center gap-1">
                <Timer weight="bold" className="w-3 h-3" />
                {response_time_ms}ms
              </span>
            )}
            {model_used && (
              <span className="font-mono">{model_used}</span>
            )}
          </div>
        )}
      </div>

      {/* 置信度分析 */}
      <div className="glass-card rounded-[2.5rem] p-6 lg:p-8">
        <div className="flex items-center gap-2 mb-4">
          <ChartBar weight="bold" className="w-4 h-4 text-zinc-400" />
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">置信度分析</span>
        </div>

        <div className="flex items-start gap-6">
          <ConfidenceGauge confidence={confidence} size="lg" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-zinc-400 mb-1">识别结果</p>
            <h2 className="text-2xl lg:text-3xl font-bold tracking-tight text-zinc-900">
              {item_label_zh}
            </h2>
            <p className="mt-2 text-sm text-zinc-500">{tip}</p>

            <div className="mt-4">
              <div className="flex items-end gap-1 h-8 rounded-xl overflow-hidden bg-zinc-100">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${confidence * 100}%` }}
                  transition={{ delay: 0.2, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                  className={`h-full rounded-xl bg-gradient-to-r ${cat.gradient}`}
                />
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[10px] text-zinc-400">0%</span>
                <span className="text-[10px] text-zinc-400">100%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Top 3 */}
        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400 mb-3">前三预测</p>
          <div className="space-y-2">
            {top3.map((item, i) => {
              const itemCat = categoryConfig[item.waste_category] || categoryConfig.other
              const ItemIcon = itemCat.icon
              const pct = Math.round(item.confidence * 100)
              return (
                <motion.div
                  key={item.item_label}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + i * 0.08 }}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl ${i === 0 ? 'bg-zinc-50' : ''}`}
                >
                  <span className="text-xs font-mono text-zinc-400 w-5">{i + 1}</span>
                  <span className="flex-1 text-sm font-medium text-zinc-800">{item.item_label_zh}</span>
                  <span className={`inline-flex items-center gap-1 text-xs font-medium ${itemCat.text}`}>
                    <ItemIcon weight="fill" className="w-3 h-3" />
                    {item.waste_category_zh}
                  </span>
                  <span className="text-xs font-mono text-zinc-400 w-12 text-right">{pct}%</span>
                  <div className="w-12 h-1.5 rounded-full bg-zinc-100 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ delay: 0.5 + i * 0.1, duration: 0.5 }}
                      className={`h-full rounded-full ${barColors[i]}`}
                    />
                  </div>
                </motion.div>
              )
            })}
          </div>
        </div>
      </div>

      {/* 分类说明 */}
      <div className="glass-card rounded-[2.5rem] p-6 lg:p-8">
        <button
          onClick={() => setShowInfo(!showInfo)}
          className="flex items-center justify-between w-full text-left"
        >
          <div className="flex items-center gap-2">
            <BookOpen weight="bold" className="w-4 h-4 text-zinc-400" />
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">
              关于{waste_category_zh}
            </span>
          </div>
          {showInfo ? <CaretUp weight="bold" className="w-4 h-4 text-zinc-400" /> : <CaretDown weight="bold" className="w-4 h-4 text-zinc-400" />}
        </button>
        <AnimatePresence>
          {showInfo && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden text-sm text-zinc-500 leading-relaxed mt-3"
            >
              {CATEGORY_INFO[waste_category] || CATEGORY_INFO.other}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

function DetectResult({ result, categoryConfig }) {
  const { count, detections, item_label, confidence } = result.result

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* 结果判定 */}
      <div className="glass-card rounded-[2.5rem] p-6 lg:p-8">
        <div className="flex items-center gap-2 mb-4">
          <Target weight="bold" className="w-4 h-4 text-zinc-400" />
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">结果判定</span>
        </div>
        <div className="flex items-center justify-between">
          <div className="inline-flex items-center gap-3 px-5 py-3 rounded-2xl bg-gradient-to-r from-zinc-700 to-zinc-900 text-white shadow-lg">
            <CheckCircle weight="fill" className="w-6 h-6 text-emerald-400" />
            <span className="text-base font-bold">检测到 {count} 个目标</span>
          </div>
          <span className="text-xs text-zinc-400 font-mono">
            最高置信度 {(confidence * 100).toFixed(1)}%
          </span>
        </div>
      </div>

      {/* 检测详情 */}
      <div className="glass-card rounded-[2.5rem] p-6 lg:p-8">
        <div className="flex items-center gap-2 mb-4">
          <ChartBar weight="bold" className="w-4 h-4 text-zinc-400" />
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">检测详情</span>
        </div>
        <div className="flex items-start gap-6">
          <ConfidenceGauge confidence={confidence} size="lg" />
          <div className="flex-1">
            <h2 className="text-2xl lg:text-3xl font-bold tracking-tight text-zinc-900 mb-4 capitalize">
              {item_label}
            </h2>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400 mb-3">全部检测结果</p>
            <div className="space-y-2 max-h-[240px] overflow-y-auto">
              {detections.map((d, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl bg-zinc-50"
                >
                  <span className="text-xs font-mono text-zinc-400 w-5">{i + 1}</span>
                  <span className="flex-1 text-sm font-medium text-zinc-800 capitalize">{d.class_name}</span>
                  <span className="text-xs font-mono text-zinc-400">
                    {(d.confidence * 100).toFixed(1)}%
                  </span>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
