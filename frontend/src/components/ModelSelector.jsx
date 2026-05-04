import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Scan, ImageSquare, Flask, CheckCircle, Info } from '@phosphor-icons/react'
import { getModels } from '../api'

const modeMeta = {
  classify: {
    icon: Scan,
    name: 'CLIP 分类',
    short: '零样本图像分类 — 识别物品并映射到垃圾分类',
    gradient: 'from-violet-500 to-purple-600'
  },
  detect: {
    icon: ImageSquare,
    name: 'YOLO 检测',
    short: '目标检测 — 定位并识别图像中的物体及边界框',
    gradient: 'from-sky-500 to-blue-600'
  }
}

export default function ModelSelector({ mode, setMode, disabled }) {
  const [models, setModels] = useState(null)

  useEffect(() => {
    getModels()
      .then(data => setModels(data.models))
      .catch(() => {})
  }, [])

  const currentModel = models?.find(m => m.id === mode)
  const otherModel = models?.find(m => m.id !== mode)

  return (
    <div className="glass-card rounded-[2.5rem] p-6 lg:p-8">
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-200">
            <Flask weight="fill" className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-zinc-800 tracking-tight">模型状态</h2>
            <p className="text-xs text-zinc-400">AI 识别引擎监控</p>
          </div>
        </div>
        {/* 当前模式标签 */}
        <div className={`px-4 py-2 rounded-full text-sm font-semibold bg-gradient-to-r ${modeMeta[mode].gradient} text-white shadow-md`}>
          {modeMeta[mode].name}
        </div>
      </div>

      {/* 模式切换 */}
      <div className="flex rounded-2xl bg-zinc-100 p-1.5 mb-5">
        {['classify', 'detect'].map((m) => {
          const mmeta = modeMeta[m]
          const MIcon = mmeta.icon
          const isActive = mode === m
          return (
            <button
              key={m}
              onClick={() => setMode(m)}
              disabled={disabled}
              className={`relative flex-1 px-5 py-3 rounded-xl text-sm font-semibold spring-transition ${
                isActive ? 'text-white' : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="model-pill-main"
                  className={`absolute inset-0 rounded-xl bg-gradient-to-r ${mmeta.gradient} shadow-md`}
                  transition={{ type: 'spring', stiffness: 380, damping: 28 }}
                />
              )}
              <span className="relative z-10 flex items-center justify-center gap-2">
                <MIcon weight="bold" className="w-4 h-4" />
                {mmeta.name}
              </span>
            </button>
          )
        })}
      </div>

      {/* 模型详情卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {models?.map((m) => {
          const mmeta = modeMeta[m.id] || modeMeta.classify
          const isActiveModel = m.id === mode
          return (
            <div
              key={m.id}
              className={`rounded-2xl p-4 border spring-transition ${
                isActiveModel
                  ? 'border-indigo-200 bg-gradient-to-br from-indigo-50/60 to-violet-50/60 shadow-sm'
                  : 'border-zinc-100 bg-zinc-50'
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  isActiveModel ? 'bg-gradient-to-br from-indigo-500 to-violet-600' : 'bg-zinc-200'
                }`}>
                  <mmeta.icon weight="fill" className={`w-5 h-5 ${isActiveModel ? 'text-white' : 'text-zinc-500'}`} />
                </div>
                {isActiveModel && (
                  <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-100 text-indigo-600 text-[10px] font-semibold">
                    <CheckCircle weight="fill" className="w-3 h-3" />
                    当前使用
                  </span>
                )}
              </div>
              <h3 className={`text-base font-bold mb-1 ${isActiveModel ? 'text-indigo-700' : 'text-zinc-700'}`}>
                {m.name}
              </h3>
              <p className="text-xs text-zinc-500 leading-relaxed mb-3">{m.description}</p>
              <div className="flex items-center gap-3 text-[11px]">
                <span className="flex items-center gap-1 text-zinc-400">
                  <Info weight="bold" className="w-3 h-3" />
                  {m.labels_count} 个标签
                </span>
                <span className={`w-1.5 h-1.5 rounded-full ${isActiveModel ? 'bg-indigo-400' : 'bg-zinc-300'}`} />
                <span className="text-zinc-400">{m.type === 'classify' ? '分类模型' : '检测模型'}</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* 当前模式说明 */}
      <p className="mt-4 text-xs text-zinc-400 leading-relaxed px-1">
        {modeMeta[mode].short}
      </p>
    </div>
  )
}
