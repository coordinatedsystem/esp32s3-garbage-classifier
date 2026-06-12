import { memo, useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Camera, ArrowsClockwise, Sliders, SunDim, MagicWand, Image, CaretDown, Check } from '@phosphor-icons/react'
import { getCameraConfig, setCameraConfig, resetCameraConfig } from '../api'

const CAMERA_PARAMS = [
  { key: 'brightness', label: '亮度', min: -2, max: 2, step: 1, icon: SunDim },
  { key: 'contrast', label: '对比度', min: -2, max: 2, step: 1, icon: SunDim },
  { key: 'saturation', label: '饱和度', min: -2, max: 2, step: 1, icon: SunDim },
  { key: 'ae_level', label: '曝光补偿', min: -2, max: 2, step: 1, icon: Sliders },
  { key: 'aec_value', label: '曝光值', min: 0, max: 1200, step: 10, icon: Sliders },
  { key: 'agc_gain', label: 'AGC增益', min: 0, max: 30, step: 1, icon: Sliders },
]

const CAMERA_TOGGLES = [
  { key: 'exposure_ctrl', label: '自动曝光', off: '手动', on: '自动' },
  { key: 'gain_ctrl', label: '自动增益', off: '关闭', on: '开启' },
  { key: 'whitebal', label: '自动白平衡', off: '关闭', on: '开启' },
  { key: 'awb_gain', label: '白平衡增益', off: '关闭', on: '开启' },
  { key: 'aec2', label: '曝光传感器', off: '关闭', on: '开启' },
  { key: 'hmirror', label: '水平镜像', off: '正常', on: '镜像' },
  { key: 'vflip', label: '垂直翻转', off: '正常', on: '翻转' },
  { key: 'dcw', label: '下采样(DCW)', off: '关闭', on: '开启' },
  { key: 'bpc', label: '黑点校正', off: '关闭', on: '开启' },
  { key: 'wpc', label: '白点校正', off: '关闭', on: '开启' },
  { key: 'raw_gma', label: '伽马校正', off: '关闭', on: '开启' },
  { key: 'lenc', label: '镜头校正', off: '关闭', on: '开启' },
]

const SPECIAL_EFFECTS = [
  { key: 'special_effect', label: '特效', options: [
    { value: 0, label: '无' },
    { value: 1, label: '负片' },
    { value: 2, label: '黑白' },
    { value: 3, label: '偏红' },
    { value: 4, label: '偏绿' },
    { value: 5, label: '偏蓝' },
    { value: 6, label: '复古' },
  ]},
  { key: 'wb_mode', label: '白平衡模式', options: [
    { value: 0, label: '自动' },
    { value: 1, label: '日光' },
    { value: 2, label: '阴天' },
    { value: 3, label: '白炽灯' },
    { value: 4, label: '荧光灯' },
  ]},
]

const CameraControls = memo(function CameraControls({ onConfigChange }) {
  const [config, setConfig] = useState(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [expanded, setExpanded] = useState(true)
  const localRef = useRef(null)

  useEffect(() => {
    getCameraConfig().then(cfg => {
      setConfig(cfg)
      localRef.current = JSON.parse(JSON.stringify(cfg))
    }).catch(() => {})
  }, [])

  const hasChanges = useCallback(() => {
    if (!config || !localRef.current) return false
    return Object.keys(config).some(k => config[k] !== localRef.current[k])
  }, [config])

  const handleSave = useCallback(async () => {
    if (!hasChanges()) return
    setSaving(true)
    setMsg('')
    try {
      const res = await setCameraConfig(config)
      setConfig(res.config)
      localRef.current = JSON.parse(JSON.stringify(res.config))
      setMsg('已应用')
      if (onConfigChange) onConfigChange()
      setTimeout(() => setMsg(''), 2000)
    } catch (e) {
      setMsg('失败: ' + (e.message || ''))
      setTimeout(() => setMsg(''), 3000)
      try {
        const cfg = await getCameraConfig()
        setConfig(cfg)
        localRef.current = JSON.parse(JSON.stringify(cfg))
      } catch (_) {}
    }
    setSaving(false)
  }, [config, hasChanges, onConfigChange])

  const handleReset = useCallback(async () => {
    setSaving(true)
    setMsg('')
    try {
      const res = await resetCameraConfig()
      setConfig(res.config)
      localRef.current = JSON.parse(JSON.stringify(res.config))
      setMsg('已重置为默认值')
      if (onConfigChange) onConfigChange()
      setTimeout(() => setMsg(''), 2500)
    } catch (e) {
      setMsg('失败: ' + (e.message || ''))
      setTimeout(() => setMsg(''), 3000)
      try {
        const cfg = await getCameraConfig()
        setConfig(cfg)
        localRef.current = JSON.parse(JSON.stringify(cfg))
      } catch (_) {}
    }
    setSaving(false)
  }, [onConfigChange])

  const updateLocal = useCallback((key, value) => {
    setConfig(prev => ({ ...prev, [key]: value }))
  }, [])

  if (!config) return null

  const changed = hasChanges()

  return (
    <div className="rounded-2xl bg-zinc-50 border border-zinc-200">
      <button onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between p-4">
        <div className="flex items-center gap-2">
          <Camera weight="bold" className="w-4 h-4 text-zinc-500" />
          <span className="text-base font-bold text-zinc-800">摄像头参数</span>
          {changed && (
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" title="未保存更改" />
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={e => { e.stopPropagation(); handleSave() }} disabled={saving || !changed}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 spring-transition disabled:opacity-40 disabled:cursor-not-allowed">
            <Check weight="bold" className="w-3 h-3" />
            确认
          </button>
          <button onClick={e => { e.stopPropagation(); handleReset() }} disabled={saving}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-zinc-500 hover:text-zinc-700 hover:bg-white spring-transition disabled:opacity-50">
            <ArrowsClockwise weight="bold" className="w-3 h-3" />
            重置默认
          </button>
          <CaretDown weight="bold" className={`w-3.5 h-3.5 text-zinc-300 spring-transition ${expanded ? '' : 'rotate-180'}`} />
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden px-4 pb-4 space-y-3">

            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Sliders weight="bold" className="w-3 h-3 text-zinc-400" />
                <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">图像调节</span>
              </div>
              <div className="space-y-2.5">
                {CAMERA_PARAMS.map(p => (
                  <div key={p.key}>
                    <div className="flex items-center justify-between mb-0.5">
                      <label className="text-xs font-semibold text-zinc-500">{p.label}</label>
                      <span className="text-xs font-mono text-zinc-400">{config[p.key]}</span>
                    </div>
                    <input type="range" min={p.min} max={p.max} step={p.step} value={config[p.key]}
                      onChange={e => updateLocal(p.key, Number(e.target.value))}
                      className="w-full h-1.5 rounded-full appearance-none bg-zinc-200 accent-indigo-500 cursor-pointer" />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <MagicWand weight="bold" className="w-3 h-3 text-zinc-400" />
                <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">效果模式</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {SPECIAL_EFFECTS.map(se => (
                  <div key={se.key}>
                    <label className="text-xs font-semibold text-zinc-500 mb-1 block">{se.label}</label>
                    <select value={config[se.key]}
                      onChange={e => updateLocal(se.key, Number(e.target.value))}
                      className="w-full px-2 py-1.5 rounded-lg border border-zinc-200 text-xs font-medium bg-white text-zinc-700 focus:outline-none focus:ring-1 focus:ring-indigo-200">
                      {se.options.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Image weight="bold" className="w-3 h-3 text-zinc-400" />
                <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">功能开关</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {CAMERA_TOGGLES.map(t => (
                  <button key={t.key} onClick={() => updateLocal(t.key, config[t.key] ? 0 : 1)}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold border spring-transition ${
                      config[t.key]
                        ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                        : 'bg-white border-zinc-200 text-zinc-500 hover:border-zinc-300'}`}>
                    <span>{t.label}</span>
                    <span className={config[t.key] ? 'text-indigo-600' : 'text-zinc-400'}>
                      {config[t.key] ? t.on : t.off}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {changed && (
              <button onClick={handleSave} disabled={saving}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 spring-transition">
                <Check weight="bold" className="w-3.5 h-3.5" />
                {saving ? '保存中...' : '保存更改'}
              </button>
            )}

            {msg && (
              <div className={`text-xs font-medium px-2 py-1 rounded-lg ${
                msg.startsWith('失败') ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-600'}`}>
                {msg}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})

export default CameraControls
