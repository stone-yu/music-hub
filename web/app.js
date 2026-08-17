'use strict'

const $ = (sel) => document.querySelector(sel)
const $$ = (sel) => Array.from(document.querySelectorAll(sel))

const state = {
  results: [],       // 扁平化的歌曲列表（含 platform）
  selected: new Set(), // 批量下载选中项 key
  selectedForCreate: new Set(), // 创建歌单选中项（已匹配歌曲的 rowKey）
  matchMap: new Map(), // rowKey → 匹配结果（matched/libId/isFuzzy）
  createMap: new Map(), // rowKey → {libId,title,artist} 已匹配歌曲信息（创建球用）
  createCtx: { name: '', cover: '' }, // 创建歌单默认名/图（歌单详情页带过来，单曲搜索页为空）
  quality: 'flac',
}

const PLATFORM_NAME = { kw: '酷我', kg: '酷狗', tx: 'QQ音乐', wy: '网易云', mg: '咪咕' }
const QUALITIES = [
  { v: 'flac24bit', label: 'Hi-Res (flac24bit)' },
  { v: 'flac', label: '无损 (flac)' },
  { v: '320k', label: '320k' },
  { v: '128k', label: '128k' },
]
// 下载时选择音质（默认 flac）
function pickQuality() {
  const opts = QUALITIES.map((q, i) => `${i + 1}. ${q.label}`).join('\n')
  const pick = prompt(`选择下载音质：\n${opts}`)
  const idx = parseInt(pick || '') - 1
  if (Number.isNaN(idx) || !QUALITIES[idx]) return null
  return QUALITIES[idx].v
}

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

// ---------- 左侧菜单 ----------
function initSidebar() {
  const pref = localStorage.getItem('sidebar-open')
  if (pref === '0') document.body.classList.remove('sidebar-open')
  $('#sidebar-toggle').addEventListener('click', () => {
    const open = !document.body.classList.contains('sidebar-open')
    document.body.classList.toggle('sidebar-open', open)
    $('#sidebar-backdrop').classList.toggle('show', open && window.innerWidth <= 768)
    if (window.innerWidth > 768) localStorage.setItem('sidebar-open', open ? '1' : '0')
  })
  $('#sidebar-backdrop').addEventListener('click', () => {
    document.body.classList.remove('sidebar-open')
    $('#sidebar-backdrop').classList.remove('show')
  })
}

// ---------- 顶部条：曲库状态 + 个人中心 ----------
async function checkTopStatus() {
  const el = $('#status-indicator')
  try {
    const d = await fetchJSON('/api/v1/navidrome/status')
    if (d.connected) {
      el.innerHTML = `<span class="ok">● 已连接</span> · 曲库 ${d.librarySize} 首${d.libraryLoading ? ' · 加载中' : ''}`
    } else {
      el.innerHTML = `<span class="err">● 连接失败</span>`
    }
  } catch { el.innerHTML = `<span class="err">● 网络错误</span>` }
}
function refreshLibraryTop() {
  const ico = $('#libraryRefreshIcon')
  ico.classList.add('spin')
  fetchJSON('/api/v1/navidrome/library/refresh', { method: 'POST' })
    .then(() => checkTopStatus())
    .catch((e) => toast(e.message))
    .finally(() => setTimeout(() => ico.classList.remove('spin'), 800))
}
function initProfileMenu() {
  const btn = $('#profile-btn')
  const menu = $('#profile-menu')
  btn.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('show') })
  document.addEventListener('click', (e) => { if (!e.target.closest('.profile-wrap')) menu.classList.remove('show') })
  // 设置菜单项：切到设置 view
  menu.querySelectorAll('.profile-menu-item[data-tab]').forEach((it) => {
    it.addEventListener('click', () => {
      menu.classList.remove('show')
      const name = it.dataset.tab
      $$('.menu-item').forEach((t) => t.classList.remove('active'))
      $$('.view').forEach((v) => v.classList.remove('active'))
      $(`#view-${name}`).classList.add('active')
      if (name === 'settings') switchSettingsSub('general')
    })
  })
}

// ---------- 视图切换 ----------
$$('.menu-item').forEach((tab) => {
  tab.addEventListener('click', (e) => {
    e.preventDefault()
    const name = tab.dataset.tab
    if (!name) return
    $$('.menu-item').forEach((t) => t.classList.toggle('active', t === tab))
    $$('.view').forEach((v) => v.classList.remove('active'))
    $(`#view-${name}`).classList.add('active')
    if (name === 'sources') loadSources()
    if (name === 'playlists') loadPlaylists()
    if (name === 'settings') switchSettingsSub('general')
    if (name === 'search') loadSearchSquare()
  })
})

// 搜索页广场推荐（未搜索时显示）
async function loadSearchSquare() {
  const grid = $('#search-square-grid')
  if (!grid || grid.dataset.loaded === '1') return
  grid.innerHTML = '<div class="empty">加载中…</div>'
  try {
    const d = await fetchJSON('/api/v1/ranks')
    const ranks = (d.ranks || []).slice(0, 12)
    const cards = ranks.map((r) => {
      const cover = r.cover_url ? `<img src="${escapeHtml(r.cover_url)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">` : ''
      const ph = `<div class="pl-cover-ph" style="${r.cover_url ? 'display:none' : 'display:flex'}">🔥</div>`
      return `<div class="pl-card" data-id="${escapeHtml(r.id)}" data-src="${escapeHtml(r.source)}" data-name="${escapeHtml(r.name)}">
        <div class="pl-cover">${cover}${ph}</div>
        <div class="pl-name">${escapeHtml(r.name)}</div>
        <div class="pl-meta">${escapeHtml(PLATFORM_NAME[r.source] || r.source)} 热榜</div>
      </div>`
    }).join('')
    grid.innerHTML = cards || '<div class="empty">无推荐</div>'
    grid.dataset.loaded = '1'
    // 点击榜单卡片加载热榜歌曲到搜索结果区
    $$('#search-square-grid .pl-card').forEach((card) => card.addEventListener('click', () => loadRankSongs(card.dataset.src, card.dataset.id, card.dataset.name)))
  } catch (err) { grid.innerHTML = `<div class="empty">加载失败</div>` }
}

// 加载某榜单歌曲，渲染到 #results（卡片式 + 曲库匹配）
async function loadRankSongs(source, id, name) {
  $('#search-square').style.display = 'none'
  $('#search-status').textContent = `加载 ${name} …`
  $('#results').innerHTML = ''
  state.results = []
  state.selectedForCreate.clear()
  state.matchMap = new Map()
  state.createMap = new Map()
  state.createCtx = { name: name + ' - 热榜', cover: '' }
  updateGlobalCreateBtn()
  try {
    const d = await fetchJSON(`/api/v1/ranks/${encodeURIComponent(source)}/${encodeURIComponent(id)}?limit=50`)
    const list = d.list || []
    const group = renderGroup(source, list, null)
    // 改标题为榜单名
    const h3 = group.querySelector('h3')
    if (h3) h3.textContent = `${name} · ${list.length} 首`
    $('#results').appendChild(group)
    finalizeSearch(list.length)
    matchSearchResults()
  } catch (err) {
    $('#search-status').textContent = `加载失败: ${err.message}`
  }
}

// ---------- 搜索 ----------
$('#search-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const keyword = $('#keyword').value.trim()
  if (!keyword) return
  const platform = $('#platform').value
  $('#search-status').textContent = '搜索中…'
  $('#results').innerHTML = ''
  $('#search-square').style.display = 'none'  // 搜索时隐藏广场推荐
  state.results = []
  state.selected.clear()
  state.selectedForCreate.clear()
  state.matchMap = new Map()
  state.createMap = new Map()
  state.createCtx = { name: '', cover: '' }  // 单曲搜索无默认名/图
  updateGlobalCreateBtn()

  try {
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
}

function renderSongListSingle(platform, data) {
  $('#results').appendChild(renderSongListGroup(platform, data.list, null))
  $('#search-status').textContent = data.list.length ? `共 ${data.list.length} 个歌单` : '无结果'
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
  matchSearchResults()
}

function renderSingle(platform, data) {
  const container = $('#results')
  container.appendChild(renderGroup(platform, data.list, null))
  finalizeSearch(data.list.length)
  matchSearchResults()
}

function finalizeSearch(count) {
  $('#search-status').textContent = count ? `共 ${count} 首` : '无结果'
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

  const grid = document.createElement('div')
  grid.className = 'song-grid'
  for (const raw of list) {
    const item = { ...raw, platform }
    state.results.push(item)
    const key = rowKey(item)
    const card = document.createElement('div')
    card.className = 'song-card'
    card.dataset.key = key
    card.innerHTML = `
      <div class="song-card-top">
        <input type="checkbox" class="create-chk" data-key="${key}" data-matched="0" title="勾选已匹配歌曲创建歌单" />
        <div class="song-card-info">
          <div class="song-card-title">${escapeHtml(item.name)}</div>
          <div class="song-card-artist">${escapeHtml(item.singer)}${item.albumName ? ' · ' + escapeHtml(item.albumName) : ''}</div>
        </div>
      </div>
      <div class="song-card-bottom">
        <span class="match-col" data-key="${key}"><span class="pending">…</span></span>
        <div class="song-card-act">
          <button class="preview-btn" data-key="${key}">▶试听</button>
          <button class="dl-one" data-key="${key}">⬇下载</button>
        </div>
      </div>`
    grid.appendChild(card)
  }
  group.appendChild(grid)
  bindSongCardEvents(group)
  return group
}

// 歌曲卡片事件绑定（renderGroup / renderPlaylistDetail 共用）
function bindSongCardEvents(container) {
  container.querySelectorAll('.preview-btn').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation()
    const it = state.results.find((r) => rowKey(r) === b.dataset.key)
    if (it) previewSong(it.platform, it, `${it.name} - ${it.singer}`)
  }))
  container.querySelectorAll('.dl-one').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation()
    if (b.disabled) return
    const it = state.results.find((r) => rowKey(r) === b.dataset.key)
    if (!it) return
    const quality = pickQuality()
    if (!quality) return
    try {
      await fetchJSON('/api/v1/download', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: it.platform, musicInfo: it, quality }) })
      toast(`已提交下载：${it.name}`)
    } catch (err) { toast(`下载失败: ${err.message}`) }
  }))
  container.querySelectorAll('.create-chk').forEach((cb) => cb.addEventListener('click', (e) => e.stopPropagation()))
  container.querySelectorAll('.song-card').forEach((card) => card.addEventListener('click', () => {
    const cb = card.querySelector('.create-chk')
    if (!cb || cb.dataset.matched !== '1') return
    cb.checked = !cb.checked
    card.classList.toggle('song-card-selected', cb.checked)
    toggleSelectedForCreate(cb.dataset.key, cb.checked)
  }))
}

// 异步给搜索结果打"已在曲库"标记
async function matchSearchResults() {
  if (!state.results.length) return
  const songs = state.results.map((it) => ({ title: it.name, artist: it.singer, source: it.platform }))
  try {
    const r = await fetchJSON('/api/v1/navidrome/match/songs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ songs }),
    })
    state.matchMap = new Map()
    state.createMap = new Map()
    r.results.forEach((m) => {
      const item = state.results[m.index]
      if (!item) return
      const key = rowKey(item)
      state.matchMap.set(key, m)
      if (m.matched) state.createMap.set(key, { libId: m.libId, title: m.libTitle, artist: m.libArtist, platform: item.platform })
    })
    applyMatchMarks()
  } catch (err) {
    $('#search-status').textContent += `（曲库匹配失败：${err.message}）`
  }
}

function applyMatchMarks() {
  $$('#results .song-card[data-key]').forEach((card) => {
    const key = card.dataset.key
    const m = state.matchMap.get(key)
    const cell = card.querySelector('.match-col')
    const cb = card.querySelector('.create-chk')
    const dlBtn = card.querySelector('.dl-one')
    if (!cell || !cb) return
    if (m?.matched) {
      cell.innerHTML = `<span class="ok">✓已在曲库${m.isFuzzy ? ' (模糊)' : ''}</span>`
      cb.dataset.matched = '1'
      cb.title = '勾选后可创建 Navidrome 歌单'
      cb.style.visibility = 'visible'
      if (dlBtn) { dlBtn.disabled = true; dlBtn.classList.add('disabled'); dlBtn.title = '已在曲库' }
    } else {
      cell.innerHTML = `<span class="muted">未收录</span>`
      cb.dataset.matched = '0'
      cb.style.visibility = 'hidden'  // 未匹配不显示创建勾选
      if (dlBtn) { dlBtn.disabled = false; dlBtn.classList.remove('disabled') }
    }
  })
}

// 创建球勾选枢纽：仅已匹配歌曲可勾选进创建球
function toggleSelectedForCreate(key, on) {
  const m = state.matchMap.get(key)
  if (!m?.matched) {
    const cb = document.querySelector(`.create-chk[data-key="${key}"]`)
    if (cb) { cb.checked = false; toast('未匹配歌曲请先下载补库') }
    return
  }
  if (on) state.selectedForCreate.add(key)
  else state.selectedForCreate.delete(key)
  updateGlobalCreateBtn()
}

// ---------- 计数（批量下载条已移除，勾选改为创建歌单球用）----------
function updateSelectedCount() { /* no-op：原批量下载条已删除 */ }
function selectedItems() {
  return state.results.filter((it) => state.selected.has(rowKey(it)))
}

// ---------- 歌单页 ----------
$('#refresh-playlists').addEventListener('click', loadLocalPlaylists)
$('#create-playlist').addEventListener('click', async () => {
  const name = $('#new-playlist-name').value.trim()
  if (!name) return toast('请输入歌单名称')
  try {
    await fetchJSON('/api/v1/playlists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
    $('#new-playlist-name').value = ''
    toast('已创建')
    loadLocalPlaylists()
  } catch (err) { toast(err.message) }
})

async function loadLocalPlaylists() {
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
    const quality = pickQuality(); if (!quality) return
    try { const r = await fetchJSON(`/api/v1/playlists/${b.dataset.dl}/download`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quality }) }); toast(`已提交 ${r.acceptedCount} 首`) }
    catch (err) { toast(err.message) }
  }))
  c.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { if (confirm('确认删除该歌单?')) act(`/api/v1/playlists/${b.dataset.del}`, 'DELETE', '已删除', loadLocalPlaylists) }))
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
      const quality = pickQuality(); if (!quality) return
      const payload = JSON.parse(decodeURIComponent(b.dataset.song))
      try { await fetchJSON('/api/v1/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, quality }) }); toast('已提交下载') }
      catch (err) { toast(err.message) }
    }))
    detail.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => act(`/api/v1/playlists/${id}/items/${b.dataset.rm}`, 'DELETE', '已移除', () => openPlaylist(id))))
  } catch (err) { toast(err.message) }
}

// ---------- 歌单广场（平台标签 + 搜歌单 + 详情已匹配/未匹配分组）----------
let plActivePlatform = ''
async function loadPlaylists() {
  $('#pl-detail').hidden = true
  $('#pl-grid').hidden = false
  $('#pl-status').innerHTML = '<div class="status">加载广场推荐…</div>'
  try {
    const d = await fetchJSON('/api/v1/square/hot' + (plActivePlatform ? `?platform=${plActivePlatform}` : ''))
    renderPlaylistGrid(d.groups || [])
  } catch (err) {
    $('#pl-status').innerHTML = `<div class="status err">${escapeHtml(err.message)}</div>`
  }
}
function renderPlaylistGrid(groups) {
  const parts = groups.map((g) => {
    const cards = (g.items || []).map((p) => {
      const cover = p.img ? `<img src="${escapeHtml(p.img)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">` : ''
      const placeholder = `<div class="pl-cover-ph" style="${p.img ? 'display:none' : 'display:flex'}">🎶</div>`
      return `<div class="pl-card" data-id="${escapeHtml(p.id)}" data-src="${escapeHtml(p.source)}" data-name="${escapeHtml(p.name)}">
        <div class="pl-cover">${cover}${placeholder}</div>
        <div class="pl-name">${escapeHtml(p.name)}</div>
        <div class="pl-meta">${escapeHtml(PLATFORM_NAME[p.source] || p.source)} · ${p.total || 0} 首</div>
      </div>`
    }).join('')
    return `<h3 class="platform-group" style="border-left:3px solid var(--accent);padding-left:6px;font-size:14px;color:#555;margin:12px 0 8px">${escapeHtml(g.keyword)}</h3><div class="pl-grid">${cards}</div>`
  })
  $('#pl-status').innerHTML = ''
  $('#pl-grid').innerHTML = parts.join('') || '<div class="empty">无结果</div>'
  $$('#pl-grid .pl-card').forEach((card) => card.addEventListener('click', () => openPlaylistDetail(card.dataset.src, card.dataset.id, card.dataset.name)))
}
$$('#pl-platform-tabs .ptab').forEach((t) => t.addEventListener('click', () => {
  $$('#pl-platform-tabs .ptab').forEach((x) => x.classList.toggle('active', x === t))
  plActivePlatform = t.dataset.p
  loadPlaylists()
}))
$('#pl-search-btn').addEventListener('click', async () => {
  const kw = $('#pl-keyword').value.trim()
  if (!kw) return toast('请输入关键词')
  $('#pl-detail').hidden = true
  $('#pl-grid').hidden = false
  $('#pl-status').innerHTML = '<div class="status">搜索中…</div>'
  try {
    const url = `/api/v1/square/search?keyword=${encodeURIComponent(kw)}` + (plActivePlatform ? `&platforms=${plActivePlatform}` : '')
    const d = await fetchJSON(url)
    const groups = (d.results || []).filter((r) => r.ok && r.list.length).map((r) => ({ keyword: PLATFORM_NAME[r.platform] || r.platform, items: r.list }))
    renderPlaylistGrid(groups)
  } catch (err) { $('#pl-status').innerHTML = `<div class="status err">${escapeHtml(err.message)}</div>` }
})
$('#pl-refresh-btn').addEventListener('click', loadPlaylists)

async function openPlaylistDetail(platform, id, name) {
  $('#pl-grid').hidden = true
  $('#pl-detail').hidden = false
  $('#pl-status').innerHTML = `<div class="status">加载 ${escapeHtml(name)} …</div>`
  // 进详情清空旧创建勾选
  state.selectedForCreate = new Set()
  state.matchMap = new Map()
  state.createMap = new Map()
  updateGlobalCreateBtn()
  try {
    const d = await fetchJSON(`/api/v1/square/detail?platform=${encodeURIComponent(platform)}&id=${encodeURIComponent(id)}`)
    const list = d.detail?.list || []
    // 设置创建歌单默认名/图（从歌单详情带过来）
    state.createCtx = { name: d.detail?.info?.name || name, cover: d.detail?.info?.img || '' }
    state.results = list.map((s) => ({ ...s, platform }))
    // 匹配分组
    const songs = list.map((s) => ({ title: s.name, artist: s.singer, source: platform }))
    const m = await fetchJSON('/api/v1/navidrome/match/songs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ songs }) })
    const map = new Map(m.results.map((r) => [r.index, r]))
    state.matchMap = new Map()
    state.createMap = new Map()
    const matched = [], unmatched = []
    list.forEach((s, i) => {
      const r = map.get(i)
      const it = { ...s, platform }
      if (r?.matched) {
        state.matchMap.set(rowKey(it), r)
        state.createMap.set(rowKey(it), { libId: r.libId, title: r.libTitle, artist: r.libArtist, platform })
        matched.push(it)
      } else {
        unmatched.push(it)
      }
    })
    renderPlaylistDetail(name, platform, matched, unmatched)
  } catch (err) {
    $('#pl-status').innerHTML = `<div class="status err">${escapeHtml(err.message)}</div>`
  }
}
function renderPlaylistDetail(name, platform, matched, unmatched) {
  const el = $('#pl-detail')
  const matchedCards = matched.map((it) => {
    const key = rowKey(it)
    const m = state.matchMap.get(key)
    return `<div class="song-card" data-key="${key}">
      <div class="song-card-top">
        <input type="checkbox" class="create-chk" data-key="${key}" data-matched="1" title="勾选创建歌单">
        <div class="song-card-info">
          <div class="song-card-title">${escapeHtml(it.name)}</div>
          <div class="song-card-artist">${escapeHtml(it.singer)}${it.albumName ? ' · ' + escapeHtml(it.albumName) : ''}</div>
        </div>
      </div>
      <div class="song-card-bottom">
        <span class="match-col"><span class="ok">✓已在曲库${m?.isFuzzy ? ' (模糊)' : ''}</span></span>
        <div class="song-card-act">
          <button class="preview-btn" data-key="${key}">▶试听</button>
          <button class="dl-one disabled" data-key="${key}" disabled title="已在曲库">⬇下载</button>
        </div>
      </div>
    </div>`
  }).join('')
  const unmatchedCards = unmatched.map((it) => {
    const key = rowKey(it)
    return `<div class="song-card" data-key="${key}">
      <div class="song-card-top">
        <input type="checkbox" class="create-chk" data-key="${key}" data-matched="0" style="visibility:hidden">
        <div class="song-card-info">
          <div class="song-card-title">${escapeHtml(it.name)}</div>
          <div class="song-card-artist">${escapeHtml(it.singer)}${it.albumName ? ' · ' + escapeHtml(it.albumName) : ''}</div>
        </div>
      </div>
      <div class="song-card-bottom">
        <span class="match-col"><span class="muted">未收录</span></span>
        <div class="song-card-act">
          <button class="preview-btn" data-key="${key}">▶试听</button>
          <button class="dl-one" data-key="${key}">⬇下载</button>
        </div>
      </div>
    </div>`
  }).join('')
  el.innerHTML = `
    <button id="pl-back" class="linkbtn" style="margin:4px 0 10px;padding:6px 12px;background:var(--hover);border:1px solid var(--border);border-radius:6px;cursor:pointer">← 返回歌单列表</button>
    <h3 style="margin:0 0 10px">${escapeHtml(name)} · 共 ${matched.length + unmatched.length} 首（已匹配 ${matched.length} · 未匹配 ${unmatched.length}）</h3>
    ${matched.length ? `<h4 style="color:var(--ok);margin:12px 0 6px">✓ 已在曲库（${matched.length}）</h4><div class="song-grid">${matchedCards}</div>` : ''}
    ${unmatched.length ? `<h4 style="color:var(--text-muted);margin:16px 0 6px">未匹配 ${unmatched.length} 首（可试听/下载补库）</h4><div class="song-grid">${unmatchedCards}</div>` : ''}`
  $('#pl-back').addEventListener('click', () => { $('#pl-detail').hidden = true; $('#pl-grid').hidden = false })
  bindSongCardEvents(el)
}

// ---------- 任务（步骤3改为悬浮球，先保留 loadTasks/renderTasks 供复用）----------

// ---------- 下载任务（全局轮询 + 悬浮球面板）----------
let dlPollTimer = null
let dlActiveCount = 0

async function fetchTasks() {
  try { return (await fetchJSON('/api/v1/tasks')).tasks || [] } catch { return [] }
}

function startGlobalTasksPolling() {
  if (dlPollTimer) return
  dlPollTimer = setInterval(globalTasksTick, 3000)
  globalTasksTick()
}
async function globalTasksTick() {
  const tasks = await fetchTasks()
  dlActiveCount = tasks.filter((t) => t.status === 'active' || t.status === 'pending').length
  const badge = $('#float-dl-badge')
  badge.textContent = dlActiveCount
  badge.hidden = dlActiveCount === 0
  // 面板打开时才刷新列表
  if ($('#float-dl-panel').classList.contains('show')) {
    renderTasksInto('#float-dl-list', '#float-dl-summary', tasks)
  }
}

function renderTasksInto(listSel, summarySel, tasks) {
  const summary = { pending: 0, active: 0, completed: 0, failed: 0 }
  tasks.forEach((t) => {
    if (t.status === 'completed' || t.status === 'completed_with_warnings') summary.completed++
    else if (t.status === 'failed' || t.status === 'canceled') summary.failed++
    else if (t.status === 'active') summary.active++
    else summary.pending++
  })
  if (summarySel) $(summarySel).textContent = `进行中 ${summary.active} · 等待 ${summary.pending} · 完成 ${summary.completed} · 失败 ${summary.failed}`
  const container = $(listSel)
  if (!container) return
  if (!tasks.length) { container.innerHTML = '<div class="empty">暂无任务</div>'; return }

  const cards = tasks.map((t) => {
    const q = t.actualQuality ? `${t.actualQuality}` : (t.requestedQuality || '')
    const warn = (t.warnings && t.warnings.length) ? ` ⚠️${t.warnings.length}` : ''
    const actions = (t.status === 'failed' || t.status === 'canceled' || t.status === 'completed_with_warnings')
      ? `<button data-retry="${t.id}">重试</button> `
      : (t.status === 'pending' || t.status === 'active') ? `<button data-cancel="${t.id}">取消</button> ` : ''
    const scrape = t.scrape_status ? `<span class="badge q">刮削:${escapeHtml(t.scrape_status)}</span>` : ''
    return `<div class="task-card">
      <div class="task-card-top">
        <div class="task-card-title">${escapeHtml(t.name)} <span class="task-card-singer">- ${escapeHtml(t.singer)}</span></div>
        <button data-del="${t.id}" class="task-card-del">×</button>
      </div>
      <div class="task-card-meta">
        <span class="badge">${PLATFORM_NAME[t.platform] || t.platform}</span>
        <span class="badge q">${q}</span>
        ${t.actualSource ? `<span class="badge">${escapeHtml(t.actualSource)}</span>` : ''}
        ${scrape}
        <span class="st ${t.status}">${statusLabel(t.status)}${warn}</span>
      </div>
      <div class="task-card-progress">${t.progress || 0}%<div class="progress-bar"><div style="width:${t.progress || 0}%"></div></div></div>
      <div class="task-card-act">${actions}</div>
    </div>`
  }).join('')
  container.innerHTML = `<div class="task-card-list">${cards}</div>`

  container.querySelectorAll('[data-retry]').forEach((b) => b.addEventListener('click', () => act(`/api/v1/tasks/${b.dataset.retry}/retry`, 'POST', '已重新入队')))
  container.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => act(`/api/v1/tasks/${b.dataset.cancel}/cancel`, 'POST', '已取消')))
  container.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => act(`/api/v1/tasks/${b.dataset.del}`, 'DELETE', '已删除')))
}

async function act(url, method, okMsg) {
  try { await fetchJSON(url, { method }); toast(okMsg); globalTasksTick() }
  catch (err) { toast(err.message) }
}

function statusLabel(s) {
  return { pending: '等待', active: '下载中', completed: '完成', completed_with_warnings: '完成(有警告)', failed: '失败', canceled: '已取消' }[s] || s
}

// 悬浮球交互
function toggleFloatPanel(name) {
  const dlPanel = $('#float-dl-panel')
  const crPanel = $('#float-create-panel')
  const target = name === 'download' ? dlPanel : crPanel
  const other = name === 'download' ? crPanel : dlPanel
  const wasShow = target.classList.contains('show')
  other.classList.remove('show')
  target.classList.toggle('show', !wasShow)
  $('#float-backdrop').classList.toggle('show', !wasShow)
  if (!wasShow && name === 'download') globalTasksTick()
  if (!wasShow && name === 'create') renderCreatePanel()
}
$('#float-dl-ball').addEventListener('click', () => toggleFloatPanel('download'))
$('#float-create-ball').addEventListener('click', () => {
  if (state.selectedForCreate.size === 0) return
  toggleFloatPanel('create')
})
$('#float-backdrop').addEventListener('click', () => {
  $('#float-dl-panel').classList.remove('show')
  $('#float-create-panel').classList.remove('show')
  $('#float-backdrop').classList.remove('show')
})
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) {
    const panel = e.target.closest('.float-panel')
    if (panel) panel.classList.remove('show')
    $('#float-backdrop').classList.remove('show')
  }
})

// ---------- 全局播放器 + 试听 ----------
let currentPreview = null
async function previewSong(platform, musicInfo, label) {
  const audio = $('#global-audio')
  const box = $('#global-player')
  const rid = `${platform}:${musicInfo.songmid}`
  // 切换：同一首正在播放则暂停
  if (audio.dataset.rid === rid && !audio.paused) { audio.pause(); return }
  $('#gp-title').textContent = label || `${musicInfo.name} - ${musicInfo.singer}`
  box.hidden = false
  audio.src = ''
  audio.dataset.proxyTried = ''
  try {
    const r = await fetchJSON('/api/v1/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, musicInfo, quality: '128k' }),
    })
    audio.src = r.url
    audio.dataset.rid = rid
    currentPreview = { platform, musicInfo, label }
    await audio.play().catch(() => {})
  } catch (err) {
    toast(`试听失败：${err.message}`)
    setTimeout(() => { if (audio.paused && !audio.src) box.hidden = true }, 1500)
  }
  audio.onerror = () => {
    if (audio.dataset.proxyTried || !audio.src) return
    audio.dataset.proxyTried = '1'
    // 防盗链：切流式代理
    const directUrl = audio.src
    audio.src = `/api/v1/preview/proxy?url=${encodeURIComponent(directUrl)}`
    audio.play().catch(() => toast('代理播放也失败，可能音源失效'))
  }
}
$('#gp-close').addEventListener('click', () => {
  const audio = $('#global-audio')
  audio.pause(); audio.src = ''; audio.dataset.proxyTried = ''
  $('#global-player').hidden = true
})

// ---------- 创建歌单悬浮球（步骤6完整实现，先加桩）----------
function updateGlobalCreateBtn() {
  const n = state.selectedForCreate.size
  const ball = $('#float-create-ball')
  $('#float-create-badge').textContent = n
  $('#float-create-badge').hidden = n === 0
  ball.classList.toggle('disabled', n === 0)
}
function renderCreatePanel() {
  const items = state.results.filter((it) => state.selectedForCreate.has(rowKey(it)))
  const rows = items.map((it) => `<tr><td>${escapeHtml(it.name)}</td><td>${escapeHtml(it.singer)}</td><td>${escapeHtml(PLATFORM_NAME[it.platform] || it.platform)}</td></tr>`).join('')
  const ctx = state.createCtx || { name: '', cover: '' }
  const defaultName = ctx.name || ''
  const coverHtml = ctx.cover
    ? `<img src="${escapeHtml(ctx.cover)}" style="width:48px;height:48px;border-radius:8px;object-fit:cover;margin-right:10px" onerror="this.style.display='none'">`
    : ''
  $('#float-create-panel').innerHTML = `
    <div class="float-panel-head"><b>✅ 创建 Navidrome 歌单（${items.length} 首）</b><button class="float-panel-close" data-close>×</button></div>
    <div style="display:flex;align-items:center;margin-bottom:10px">${coverHtml}
      <input type="text" id="create-pl-name" placeholder="歌单名称" class="name-in" value="${escapeHtml(defaultName)}">
    </div>
    <div style="max-height:200px;overflow-y:auto;margin-bottom:10px"><table class="card"><thead><tr><th>歌曲</th><th>歌手</th><th>平台</th></tr></thead><tbody>${rows}</tbody></table></div>
    <button id="create-pl-btn" class="create-btn">创建 Navidrome 歌单</button>`
  $('#create-pl-btn').addEventListener('click', async () => {
    const name = $('#create-pl-name').value.trim()
    if (!name) return toast('请输入歌单名称')
    const ids = items.map((it) => state.createMap.get(rowKey(it))?.libId).filter(Boolean)
    if (!ids.length) return toast('无有效歌曲')
    try {
      const d = await fetchJSON('/api/v1/navidrome/playlist/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, song_ids: ids }),
      })
      toast(`歌单「${name}」已创建（${d.songCount} 首）`)
      state.selectedForCreate.clear()
      $$('.create-chk').forEach((cb) => { cb.checked = false; cb.closest('.song-card')?.classList.remove('song-card-selected') })
      updateGlobalCreateBtn()
      $('#float-create-panel').classList.remove('show')
      $('#float-backdrop').classList.remove('show')
    } catch (err) { toast(`创建失败：${err.message}`) }
  })
}
updateGlobalCreateBtn()


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

// ---------- 常规设置（设置子页 general）----------
async function loadSettingsOriginal() {
  try {
    const s = await fetchJSON('/api/v1/settings')
    renderSettings(s)
  } catch (err) {
    $('#settings-general').innerHTML = `<div class="empty">加载失败: ${escapeHtml(err.message)}</div>`
  }
}

function renderSettings(s) {
  const d = s.download, sm = s.smokeTest, bark = sm.alert.bark, sc = sm.alert.serverChan
  const sc2 = s.scrape || { enabled: false, autoOnDownload: false, targetDir: '' }
  const apiKeySet = !!(s.auth && s.auth.apiKeySet)
  const qOpt = (v) => ['flac24bit', 'flac', '320k', '128k'].map((q) => `<option value="${q}" ${q === v ? 'selected' : ''}>${q}</option>`).join('')
  $('#settings-general').innerHTML = `
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
      <h3>刮削设置</h3>
      <div class="set-row"><label>启用刮削</label><input type="checkbox" id="set-scrape-en" ${sc2.enabled ? 'checked' : ''} /><span class="hint">关闭后下载完成不自动整理入库</span></div>
      <div class="set-row"><label>下载后自动刮削</label><input type="checkbox" id="set-scrape-auto" ${sc2.autoOnDownload ? 'checked' : ''} /></div>
      <div class="set-row"><label>整理目录</label><input type="text" id="set-scrape-dir" value="${escapeHtml(sc2.targetDir)}" /><span class="hint">需映射到 Navidrome 音乐目录</span></div>
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
    loadSettingsOriginal()
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
    scrape: {
      enabled: $('#set-scrape-en').checked,
      autoOnDownload: $('#set-scrape-auto').checked,
      targetDir: $('#set-scrape-dir').value,
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
    loadSettingsOriginal()
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
    // 启动全局下载任务轮询（悬浮球角标）
    startGlobalTasksPolling()
    // 顶部条：曲库状态 + 个人中心
    initProfileMenu()
    checkTopStatus()
    setInterval(checkTopStatus, 15000)
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

// ---------- 设置子页切换（步骤8完整实现，先加桩）----------
function switchSettingsSub(sub) {
  $$('#settings-tabs .ptab').forEach((x) => x.classList.toggle('active', x.dataset.sub === sub))
  $$('.settings-sub').forEach((s) => { s.hidden = s.id !== `settings-${sub}` })
  if (sub === 'general') loadSettingsOriginal()
  if (sub === 'library') loadLibrary()
  if (sub === 'ai-playlist') loadAiInit()
  if (sub === 'scrape') loadScrape()
  if (sub === 'health') loadHealth()
}
$$('#settings-tabs .ptab').forEach((t) => t.addEventListener('click', () => switchSettingsSub(t.dataset.sub)))
initSidebar()
