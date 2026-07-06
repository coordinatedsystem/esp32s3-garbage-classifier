import { useState, useEffect, useCallback, useRef } from 'react'

export default function usePolling(fetchFn, { interval = 15000, enabled = true } = {}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const fetchFnRef = useRef(fetchFn)

  useEffect(() => { fetchFnRef.current = fetchFn }, [fetchFn])

  const execute = useCallback(async () => {
    try {
      setError(null)
      const result = await fetchFnRef.current()
      setData(result)
    } catch (err) {
      setError(err.message || 'Request failed')
    }
  }, [])

  useEffect(() => {
    if (!enabled) { setLoading(false); return }
    let timer, stopped = false

    const run = async () => {
      if (stopped) return
      setLoading(false)
      await execute()
      if (!stopped) timer = setTimeout(run, interval)
    }

    run()
    return () => { stopped = true; clearTimeout(timer) }
  }, [interval, enabled, execute])

  return { data, loading, error, refetch: execute, setData }
}
