'use strict'

const $ = (s) => document.querySelector(s)

// 已登录则直接跳首页；未配密码则提示
async function init() {
  try {
    const r = await fetch('/api/v1/auth/status').then((x) => x.json())
    if (r.authenticated) { location.href = '/'; return }
    if (!r.passwordConfigured) {
      const h = $('#login-hint')
      h.hidden = false
      h.textContent = '尚未设置登录密码，请在 config.yaml 的 auth.webLogin.password 配置后重启服务。'
      $('#login-btn').disabled = true
    }
  } catch { /* ignore */ }
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const username = $('#login-user').value.trim()
  const password = $('#login-pass').value
  const err = $('#login-err')
  err.hidden = true
  $('#login-btn').disabled = true
  try {
    const resp = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
    location.href = '/'
  } catch (e2) {
    err.hidden = false
    err.textContent = e2.message
    $('#login-btn').disabled = false
  }
})

init()
