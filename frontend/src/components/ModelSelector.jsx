import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Scan, ImageSquare, Flask, Gear, Brain, Cloud, Info, WifiHigh, Browser, Check, X } from '@phosphor-icons/react'
import { getModels, getActiveModel, setActiveModel, configureProvider } from '../api'

const modeMeta = {
  clip: {
    icon: Scan, name: 'CLIP', type: '本地分类',
    desc: 'ViT-B/32 零样本图像分类，匹配 180+ 标签并映射垃圾类别。响应快，无需联网，始终可用。',
    gradient: 'from-violet-500 to-purple-600', bg: 'bg-violet-50', text: 'text-violet-700'
  },
  doubao: {
    icon: Brain, name: '豆包', type: '云端分类',
    desc: '字节豆包视觉大模型。云端识别图片物品，返回英文名。需配置 API Key。',
    gradient: 'from-emerald-500 to-teal-600', bg: 'bg-emerald-50', text: 'text-emerald-700'
  },
  qwen: {
    icon: Cloud, name: '千问', type: '云端分类',
    desc: '阿里通义千问视觉大模型。云端识别图片物品，返回英文名。需配置 API Key。',
    gradient: 'from-amber-500 to-orange-600', bg: 'bg-amber-50', text: 'text-amber-700'
  },
  custom: {
    icon: Gear, name: '自定义', type: '云端分类',
    desc: '兼容 OpenAI 格式的任意视觉模型，自行配置 API 地址与模型名。',
    gradient: 'from-zinc-500 to-zinc-700', bg: 'bg-zinc-100', text: 'text-zinc-700'
  },
  detect: {
    icon: ImageSquare, name: 'YOLO', type: '本地检测',
    desc: 'exp-22.pt 目标检测，定位物体并返回边界框。仅网页端使用，不影响 ESP32。',
    gradient: 'from-sky-500 to-blue-600', bg: 'bg-sky-50', text: 'text-sky-700'
  }
}

const allModes = ['clip', 'doubao', 'qwen', 'custom', 'detect']

export default function ModelSelector({ mode, setMode, disabled }) {
  const [models, setModels] = useState(null)
  const [pendingModel, setPendingModel] = useState(null)  // 选中但未确认的模型
  const [showConfig, setShowConfig] = useState(false)
  const [configForm, setConfigForm] = useState({ api_key: '', api_base: '', model: '' })
  const [configMsg, setConfigMsg] = useState('')
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    Promise.all([getModels(), getActiveModel()])
      .then(([modelData, activeData]) => {
        setModels(modelData.models)
        if (activeData.active !== 'detect' && activeData.active !== mode && mode !== 'detect') {
          setMode(activeData.active)
        }
      })
      .catch(() => {})
  }, [])

  // 点击 tab → 设为待确认
  const handleTabClick = (m) => {
    if (m === mode) return  // 已经是当前模型
    setPendingModel(m)
  }

  // 确认切换
  const handleConfirm = async () => {
    if (!pendingModel) return
    setConfirming(true)
    const m = pendingModel
    setMode(m)
    if (m !== 'detect') {
      try { await setActiveModel(m) } catch {}
    }
    setPendingModel(null)
    setConfirming(false)
  }

  // 取消切换
  const handleCancel = () => {
    setPendingModel(null)
  }

  const openConfig = () => {
    const currentModel = models?.find(m => m.id === mode)
    setConfigForm({
      api_key: '',
      api_base: mode === 'doubao' ? 'https://ark.cn-beijing.volces.com/api/v3'
              : mode === 'qwen' ? 'https://dashscope.aliyuncs.com/compatible-mode/v1'
              : '',
      model: currentModel?.model || ''
    })
    setShowConfig(true)
    setConfigMsg('')
  }

  const handleConfigSave = async () => {
    try {
      const res = await configureProvider(
        mode, configForm.api_key, configForm.api_base, configForm.model
      )
      setConfigMsg(res.message || 'Saved')
      // 刷新模型列表以更新 configured 状态
      const data = await getModels()
      setModels(data.models)
      setTimeout(() => { setConfigMsg(''); setShowConfig(false) }, 1500)
    } catch (e) {
      setConfigMsg('Error: ' + e.message)
    }
  }

  const displayModel = pendingModel || mode
  const currentMeta = modeMeta[displayModel] || modeMeta.clip
  const isVisionModel = ['doubao', 'qwen', 'custom'].includes(displayModel)
  const isClassifyModel = displayModel !== 'detect'
  const currentModel = models?.find(m => m.id === displayModel)

  return (
    <div className="glass-card rounded-[2.5rem] p-6 lg:p-8">
      {/* 标题 */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-200">
            <Flask weight="fill" className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-zinc-800">识别引擎</h2>
            <p className="text-[11px] text-zinc-400">
              {isClassifyModel ? 'ESP32 同步跟随' : '网页端专用'}
            </p>
          </div>
        </div>
        <div className={`px-4 py-2 rounded-full text-sm font-semibold bg-gradient-to-r ${currentMeta.gradient} text-white shadow-md`}>
          {currentMeta.name}
        </div>
      </div>

      {/* 模型 Tabs */}
      <div className="flex rounded-2xl bg-zinc-100 p-1.5 mb-4 overflow-x-auto">
        {allModes.map((m) => {
          const meta = modeMeta[m]
          const MIcon = meta.icon
          const isCurrent = mode === m
          const isPending = pendingModel === m
          const isActive = isCurrent || isPending
          const isConfigured = !['doubao', 'qwen', 'custom'].includes(m) || models?.find(x => x.id === m)?.configured
          return (
            <button
              key={m}
              onClick={() => handleTabClick(m)}
              disabled={disabled}
              className={`relative flex-shrink-0 px-4 py-2.5 rounded-xl text-[13px] font-semibold spring-transition ${
                isActive ? 'text-white' : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="model-tab"
                  className={`absolute inset-0 rounded-xl bg-gradient-to-r ${meta.gradient} shadow-md`}
                  transition={{ type: 'spring', stiffness: 380, damping: 28 }}
                />
              )}
              <span className="relative z-10 flex items-center gap-1.5">
                <MIcon weight="bold" className="w-4 h-4" />
                {meta.name}
                {isCurrent && !isPending && (
                  <span className="w-1.5 h-1.5 rounded-full bg-white/70" />
                )}
                {!isConfigured && (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-300" />
                )}
              </span>
            </button>
          )
        })}
      </div>

      {/* 确认栏 */}
      <AnimatePresence>
        {pendingModel && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mb-4 p-3 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-between">
              <span className="text-[13px] font-semibold text-indigo-700">
                切换至 {modeMeta[pendingModel].name}？
                {pendingModel !== 'detect' && ' ESP32 将同步跟随。'}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleConfirm}
                  disabled={confirming}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold spring-transition hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-50"
                >
                  <Check weight="bold" className="w-3.5 h-3.5" />
                  确认
                </button>
                <button
                  onClick={handleCancel}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-zinc-500 hover:text-zinc-700 hover:bg-white spring-transition"
                >
                  <X weight="bold" className="w-3.5 h-3.5" />
                  取消
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 模型详情卡片 */}
      <AnimatePresence mode="wait">
        <motion.div
          key={displayModel}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className={`rounded-2xl p-4 border ${currentMeta.bg} border-zinc-100`}
        >
          <div className="flex items-start gap-3 mb-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br ${currentMeta.gradient} shadow-md flex-shrink-0`}>
              <currentMeta.icon weight="fill" className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <h3 className="text-sm font-bold text-zinc-800">{currentMeta.name}</h3>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${currentMeta.bg} ${currentMeta.text}`}>
                  {currentMeta.type}
                </span>
                {isClassifyModel && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-600 text-[10px] font-semibold flex items-center gap-1">
                    <WifiHigh weight="bold" className="w-2.5 h-2.5" />
                    ESP32
                  </span>
                )}
                {displayModel === 'detect' && (
                  <span className="px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-500 text-[10px] font-semibold flex items-center gap-1">
                    <Browser weight="bold" className="w-2.5 h-2.5" />
                    Web Only
                  </span>
                )}
              </div>
              <p className="text-[11px] text-zinc-500 leading-relaxed mt-1">{currentMeta.desc}</p>
              {currentModel && (
                <div className="flex items-center gap-4 mt-2 text-[11px] text-zinc-400">
                  {currentModel.labels_count > 0 && (
                    <span className="flex items-center gap-1">
                      <Info weight="bold" className="w-3 h-3" />
                      {currentModel.labels_count} 标签
                    </span>
                  )}
                  {currentModel.model && (
                    <span className="font-mono text-zinc-400 truncate max-w-[200px]">{currentModel.model}</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 视觉模型配置（仅当前已确认的模型才能配置） */}
          {isVisionModel && !pendingModel && (
            <>
              <button
                onClick={openConfig}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium spring-transition ${
                  currentModel?.configured
                    ? 'bg-emerald-100 text-emerald-600 hover:bg-emerald-200'
                    : 'bg-amber-100 text-amber-600 hover:bg-amber-200'
                }`}
              >
                <Gear weight="bold" className="w-3 h-3" />
                {currentModel?.configured ? '已配置 · 点击修改' : '未配置 · 点击设置 API'}
              </button>

              <AnimatePresence>
                {showConfig && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-3 space-y-2 overflow-hidden"
                  >
                    <div>
                      <label className="text-[10px] text-zinc-500 font-semibold">API Key</label>
                      <input
                        type="password"
                        value={configForm.api_key}
                        onChange={e => setConfigForm(f => ({ ...f, api_key: e.target.value }))}
                        placeholder="sk-..."
                        className="w-full mt-0.5 px-3 py-2 rounded-lg border border-zinc-200 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-200"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-500 font-semibold">API Base URL</label>
                      <input
                        type="text"
                        value={configForm.api_base}
                        onChange={e => setConfigForm(f => ({ ...f, api_base: e.target.value }))}
                        placeholder="https://api.example.com/v1"
                        className="w-full mt-0.5 px-3 py-2 rounded-lg border border-zinc-200 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-200"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-500 font-semibold">Model Name</label>
                      <input
                        type="text"
                        value={configForm.model}
                        onChange={e => setConfigForm(f => ({ ...f, model: e.target.value }))}
                        placeholder="vision-model-name"
                        className="w-full mt-0.5 px-3 py-2 rounded-lg border border-zinc-200 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-200"
                      />
                    </div>
                    <div className="flex items-center gap-3 pt-1">
                      <button
                        onClick={handleConfigSave}
                        className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-medium spring-transition hover:bg-indigo-700 active:scale-[0.98]"
                      >
                        保存
                      </button>
                      <button
                        onClick={() => setShowConfig(false)}
                        className="text-xs text-zinc-400 hover:text-zinc-600"
                      >
                        取消
                      </button>
                      {configMsg && (
                        <span className={`text-[11px] ${configMsg.startsWith('Error') ? 'text-red-500' : 'text-emerald-500'}`}>
                          {configMsg}
                        </span>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
