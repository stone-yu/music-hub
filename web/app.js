'use strict'

const $ = (sel) => document.querySelector(sel)
const $$ = (sel) => Array.from(document.querySelectorAll(sel))

const state = {
  results: [],       // 扁平化的歌曲列表（含 platform）
  selected: new Set(), // 选中项 key
  quality: 'flac',
  tasksTimer: null,
}

const PLATFORM_NAME = { kw: '酷我', kg: '酷狗', tx: 'QQ音乐', wy: '网易云', mg: '咪咕' }

function toast(msg) {
  const el = $('#toast')
  el.textContent = msg
  el.hidden = false
  clearTimeout(toast._t)
  toast._t = setTimeout(() => { el.hidden = true }, 2600)
}

function rowKey(item) {
  return `${item.platform}:${item.songmid}`
}

// ---------- 视图切换 ----------
$$('.tab').forEach((tab) => {
  tab.addEventListener('click', (e) => {
    e.preventDefault()
    const name = tab.dataset.tab
    $$('.tab').forEach((t) => t.classList.toggle('active', t === tab))
    $$('.view').forEach((v) => v.classList.remove('active'))
    $(`#view-${name}`).classList.add('active')
    if (name === 'tasks') { loadTasks(); startTasksPolling() }
    else stopTasksPolling()
    if (name === 'sources') loadSources()
    if (name === 'playlists') loadPlaylists()
    if (name === 'square') loadSquareHot()
    if (name === 'library') loadLibrary()
    if (name === 'ai-playlist') loadAiInit()
    if (name === 'scrape') loadScrape()
    if (name === 'settings') loadSettings()
    if (name === 'health') loadHealth()
  })
})

// ---------- 搜索 ----------
$('#search-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const keyword = $('#keyword').value.trim()
  if (!keyword) return
  state.quality = $('#quality').value
  const platform = $('#platform').value
  const searchType = $('#search-type').value
  $('#search-status').textContent = '搜索中…'
  $('#results').innerHTML = ''
  state.results = []
  state.selected.clear()
  updateSelectedCount()

  try {
    if (searchType === 'songlist') {
      // 歌单维度搜索
      if (platform === 'aggregate') {
        const r = await fetchJSON(`/api/v1/search/songlist/aggregate?keyword=${encodeURIComponent(keyword)}&page=1`)
        renderSongListAggregate(r)
      } else {
        const r = await fetchJSON(`/api/v1/search/songlist?keyword=${encodeURIComponent(keyword)}&platform=${platform}&page=1`)
        renderSongListSingle(platform, r)
      }
      return
    }
    if (platform === 'aggregate') {
      const r = await fetchJSON(`/api/v1/search/aggregate?keyword=${encodeURIComponent(keyword)}&page=1`)
      renderAggregate(r)
    } else {
      const r = await fetchJSON(`/api/v1/search?keyword=${encodeURIComponent(keyword)}&platform=${platform}&page=1`)
      renderSingle(platform, r)
    }
  } catch (err) {
    $('#search-status').textContent = `搜索失败: ${err.message}`
  }
})

// ---------- 歌单搜索渲染 ----------
function renderSongListAggregate(data) {
  const container = $('#results')
  let total = 0
  for (const pr of data.results) {
    if (pr.ok && pr.list.length) total += pr.list.length
    container.appendChild(renderSongListGroup(pr.platform, pr.list, pr.ok ? null : pr.error))
  }
  $('#search-status').textContent = total ? `共 ${total} 个歌单` : '无结果'
  $('#search-toolbar').hidden = true
}

function renderSongListSingle(platform, data) {
  $('#results').appendChild(renderSongListGroup(platform, data.list, null))
  $('#search-status').textContent = data.list.length ? `共 ${data.list.length} 个歌单` : '无结果'
  $('#search-toolbar').hidden = true
}

function renderSongListGroup(platform, list, error) {
  const group = document.createElement('div')
  group.className = 'platform-group'
  const title = document.createElement('h3')
  title.textContent = PLATFORM_NAME[platform] || platform
  if (error) {
    const e = document.createElement('span'); e.className = 'err'; e.textContent = `  加载失败: ${error}`
    title.appendChild(e)
  }
  group.appendChild(title)
  if (!list || !list.length) {
    if (!error) { const p = document.createElement('div'); p.className = 'empty'; p.textContent = '无结果'; group.appendChild(p) }
    return group
  }
  const table = document.createElement('table')
  table.innerHTML = `<thead><tr><th>歌单</th><th>创建者</th><th>歌曲数</th><th>播放量</th><th>操作</th></tr></thead><tbody></tbody>`
  const tbody = table.querySelector('tbody')
  for (const sl of list) {
    const tr = document.createElement('tr')
    tr.innerHTML = `
      <td>${escapeHtml(sl.name)}</td>
      <td>${escapeHtml(sl.author || '')}</td>
      <td>${sl.total ?? ''}</td>
      <td>${escapeHtml(String(sl.play_count ?? ''))}</td>
      <td class="act"><button data-open="1">查看歌曲</button></td>`
    tr.querySelector('[data-open]').addEventListener('click', () => openSongListDetail(platform, String(sl.id), sl.name))
    tbody.appendChild(tr)
  }
  group.appendChild(table)
  return group
}

async function openSongListDetail(platform, id, name) {
  $('#search-status').textContent = `加载歌单「${name}」…`
  try {
    const d = await fetchJSON(`/api/v1/search/songlist/detail?platform=${platform}&id=${encodeURIComponent(id)}`)
    // 复用歌曲搜索的渲染 + 批量下载/加歌单能力
    $('#results').innerHTML = ''
    state.results = []
    state.selected.clear()
    updateSelectedCount()
    const back = document.createElement('button')
    back.textContent = '← 返回歌单列表'
    back.className = 'linkbtn'
    back.style.margin = '4px 0 10px'
    back.addEventListener('click', () => $('#search-form').dispatchEvent(new Event('submit')))
    $('#results').appendChild(back)
    $('#results').appendChild(renderGroup(platform, d.list, null))
    finalizeSearch(d.list.length)
    $('#search-status').textContent = `${d.info?.name || name} · 共 ${d.list.length} 首（可勾选批量下载 / 加入歌单）`
  } catch (err) {
    $('#search-status').textContent = `歌单详情加载失败: ${err.message}`
  }
}

function renderAggregate(data) {
  const container = $('#results')
  let totalCount = 0
  for (const pr of data.results) {
    if (pr.ok && pr.list.length) totalCount += pr.list.length
    container.appendChild(renderGroup(pr.platform, pr.list, pr.ok ? null : pr.error))
  }
  finalizeSearch(totalCount)
}

function renderSingle(platform, data) {
  const container = $('#results')
  container.appendChild(renderGroup(platform, data.list, null))
  finalizeSearch(data.list.length)
}

function finalizeSearch(count) {
  $('#search-status').textContent = count ? `共 ${count} 首` : '无结果'
  $('#search-toolbar').hidden = count === 0
  $('#check-all').checked = false
}

function renderGroup(platform, list, error) {
  const group = document.createElement('div')
  group.className = 'platform-group'
  const title = document.createElement('h3')
  title.textContent = PLATFORM_NAME[platform] || platform
  if (error) {
    const e = document.createElement('span'); e.className = 'err'; e.textContent = `  加载失败: ${error}`
    title.appendChild(e)
  }
  group.appendChild(title)
  if (!list || !list.length) {
    if (!error) { const p = document.createElement('div'); p.className = 'empty'; p.textContent = '无结果'; group.appendChild(p) }
    return group
  }

  const table = document.createElement('table')
  table.innerHTML = `<thead><tr>
    <th class="chk"></th><th>歌曲</th><th>歌手</th><th>专辑</th><th>时长</th><th>音质</th>
  </tr></thead><tbody></tbody>`
  const tbody = table.querySelector('tbody')

  for (const raw of list) {
    const item = { ...raw, platform }
    state.results.push(item)
    const key = rowKey(item)
    const tr = document.createElement('tr')
    const qualities = (item.types || []).map((t) => `<span class="badge q">${t.type}</span>`).join('')
    tr.innerHTML = `
      <td class="chk"><input type="checkbox" data-key="${key}" /></td>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.singer)}</td>
      <td>${escapeHtml(item.albumName || '')}</td>
      <td>${escapeHtml(String(item.interval || ''))}</td>
      <td class="q">${qualities}</td>`
    tbody.appendChild(tr)
  }
  group.appendChild(table)

  group.querySelectorAll('input[type=checkbox]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) state.selected.add(cb.dataset.key)
      else state.selected.delete(cb.dataset.key)
      updateSelectedCount()
    })
  })
  return group
}

// ---------- 全选 / 计数 / 批量下载 ----------
$('#check-all').addEventListener('change', (e) => {
  const checked = e.target.checked
  $$('#results input[type=checkbox]').forEach((cb) => {
    cb.checked = checked
    if (checked) state.selected.add(cb.dataset.key)
    else state.selected.delete(cb.dataset.key)
  })
  updateSelectedCount()
})

function updateSelectedCount() {
  const n = state.selected.size
  $('#selected-count').textContent = `已选 ${n} 首`
  $('#batch-download').disabled = n === 0
  $('#batch-add-playlist').disabled = n === 0
}

function selectedItems() {
  return state.results.filter((it) => state.selected.has(rowKey(it)))
}

$('#batch-download').addEventListener('click', async () => {
  const items = state.results
    .filter((it) => state.selected.has(rowKey(it)))
    .map((it) => ({ platform: it.platform, musicInfo: it, quality: state.quality }))
  if (!items.length) return
  $('#batch-download').disabled = true
  try {
    const r = await fetchJSON('/api/v1/download/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, quality: state.quality }),
    })
    toast(`已提交 ${r.acceptedCount} 首${r.rejectedCount ? `，${r.rejectedCount} 首被拒` : ''}`)
    state.selected.clear()
    $$('#results input[type=checkbox]').forEach((cb) => (cb.checked = false))
    $('#check-all').checked = false
    updateSelectedCount()
  } catch (err) {
    toast(`批量下载失败: ${err.message}`)
  } finally {
    $('#batch-download').disabled = state.selected.size === 0
  }
})

// 把选中歌曲加入歌单
$('#batch-add-playlist').addEventListener('click', async () => {
  const items = selectedItems()
  if (!items.length) return
  let pls
  try { pls = (await fetchJSON('/api/v1/playlists')).playlists } catch (err) { return toast(err.message) }
  let targetId
  if (!pls.length) {
    const name = prompt('还没有歌单，输入新歌单名称：')
    if (!name || !name.trim()) return
    try { targetId = (await fetchJSON('/api/v1/playlists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) })).id }
    catch (err) { return toast(err.message) }
  } else {
    const list = pls.map((p, i) => `${i + 1}. ${p.name} (${p.count})`).join('\n')
    const pick = prompt(`选择歌单序号加入（或输入新名称创建）：\n${list}`)
    if (!pick) return
    const idx = parseInt(pick) - 1
    if (!Number.isNaN(idx) && pls[idx]) targetId = pls[idx].id
    else {
      try { targetId = (await fetchJSON('/api/v1/playlists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: pick.trim() }) })).id }
      catch (err) { return toast(err.message) }
    }
  }
  let added = 0
  for (const it of items) {
    try {
      const r = await fetchJSON(`/api/v1/playlists/${targetId}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform: it.platform, musicInfo: it }) })
      if (r.added) added++
    } catch { /* ignore single failure */ }
  }
  toast(`已加入 ${added} 首（${items.length - added} 首已存在）`)
})

// ---------- 歌单页 ----------
$('#refresh-playlists').addEventListener('click', loadPlaylists)
$('#create-playlist').addEventListener('click', async () => {
  const name = $('#new-playlist-name').value.trim()
  if (!name) return toast('请输入歌单名称')
  try {
    await fetchJSON('/api/v1/playlists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
    $('#new-playlist-name').value = ''
    toast('已创建')
    loadPlaylists()
  } catch (err) { toast(err.message) }
})

async function loadPlaylists() {
  $('#playlist-detail').hidden = true
  try {
    const r = await fetchJSON('/api/v1/playlists')
    renderPlaylists(r.playlists || [])
  } catch (err) {
    $('#playlists').innerHTML = `<div class="empty">加载失败: ${escapeHtml(err.message)}</div>`
  }
}

function renderPlaylists(pls) {
  $('#playlists-summary').textContent = `共 ${pls.length} 个歌单`
  const c = $('#playlists')
  if (!pls.length) { c.innerHTML = '<div class="empty">暂无歌单，点上方创建</div>'; return }
  c.innerHTML = ''
  for (const p of pls) {
    const card = document.createElement('div')
    card.className = 'src-card'
    card.innerHTML = `
      <div class="src-head">
        <div><b>${escapeHtml(p.name)}</b> <span class="badge">${p.count} 首</span></div>
        <div class="src-act">
          <button data-open="${p.id}">查看</button>
          <button data-dl="${p.id}">整单下载</button>
          <button data-del="${p.id}">删除</button>
        </div>
      </div>
      ${p.description ? `<div class="src-desc">${escapeHtml(p.description)}</div>` : ''}`
    c.appendChild(card)
  }
  c.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openPlaylist(b.dataset.open)))
  c.querySelectorAll('[data-dl]').forEach((b) => b.addEventListener('click', async () => {
    try { const r = await fetchJSON(`/api/v1/playlists/${b.dataset.dl}/download`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quality: $('#quality').value }) }); toast(`已提交 ${r.acceptedCount} 首`) }
    catch (err) { toast(err.message) }
  }))
  c.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { if (confirm('确认删除该歌单?')) act(`/api/v1/playlists/${b.dataset.del}`, 'DELETE', '已删除', loadPlaylists) }))
}

async function openPlaylist(id) {
  try {
    const p = await fetchJSON(`/api/v1/playlists/${id}`)
    const detail = $('#playlist-detail')
    detail.hidden = false
    const rows = (p.items || []).map((it) => `
      <tr>
        <td>${escapeHtml(it.name)}</td><td>${escapeHtml(it.singer)}</td>
        <td>${PLATFORM_NAME[it.platform] || it.platform}</td>
        <td class="act"><button data-song='${encodeURIComponent(JSON.stringify({ platform: it.platform, musicInfo: it.musicInfo }))}'>下载</button>
        <button data-rm="${it.id}">移除</button></td>
      </tr>`).join('')
    detail.innerHTML = `
      <h3 style="margin:16px 0 10px">${escapeHtml(p.name)} · ${p.items.length} 首</h3>
      ${p.items.length ? `<table><thead><tr><th>歌曲</th><th>歌手</th><th>平台</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="empty">空歌单，去搜索页勾选歌曲「加入歌单」</div>'}`
    detail.querySelectorAll('[data-song]').forEach((b) => b.addEventListener('click', async () => {
      const payload = JSON.parse(decodeURIComponent(b.dataset.song))
      try { await fetchJSON('/api/v1/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, quality: $('#quality').value }) }); toast('已提交下载') }
      catch (err) { toast(err.message) }
    }))
    detail.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => act(`/api/v1/playlists/${id}/items/${b.dataset.rm}`, 'DELETE', '已移除', () => openPlaylist(id))))
  } catch (err) { toast(err.message) }
}

// ---------- 任务页 ----------
$('#refresh-tasks').addEventListener('click', loadTasks)

async function loadTasks() {
  try {
    const r = await fetchJSON('/api/v1/tasks')
    renderTasks(r.tasks || [])
  } catch (err) {
    $('#tasks').innerHTML = `<div class="empty">加载失败: ${escapeHtml(err.message)}</div>`
  }
}

function renderTasks(tasks) {
  const summary = { pending: 0, active: 0, completed: 0, failed: 0 }
  tasks.forEach((t) => {
    if (t.status === 'completed' || t.status === 'completed_with_warnings') summary.completed++
    else if (t.status === 'failed' || t.status === 'canceled') summary.failed++
    else if (t.status === 'active') summary.active++
    else summary.pending++
  })
  $('#tasks-summary').textContent = `进行中 ${summary.active} · 等待 ${summary.pending} · 完成 ${summary.completed} · 失败 ${summary.failed}`

  if (!tasks.length) { $('#tasks').innerHTML = '<div class="empty">暂无任务</div>'; return }

  const table = document.createElement('table')
  table.innerHTML = `<thead><tr>
    <th>歌曲</th><th>平台</th><th>音质</th><th>状态</th><th>进度</th><th>操作</th>
  </tr></thead><tbody></tbody>`
  const tbody = table.querySelector('tbody')
  for (const t of tasks) {
    const tr = document.createElement('tr')
    const q = t.actualQuality ? `${t.actualQuality}` : (t.requestedQuality || '')
    const warn = (t.warnings && t.warnings.length) ? ` ⚠️${t.warnings.length}` : ''
    const actions = (t.status === 'failed' || t.status === 'canceled' || t.status === 'completed_with_warnings')
      ? `<button data-retry="${t.id}">重试</button> `
      : (t.status === 'pending' || t.status === 'active') ? `<button data-cancel="${t.id}">取消</button> ` : ''
    tr.innerHTML = `
      <td>${escapeHtml(t.name)} - ${escapeHtml(t.singer)}</td>
      <td>${PLATFORM_NAME[t.platform] || t.platform}</td>
      <td>${q}${t.actualSource ? ` <span class="badge q">${escapeHtml(t.actualSource)}</span>` : ''}</td>
      <td><span class="st ${t.status}">${statusLabel(t.status)}${warn}</span></td>
      <td>${t.progress || 0}%<div class="progress-bar"><div style="width:${t.progress || 0}%"></div></div></td>
      <td class="act">${actions}<button data-del="${t.id}">删除</button></td>`
    tbody.appendChild(tr)
  }
  const container = $('#tasks')
  container.innerHTML = ''
  container.appendChild(table)

  container.querySelectorAll('[data-retry]').forEach((b) => b.addEventListener('click', () => act(`/api/v1/tasks/${b.dataset.retry}/retry`, 'POST', '已重新入队')))
  container.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => act(`/api/v1/tasks/${b.dataset.cancel}/cancel`, 'POST', '已取消')))
  container.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => act(`/api/v1/tasks/${b.dataset.del}`, 'DELETE', '已删除')))
}

async function act(url, method, okMsg, after) {
  try { await fetchJSON(url, { method }); toast(okMsg); (after || loadTasks)() }
  catch (err) { toast(err.message) }
}

function statusLabel(s) {
  return { pending: '等待', active: '下载中', completed: '完成', completed_with_warnings: '完成(有警告)', failed: '失败', canceled: '已取消' }[s] || s
}

function startTasksPolling() {
  stopTasksPolling()
  state.tasksTimer = setInterval(loadTasks, 2000)
}
function stopTasksPolling() {
  if (state.tasksTimer) { clearInterval(state.tasksTimer); state.tasksTimer = null }
}

// ---------- 音源管理 ----------
$('#refresh-sources').addEventListener('click', loadSources)

$('#src-url-btn').addEventListener('click', async () => {
  const url = $('#src-url').value.trim()
  const name = $('#src-url-name').value.trim()
  if (!url) return toast('请输入 URL')
  $('#src-url-btn').disabled = true
  try {
    const r = await fetchJSON('/api/v1/sources/import/url', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, name: name || undefined }),
    })
    toast(`已导入: ${r.name}`)
    $('#src-url').value = ''; $('#src-url-name').value = ''
    loadSources()
  } catch (err) { toast(`导入失败: ${err.message}`) }
  finally { $('#src-url-btn').disabled = false }
})

$('#src-file-btn').addEventListener('click', async () => {
  const f = $('#src-file').files[0]
  if (!f) return toast('请选择 .js 文件')
  const fd = new FormData()
  fd.append('file', f)
  $('#src-file-btn').disabled = true
  try {
    const resp = await fetch('/api/v1/sources/upload', { method: 'POST', body: fd })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
    toast(`已上传: ${data.name}`)
    $('#src-file').value = ''
    loadSources()
  } catch (err) { toast(`上传失败: ${err.message}`) }
  finally { $('#src-file-btn').disabled = false }
})

async function loadSources() {
  try {
    const r = await fetchJSON('/api/v1/sources')
    renderSources(r.sources || [])
  } catch (err) {
    $('#sources').innerHTML = `<div class="empty">加载失败: ${escapeHtml(err.message)}</div>`
  }
}

function renderSources(sources) {
  $('#sources-summary').textContent = `共 ${sources.length} 个音源`
  if (!sources.length) { $('#sources').innerHTML = '<div class="empty">暂无音源，请从上方导入</div>'; return }
  const container = $('#sources')
  container.innerHTML = ''
  for (const s of sources) {
    const card = document.createElement('div')
    card.className = 'src-card'
    const platforms = (s.platforms || []).map((p) =>
      `<span class="badge q">${p.platform}: ${p.qualitys.join('/') || p.actions.join('/')}</span>`).join(' ')
    const statusCls = s.status === 'ready' ? 'completed' : s.status === 'error' ? 'failed' : 'pending'
    card.innerHTML = `
      <div class="src-head">
        <div>
          <b>${escapeHtml(s.name)}</b>
          <span class="badge">v${escapeHtml(s.version || '?')}</span>
          <span class="st ${statusCls}">${s.status}</span>
          ${s.enabled ? '' : '<span class="st canceled">已禁用</span>'}
        </div>
        <div class="src-act">
          <label class="switch"><input type="checkbox" data-toggle="${s.id}" ${s.enabled ? 'checked' : ''}/> 启用</label>
          <button data-reload="${s.id}">重载</button>
          <button data-del="${s.id}">删除</button>
        </div>
      </div>
      ${s.description ? `<div class="src-desc">${escapeHtml(s.description)}${s.author ? ' · ' + escapeHtml(s.author) : ''}</div>` : ''}
      ${s.errorMessage ? `<div class="src-err">错误: ${escapeHtml(s.errorMessage)}</div>` : ''}
      <div class="src-plats">${platforms}</div>`
    container.appendChild(card)
  }
  container.querySelectorAll('[data-toggle]').forEach((cb) => cb.addEventListener('change', async () => {
    try { await fetchJSON(`/api/v1/sources/${cb.dataset.toggle}/enabled`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: cb.checked }) }); toast(cb.checked ? '已启用' : '已禁用') }
    catch (err) { toast(err.message); cb.checked = !cb.checked }
  }))
  container.querySelectorAll('[data-reload]').forEach((b) => b.addEventListener('click', () => act(`/api/v1/sources/${b.dataset.reload}/reload`, 'POST', '已重载', loadSources)))
  container.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { if (confirm('确认删除该音源?')) act(`/api/v1/sources/${b.dataset.del}`, 'DELETE', '已删除', loadSources) }))
}

// ---------- 设置页 ----------
async function loadSettings() {
  try {
    const s = await fetchJSON('/api/v1/settings')
    renderSettings(s)
  } catch (err) {
    $('#settings-body').innerHTML = `<div class="empty">加载失败: ${escapeHtml(err.message)}</div>`
  }
}

function renderSettings(s) {
  const d = s.download, sm = s.smokeTest, bark = sm.alert.bark, sc = sm.alert.serverChan
  const apiKeySet = !!(s.auth && s.auth.apiKeySet)
  const qOpt = (v) => ['flac24bit', 'flac', '320k', '128k'].map((q) => `<option value="${q}" ${q === v ? 'selected' : ''}>${q}</option>`).join('')
  $('#settings-body').innerHTML = `
    <div class="set-card">
      <h3>API Key</h3>
      <div class="set-row">
        <label>状态</label>
        <span id="apikey-status" class="hint">${apiKeySet ? '已设置（出于安全，明文不再显示）' : '未设置'}</span>
      </div>
      <div class="set-row" id="apikey-reveal-row" hidden>
        <label>新 Key（请立即复制保存）</label>
        <div class="apikey-reveal">
          <code id="apikey-value"></code>
          <button type="button" id="apikey-copy">复制</button>
        </div>
      </div>
      <div class="set-row">
        <button type="button" id="apikey-gen">${apiKeySet ? '重新生成' : '生成 API Key'}</button>
        ${apiKeySet ? '<button type="button" id="apikey-revoke" class="danger">撤销</button>' : ''}
        <span class="hint">生成后仅本次明文显示一次，之后无法再查看，只能重新生成。</span>
      </div>
    </div>

    <div class="set-card">
      <h3>下载设置</h3>
      <div class="set-row"><label>并发数 (1-10)</label><input type="number" id="set-conc" min="1" max="10" value="${d.concurrency}" /></div>
      <div class="set-row"><label>默认音质</label><select id="set-quality">${qOpt(d.defaultQuality)}</select></div>
      <div class="set-row"><label>命名模板</label><input type="text" id="set-tpl" value="${escapeHtml(d.nameTemplate)}" /></div>
      <div class="set-row"><label>封面尺寸 (100-1000)</label><input type="number" id="set-cover" min="100" max="1000" value="${d.coverSize}" /></div>
      <div class="set-row"><label>嵌入封面</label><input type="checkbox" id="set-embed-cover" ${d.embedCover ? 'checked' : ''} /></div>
      <div class="set-row"><label>嵌入歌词</label><input type="checkbox" id="set-embed-lyric" ${d.embedLyric ? 'checked' : ''} /></div>
    </div>

    <div class="set-card">
      <h3>冒烟测试</h3>
      <div class="set-row"><label>启用</label><input type="checkbox" id="set-smoke-en" ${sm.enabled ? 'checked' : ''} /></div>
      <div class="set-row"><label>Cron 表达式</label><input type="text" id="set-smoke-cron" value="${escapeHtml(sm.cron)}" /></div>
      <div class="set-row"><label>测试关键词</label><input type="text" id="set-smoke-kw" value="${escapeHtml(sm.keyword)}" /></div>
      <div class="set-row"><label>连续失败告警阈值</label><input type="number" id="set-smoke-th" min="1" max="10" value="${sm.alertThreshold}" /></div>
    </div>

    <div class="set-card">
      <h3>告警渠道 · Bark</h3>
      <div class="set-row"><label>启用</label><input type="checkbox" id="set-bark-en" ${bark.enabled ? 'checked' : ''} /></div>
      <div class="set-row"><label>服务器地址</label><input type="text" id="set-bark-url" value="${escapeHtml(bark.serverUrl)}" /></div>
      <div class="set-row"><label>Device Key ${bark.deviceKeySet ? '<span class="hint">(已设置，留空不改)</span>' : ''}</label><input type="text" id="set-bark-key" placeholder="${bark.deviceKeySet ? '••••••' : '未设置'}" /></div>
    </div>

    <div class="set-card">
      <h3>告警渠道 · Server酱</h3>
      <div class="set-row"><label>启用</label><input type="checkbox" id="set-sc-en" ${sc.enabled ? 'checked' : ''} /></div>
      <div class="set-row"><label>SendKey ${sc.sendKeySet ? '<span class="hint">(已设置，留空不改)</span>' : ''}</label><input type="text" id="set-sc-key" placeholder="${sc.sendKeySet ? '••••••' : '未设置'}" /></div>
    </div>

    <div class="set-actions">
      <button id="set-save">保存设置</button>
      <button id="set-test-notify">测试告警推送</button>
    </div>`

  $('#set-save').addEventListener('click', saveSettings)
  $('#set-test-notify').addEventListener('click', testNotify)
  const genBtn = $('#apikey-gen')
  if (genBtn) genBtn.addEventListener('click', generateApiKey)
  const revokeBtn = $('#apikey-revoke')
  if (revokeBtn) revokeBtn.addEventListener('click', revokeApiKey)
}

async function generateApiKey() {
  if (!confirm('生成新 Key 会使旧 Key 立即失效。明文只显示这一次，确定继续？')) return
  const btn = $('#apikey-gen')
  if (btn) btn.disabled = true
  try {
    const r = await fetchJSON('/api/v1/settings/apikey/generate', { method: 'POST' })
    const row = $('#apikey-reveal-row')
    $('#apikey-value').textContent = r.apiKey
    row.hidden = false
    $('#apikey-status').textContent = '已设置（出于安全，明文不再显示）'
    const copyBtn = $('#apikey-copy')
    if (copyBtn) copyBtn.addEventListener('click', () => {
      navigator.clipboard?.writeText(r.apiKey).then(() => toast('已复制到剪贴板'), () => toast('复制失败，请手动选择复制'))
    })
    toast('已生成，请立即复制保存')
  } catch (err) { toast(`生成失败: ${err.message}`) }
  finally { if (btn) btn.disabled = false }
}

async function revokeApiKey() {
  if (!confirm('撤销后使用该 Key 的脚本/自动化将立即失效，确定？')) return
  try {
    await fetchJSON('/api/v1/settings/apikey', { method: 'DELETE' })
    toast('已撤销')
    loadSettings()
  } catch (err) { toast(`撤销失败: ${err.message}`) }
}

async function saveSettings() {
  const patch = {
    download: {
      concurrency: parseInt($('#set-conc').value),
      defaultQuality: $('#set-quality').value,
      nameTemplate: $('#set-tpl').value,
      coverSize: parseInt($('#set-cover').value),
      embedCover: $('#set-embed-cover').checked,
      embedLyric: $('#set-embed-lyric').checked,
    },
    smokeTest: {
      enabled: $('#set-smoke-en').checked,
      cron: $('#set-smoke-cron').value,
      keyword: $('#set-smoke-kw').value,
      alertThreshold: parseInt($('#set-smoke-th').value),
      alert: {
        bark: { enabled: $('#set-bark-en').checked, serverUrl: $('#set-bark-url').value, deviceKey: $('#set-bark-key').value },
        serverChan: { enabled: $('#set-sc-en').checked, sendKey: $('#set-sc-key').value },
      },
    },
  }
  try {
    await fetchJSON('/api/v1/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
    toast('已保存')
    loadSettings()
  } catch (err) { toast(`保存失败: ${err.message}`) }
}

async function testNotify() {
  $('#set-test-notify').disabled = true
  try {
    const r = await fetchJSON('/api/v1/settings/notify/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
    const active = (r.results || []).filter((x) => !x.skipped)
    if (!active.length) toast('没有启用任何告警渠道')
    else toast(active.map((x) => `${x.channel}: ${x.ok ? '成功' : '失败(' + (x.error || '') + ')'}`).join(' · '))
  } catch (err) { toast(err.message) }
  finally { $('#set-test-notify').disabled = false }
}

// ---------- 健康状态页 ----------
$('#refresh-health').addEventListener('click', loadHealth)
$('#run-smoke').addEventListener('click', async () => {
  $('#run-smoke').disabled = true
  try {
    const resp = await fetch('/api/v1/health/smoke/run', { method: 'POST' })
    if (resp.status === 202) { toast('冒烟测试已启动，稍候刷新'); setTimeout(loadHealth, 4000) }
    else { const d = await resp.json().catch(() => ({})); toast(d.error || `HTTP ${resp.status}`) }
  } catch (err) { toast(err.message) }
  finally { setTimeout(() => { $('#run-smoke').disabled = false }, 3000) }
})

async function loadHealth() {
  try {
    const h = await fetchJSON('/api/v1/health/smoke')
    renderHealth(h)
  } catch (err) {
    $('#health-matrix').innerHTML = `<div class="empty">加载失败: ${escapeHtml(err.message)}</div>`
  }
}

function renderHealth(h) {
  const s = h.summary
  const when = h.lastRunAt ? new Date(h.lastRunAt).toLocaleString('zh-CN') : '从未运行'
  $('#health-summary').textContent = `最近: ${when} · 🟢${s.green} 🟡${s.yellow} 🔴${s.red}${h.running ? ' · 运行中…' : ''}`
  const c = $('#health-matrix')
  if (!h.cells.length) { c.innerHTML = '<div class="empty">暂无冒烟数据，点「立即冒烟测试」</div>'; return }

  // 按音源分组，平台为列
  const bySource = {}
  const platforms = new Set()
  for (const cell of h.cells) {
    (bySource[cell.sourceId] ??= {})[cell.platform] = cell
    platforms.add(cell.platform)
  }
  const plats = [...platforms]
  const dot = (state) => ({ green: '🟢', yellow: '🟡', red: '🔴' }[state] || '⚪')
  let html = '<table><thead><tr><th>音源 \\ 平台</th>' + plats.map((p) => `<th>${PLATFORM_NAME[p] || p}</th>`).join('') + '</tr></thead><tbody>'
  for (const [sid, row] of Object.entries(bySource)) {
    html += `<tr><td><b>${escapeHtml(sid)}</b></td>`
    for (const p of plats) {
      const cell = row[p]
      if (!cell) { html += '<td>—</td>'; continue }
      const steps = cell.steps || {}
      const stepStr = ['search', 'musicUrl', 'head', 'lyric', 'pic'].filter((k) => steps[k]).map((k) => `${k}:${steps[k].ok ? '✓' : '✗'}`).join(' ')
      const title = `${stepStr}${cell.error ? ' | ' + cell.error : ''}`
      html += `<td title="${escapeHtml(title)}">${dot(cell.state)}</td>`
    }
    html += '</tr>'
  }
  html += '</tbody></table>'
  c.innerHTML = html
}

// ---------- 鉴权（登出按钮 + 401 跳登录） ----------
async function initAuth() {
  try {
    const r = await fetchJSON('/api/v1/auth/status')
    if (r.enabled) {
      const btn = $('#logout-btn')
      btn.hidden = false
      btn.addEventListener('click', async (e) => {
        e.preventDefault()
        try { await fetchJSON('/api/v1/auth/logout', { method: 'POST' }) } catch { /* ignore */ }
        location.href = '/login.html'
      })
    }
  } catch { /* ignore */ }
}
initAuth()

// ---------- 工具 ----------
async function fetchJSON(url, opts) {
  const resp = await fetch(url, opts)
  if (resp.status === 401) { location.href = '/login.html'; throw new Error('未授权') }
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
  return data
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// ---------- 曲库 ----------
let libTimer = null
async function loadLibrary() {
  await updateLibraryStatus()
  if (libTimer) clearInterval(libTimer)
  libTimer = setInterval(updateLibraryStatus, 3000)
}
async function updateLibraryStatus() {
  const el = $('#library-status')
  const sum = $('#lib-summary')
  try {
    const d = await fetchJSON('/api/v1/navidrome/status')
    const conn = d.connected ? '<span class="ok">● 已连接</span>' : '<span class="err">● 连接失败</span>'
    const loading = d.libraryLoading ? ' · 加载中…' : ''
    el.innerHTML = `<div class="status">曲库状态：${conn} · 共 <b>${d.librarySize}</b> 首${loading}</div>`
    sum.textContent = d.librarySize ? `${d.librarySize} 首` : ''
    if (!d.libraryLoading && libTimer && !d.connected) { clearInterval(libTimer); libTimer = null }
  } catch (err) {
    el.innerHTML = `<div class="status err">查询失败：${escapeHtml(err.message)}</div>`
  }
}
$('#lib-refresh').addEventListener('click', async () => {
  toast('已触发刷新')
  try { await fetchJSON('/api/v1/navidrome/library/refresh', { method: 'POST' }) } catch (e) { toast(e.message) }
  updateLibraryStatus()
})
$('#lib-scan').addEventListener('click', async () => {
  toast('已触发扫描并刷新（大库可能需 1-3 分钟）')
  try { await fetchJSON('/api/v1/navidrome/library/refresh?scan_first=true', { method: 'POST' }) } catch (e) { toast(e.message) }
  updateLibraryStatus()
})

// ---------- AI 歌单 ----------
const aiState = { matched: [], selected: new Set() }
function loadAiInit() {
  // 进入页面时不清空已有结果，仅初始化选择集合
}
$('#ai-search-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const keyword = $('#ai-keyword').value.trim()
  const platform = $('#ai-platform').value
  if (!keyword) return
  $('#ai-status').innerHTML = '<div class="status">搜索并匹配中…</div>'
  $('#ai-toolbar').hidden = true
  try {
    const body = { keyword }
    if (platform) body.platforms = [platform]
    const d = await fetchJSON('/api/v1/navidrome/match', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    aiState.matched = d.matched || []
    aiState.selected = new Set()
    renderAiResults(d)
  } catch (err) {
    $('#ai-status').innerHTML = `<div class="status err">${escapeHtml(err.message)}</div>`
  }
})
function renderAiResults(d) {
  const el = $('#ai-results')
  const matched = d.matched || []
  const unmatched = d.unmatched || []
  const stats = (d.sourceStats || []).map((s) => `${PLATFORM_NAME[s.platform] || s.platform}:${s.total}`).join(' · ')
  const parts = []
  parts.push(`<div class="status">搜索 ${d.searchTotal} 首 · 匹配曲库 <b>${d.matchedCount}</b> 首 · 未匹配 ${d.unmatchedCount} 首${stats ? '<br>' + escapeHtml(stats) : ''}</div>`)
  if (matched.length) {
    $('#ai-toolbar').hidden = false
    parts.push('<h3 style="color:var(--text);margin:12px 0 6px">✓ 已在曲库（勾选后可创建 Navidrome 歌单）</h3>')
    parts.push('<table class="card"><thead><tr><th></th><th>歌曲</th><th>歌手</th><th>专辑</th><th>来源</th></tr></thead><tbody>')
    for (const m of matched) {
      const fuzzy = m.source.includes('(模糊)')
      parts.push(`<tr><td><input type="checkbox" class="ai-chk" data-id="${escapeHtml(m.id)}" ${aiState.selected.has(m.id) ? 'checked' : ''}></td>
        <td>${escapeHtml(m.title)}</td><td>${escapeHtml(m.artist)}</td><td>${escapeHtml(m.album)}</td>
        <td>${fuzzy ? '<span class="warn">模糊</span>' : escapeHtml(m.source)}</td></tr>`)
    }
    parts.push('</tbody></table>')
  } else {
    parts.push('<div class="empty">曲库中未匹配到任何歌曲</div>')
  }
  if (unmatched.length) {
    parts.push(`<details style="margin-top:12px"><summary>未匹配 ${unmatched.length} 首（可下载补库）</summary><table class="card"><tbody>`)
    for (const u of unmatched) parts.push(`<tr><td>${escapeHtml(u.title)}</td><td>${escapeHtml(u.artist)}</td><td>${escapeHtml(u.source)}</td></tr>`)
    parts.push('</tbody></table></details>')
  }
  el.innerHTML = parts.join('')
  updateAiSelected()
  $$('.ai-chk').forEach((chk) => chk.addEventListener('change', () => {
    const id = chk.dataset.id
    if (chk.checked) aiState.selected.add(id); else aiState.selected.delete(id)
    updateAiSelected()
  }))
}
function updateAiSelected() {
  const n = aiState.selected.size
  $('#ai-selected-count').textContent = `已选 ${n} 首`
  $('#ai-create-btn').disabled = n === 0
}
$('#ai-create-btn').addEventListener('click', async () => {
  const name = $('#ai-playlist-name').value.trim()
  if (!name) { toast('请输入歌单名称'); return }
  const ids = Array.from(aiState.selected)
  $('#ai-create-btn').disabled = true
  try {
    const d = await fetchJSON('/api/v1/navidrome/playlist/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, song_ids: ids }),
    })
    toast(`歌单「${d.playlistName}」已创建（${d.songCount} 首）`)
    $('#ai-playlist-name').value = ''
  } catch (err) {
    toast(err.message)
  } finally {
    updateAiSelected()
  }
})

// ---------- 刮削 ----------
let scrapeTimer = null
async function loadScrape() {
  await updateScrape()
  if (scrapeTimer) clearInterval(scrapeTimer)
  scrapeTimer = setInterval(updateScrape, 3000)
}
async function updateScrape() {
  const el = $('#scrape-tasks')
  const sum = $('#scrape-summary')
  try {
    const d = await fetchJSON('/api/v1/scrape/tasks')
    const tasks = d.tasks || []
    sum.textContent = tasks.length ? `${tasks.length} 条` : ''
    if (!tasks.length) { el.innerHTML = '<div class="empty">暂无刮削任务</div>'; return }
    el.innerHTML = '<table class="card"><thead><tr><th>歌曲</th><th>歌手</th><th>状态</th><th>目标路径</th><th>时间</th></tr></thead><tbody>' +
      tasks.map((t) => {
        const cls = t.status === 'done' ? 'ok' : t.status === 'failed' ? 'err' : ''
        return `<tr><td>${escapeHtml(t.name)}</td><td>${escapeHtml(t.singer)}</td><td class="${cls}">${escapeHtml(t.status)}</td><td class="path">${escapeHtml(t.target_path || t.file_path || '')}</td><td>${new Date(t.updated_at).toLocaleString()}</td></tr>`
      }).join('') + '</tbody></table>'
  } catch (err) {
    el.innerHTML = `<div class="status err">${escapeHtml(err.message)}</div>`
  }
}
$('#scrape-refresh').addEventListener('click', updateScrape)
$('#scrape-scan').addEventListener('click', async () => {
  toast('已触发 Navidrome 扫描')
  try { await fetchJSON('/api/v1/scrape/scan', { method: 'POST' }) } catch (e) { toast(e.message) }
})

// ---------- 歌单广场 ----------
async function loadSquareHot() {
  $('#square-status').innerHTML = '<div class="status">加载广场推荐…</div>'
  try {
    const d = await fetchJSON('/api/v1/square/hot')
    const groups = d.groups || []
    const parts = groups.map((g) => {
      const cards = (g.items || []).map((p) =>
        `<div class="pl-card" data-id="${escapeHtml(p.id)}" data-src="${escapeHtml(p.source)}" data-name="${escapeHtml(p.name)}">
          <div class="pl-name">${escapeHtml(p.name)}</div>
          <div class="pl-meta">${escapeHtml(PLATFORM_NAME[p.source] || p.source)} · ${p.total || 0} 首</div>
        </div>`).join('')
      return `<h3 style="color:var(--text);margin:12px 0 6px">${escapeHtml(g.keyword)}</h3><div class="pl-grid">${cards}</div>`
    })
    $('#square-status').innerHTML = ''
    $('#square-results').innerHTML = parts.join('') || '<div class="empty">无结果</div>'
    bindSquareCards()
  } catch (err) {
    $('#square-status').innerHTML = `<div class="status err">${escapeHtml(err.message)}</div>`
  }
}
$('#square-search-btn').addEventListener('click', async () => {
  const kw = $('#square-keyword').value.trim()
  const p = $('#square-platform').value
  if (!kw) { toast('请输入关键词'); return }
  $('#square-status').innerHTML = '<div class="status">搜索中…</div>'
  try {
    const url = `/api/v1/square/search?keyword=${encodeURIComponent(kw)}` + (p ? `&platforms=${p}` : '')
    const d = await fetchJSON(url)
    const results = d.results || []
    const parts = results.filter((r) => r.ok && r.list.length).map((r) => {
      const cards = r.list.map((p) =>
        `<div class="pl-card" data-id="${escapeHtml(p.id)}" data-src="${escapeHtml(p.source)}" data-name="${escapeHtml(p.name)}">
          <div class="pl-name">${escapeHtml(p.name)}</div>
          <div class="pl-meta">${escapeHtml(PLATFORM_NAME[p.source] || p.source)} · ${p.total || 0} 首</div>
        </div>`).join('')
      return `<h3 style="color:var(--text);margin:12px 0 6px">${escapeHtml(PLATFORM_NAME[r.platform] || r.platform)}</h3><div class="pl-grid">${cards}</div>`
    })
    $('#square-status').innerHTML = ''
    $('#square-results').innerHTML = parts.join('') || '<div class="empty">无结果</div>'
    bindSquareCards()
  } catch (err) {
    $('#square-status').innerHTML = `<div class="status err">${escapeHtml(err.message)}</div>`
  }
})
$('#square-resolve-btn').addEventListener('click', async () => {
  const url = $('#square-url').value.trim()
  if (!url) { toast('请粘贴 URL'); return }
  $('#square-status').innerHTML = '<div class="status">解析中…</div>'
  try {
    const d = await fetchJSON(`/api/v1/square/resolve?url=${encodeURIComponent(url)}`)
    const det = d.detail || {}
    $('#square-status').innerHTML = `<div class="status">${escapeHtml(PLATFORM_NAME[d.platform] || d.platform)} 歌单：${escapeHtml(det.info?.name || '')} · ${det.list?.length || 0} 首</div>`
    renderSquareSongs(d.platform, det.list || [])
  } catch (err) {
    $('#square-status').innerHTML = `<div class="status err">${escapeHtml(err.message)}</div>`
  }
})
$('#square-refresh-btn').addEventListener('click', loadSquareHot)
function bindSquareCards() {
  $$('.pl-card').forEach((card) => card.addEventListener('click', async () => {
    const src = card.dataset.src
    const id = card.dataset.id
    if (!src || !id) return
    $('#square-status').innerHTML = '<div class="status">加载歌单详情…</div>'
    try {
      const d = await fetchJSON(`/api/v1/square/detail?platform=${encodeURIComponent(src)}&id=${encodeURIComponent(id)}`)
      const det = d.detail || {}
      $('#square-status').innerHTML = `<div class="status">${escapeHtml(card.dataset.name)} · ${det.list?.length || 0} 首</div>`
      renderSquareSongs(d.platform, det.list || [])
    } catch (err) {
      $('#square-status').innerHTML = `<div class="status err">加载详情失败：${escapeHtml(err.message)}</div>`
    }
  }))
}
function renderSquareSongs(platform, list) {
  const el = $('#square-results')
  if (!list.length) { el.innerHTML = '<div class="empty">歌单无歌曲</div>'; return }
  state.results = list.map((s) => ({ ...s, platform }))
  state.selected = new Set()
  el.innerHTML = '<table class="card"><thead><tr><th>歌曲</th><th>歌手</th><th>专辑</th><th></th></tr></thead><tbody>' +
    list.map((s, i) => `<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.singer)}</td><td>${escapeHtml(s.albumName || '')}</td>
      <td><button class="dl-one" data-idx="${i}">下载</button></td></tr>`).join('') + '</tbody></table>'
  $$('.dl-one').forEach((btn) => btn.addEventListener('click', () => squareDownloadOne(parseInt(btn.dataset.idx))))
}
async function squareDownloadOne(idx) {
  const s = state.results[idx]
  if (!s) return
  try {
    await fetchJSON('/api/v1/download', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: s.platform, musicInfo: s, quality: state.quality }),
    })
    toast(`已提交下载：${s.name}`)
  } catch (err) {
    toast(`下载失败: ${err.message}`)
  }
}
