import { useState, useEffect, useCallback, useRef } from 'react'

export default function usePolling(fetchFn, { interval = 15000, enabled = true } = {}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const fetchFnRef = useRef(fetchFn)

  useEffect(() => {
    fetchFnRef.current = fetchFn
  }, [fetchFn])

  const execute = useCallback(async () => {
    try {
      setError(null)
      const result = await fetchFnRef.current()
      setData(result)
    } catch (err) {
      setError(err.message || 'Request failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }

    let cancelled = false
    const run = async () => {
      try {
        const result = await fetchFnRef.current()
        if (!cancelled) {
          setData(result)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Request failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    run()
    const id = setInterval(run, interval)
    return () => { cancelled = true; clearInterval(id) }
  }, [interval, enabled])

  return { data, loading, error, refetch: execute }
}
