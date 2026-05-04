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

export async function classifyImage(file) {
  const formData = new FormData()
  formData.append('file', file)
  return request('/classify', { method: 'POST', body: formData })
}

export async function detectImage(file) {
  const formData = new FormData()
  formData.append('file', file)
  return request('/detect', { method: 'POST', body: formData })
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
