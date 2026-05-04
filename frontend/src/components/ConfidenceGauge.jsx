import { motion } from 'framer-motion'

export default function ConfidenceGauge({ confidence, size = 'md' }) {
  const pct = Math.round(confidence * 100)
  const clamped = Math.max(0, Math.min(100, pct))

  const colors = clamped >= 80
    ? { ring: 'stroke-emerald-500', bg: 'stroke-emerald-100', text: 'text-emerald-700', glow: 'bg-emerald-500' }
    : clamped >= 50
      ? { ring: 'stroke-amber-500', bg: 'stroke-amber-100', text: 'text-amber-700', glow: 'bg-amber-500' }
      : { ring: 'stroke-red-500', bg: 'stroke-red-100', text: 'text-red-700', glow: 'bg-red-500' }

  const dims = size === 'lg' ? { w: 120, h: 120, sw: 8, fs: 28 } : { w: 80, h: 80, sw: 6, fs: 18 }
  const radius = (dims.w - dims.sw) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (clamped / 100) * circumference

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative inline-flex items-center justify-center">
        <svg width={dims.w} height={dims.h} className="-rotate-90">
          <circle
            cx={dims.w / 2}
            cy={dims.h / 2}
            r={radius}
            fill="none"
            strokeWidth={dims.sw}
            className={colors.bg}
          />
          <motion.circle
            cx={dims.w / 2}
            cy={dims.h / 2}
            r={radius}
            fill="none"
            strokeWidth={dims.sw}
            strokeLinecap="round"
            className={colors.ring}
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ delay: 0.3, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.span
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.5, duration: 0.3 }}
            className={`font-semibold tracking-tight ${colors.text}`}
            style={{ fontSize: dims.fs }}
          >
            {clamped}
          </motion.span>
        </div>
      </div>
      <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">Confidence</span>
    </div>
  )
}
