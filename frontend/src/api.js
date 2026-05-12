const API_BASE = ''

async function request(path, options = {}) {
  const { timeoutMs = 20000, ...fetchOptions } = options
  const url = `${API_BASE}${path}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const res = await fetch(url, { ...fetchOptions, signal: controller.signal }).finally(() => clearTimeout(timer))
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    throw new Error(detail.detail || `Server returned ${res.status}`)
  }
  const data = await res.json()
  const requestId = res.headers.get('x-request-id')
  if (requestId && data && typeof data === 'object') {
    data._request_id = requestId
  }
  return data
}

export function checkHealth() {
  const start = performance.now()
  return request('/health').then(data => ({
    ...data,
    latency: Math.round(performance.now() - start)
  }))
}

export function getModels() {
  return request('/models')
}

export async function classifyImage(file, model = '') {
  const formData = new FormData()
  formData.append('file', file)
  const qs = model ? `?model=${model}` : ''
  return request(`/classify${qs}`, { method: 'POST', body: formData })
}

export async function detectImage(file) {
  const formData = new FormData()
  formData.append('file', file)
  return request('/detect', { method: 'POST', body: formData })
}

export function getActiveModel() {
  return request('/model/active')
}

export async function setActiveModel(model) {
  return request(`/model/active?model=${model}`, { method: 'POST' })
}

export async function configureProvider(provider, apiKey, apiBase, model) {
  return request('/model/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider,
      api_key: apiKey || '',
      api_base: apiBase || '',
      model: model || ''
    })
  })
}

export function getHistory(page = 1, limit = 20) {
  return request(`/history?page=${page}&limit=${limit}`)
}

export function clearHistory() {
  return request('/history', { method: 'DELETE' })
}

export function deleteHistoryItem(id) {
  return request(`/history/item?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function getHardwareStatus() {
  return request('/hardware/status')
}

export function getHardwareImageUrl() {
  return `${API_BASE}/hardware/image`
}

export function getTriggerConfig() {
  return request('/trigger/config')
}

export function setTriggerConfig(config) {
  return request('/trigger/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config)
  })
}

export function getRuntimeMetrics() {
  return request('/metrics/runtime', { timeoutMs: 10000 })
}
