const API_BASE = ''

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`
  const res = await fetch(url, options)
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    throw new Error(detail.detail || `Server returned ${res.status}`)
  }
  return res.json()
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

export function getHardwareStatus() {
  return request('/hardware/status')
}

export function getHardwareImageUrl() {
  return `${API_BASE}/hardware/image`
}
