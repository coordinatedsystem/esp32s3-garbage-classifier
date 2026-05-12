import { useState, useEffect, useCallback, useRef } from 'react'

export default function usePolling(fetchFn, { interval = 15000, enabled = true } = {}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const fetchFnRef = useRef(fetchFn)
  const inFlightRef = useRef(false)
  const mountedRef = useRef(true)
  const timerRef = useRef(null)
  const lastOkRef = useRef(true)

  useEffect(() => {
    fetchFnRef.current = fetchFn
  }, [fetchFn])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const execute = useCallback(async () => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    try {
      setError(null)
      const result = await fetchFnRef.current()
      if (mountedRef.current) {
        setData(result)
        lastOkRef.current = true
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err.message || 'Request failed')
        lastOkRef.current = false
      }
    } finally {
      if (mountedRef.current) setLoading(false)
      inFlightRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }

    let stopped = false

    const schedule = (delayMs) => {
      if (stopped) return
      timerRef.current = setTimeout(async () => {
        if (stopped) return
        await execute()
        if (stopped) return
        schedule(lastOkRef.current ? interval : 2000)
      }, delayMs)
    }

    execute()
    schedule(interval)

    return () => {
      stopped = true
      clearTimeout(timerRef.current)
    }
  }, [interval, enabled, execute])

  return { data, loading, error, refetch: execute }
}
