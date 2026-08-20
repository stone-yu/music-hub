'use strict'

const $ = (sel) => document.querySelector(sel)
const $$ = (sel) => Array.from(document.querySelectorAll(sel))

const state = {
  results: [],       // 扁平化的歌曲列表（含 platform）
  selected: new Set(), // 批量下载选中项 key
  selectedForCreate: new Set(), // 创建歌单选中项（已匹配歌曲的 rowKey）
  matchMap: new Map(), // rowKey → 匹配结果（matched/libId/isFuzzy）
  createMap: new Map(), // rowKey → {libId,title,artist} 已匹配歌曲信息（创建球用）
  createCtx: { name: '', cover: '', desc: '' }, // 创建歌单默认名/图/描述（网络歌单详情带过来，单曲搜索页为空）
  quality: 'flac',
}

const PLATFORM_NAME = { kw: '酷我', kg: '酷狗', tx: 'QQ音乐', wy: '网易云', mg: '咪咕' }
const QUALITIES = [
  { v: 'flac24bit', label: 'Hi-Res 无损', desc: 'flac24bit 最高音质' },
  { v: 'flac', label: '无损 FLAC', desc: 'flac 高保真' },
  { v: '320k', label: '高品 320k', desc: '320kbps MP3' },
  { v: '128k', label: '标准 128k', desc: '128kbps MP3' },
]
// 下载时选择音质：自定义弹框展示音质+大小，返回 Promise<quality>
async function pickQuality(musicInfo) {
  // 从 musicInfo.types 取各音质大小；为空时（如热榜歌曲）实时搜该平台补全
  let typeMap = {}
  if (musicInfo?.types?.length) {
    musicInfo.types.forEach((t) => { typeMap[t.type] = t.size })
  } else if (musicInfo?.name && musicInfo?.source) {
    try {
      const kw = `${musicInfo.name} ${musicInfo.singer || ''}`.trim()
      const r = await fetchJSON(`/api/v1/search?keyword=${encodeURIComponent(kw)}&platform=${encodeURIComponent(musicInfo.source)}&page=1`)
      const first = (r.list || [])[0]
      if (first?.types?.length) {
        first.types.forEach((t) => { typeMap[t.type] = t.size })
        // 回填到 musicInfo 供后续下载用
        musicInfo.types = first.types
        musicInfo._types = first._types
      }
    } catch { /* 查询失败按未知处理 */ }
  }
  if (musicInfo?._types) Object.entries(musicInfo._types).forEach(([k, v]) => { if (v?.size && !typeMap[k]) typeMap[k] = v.size })

  return new Promise((resolve) => {
    const modal = $('#quality-modal')
    const list = $('#quality-modal-list')
    list.innerHTML = QUALITIES.map((q) => {
      const size = typeMap[q.v]
      const sizeHtml = size ? `<div class="q-size">${escapeHtml(String(size))}</div>` : `<div class="q-size">未知大小</div>`
      return `<div class="quality-row" data-q="${q.v}">
        <div class="q-label"><div class="q-name">${escapeHtml(q.label)}</div>${sizeHtml}</div>
        <button class="q-dl">下载</button>
      </div>`
    }).join('')
    modal.hidden = false
    const close = (val) => { modal.hidden = true; resolve(val) }
    $('#quality-modal-close').onclick = () => close(null)
    modal.onclick = (e) => { if (e.target === modal) close(null) }
    list.querySelectorAll('.quality-row').forEach((row) => {
      row.querySelector('.q-dl').onclick = () => close(row.dataset.q)
    })
  })
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
// 歌曲头图（有 img 显示图片，无则音符占位）
function coverHtml(img) {
  if (img) return `<img class="song-card-cover" src="${escapeHtml(img)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="song-card-icon" style="display:none">🎵</span>`
  return `<span class="song-card-icon">🎵</span>`
}

// ---------- 左侧菜单 ----------
function initSidebar() {
  // 默认根据 localStorage 决定开/关（PC 端默认展开，首次无记录时展开）
  const pref = localStorage.getItem('sidebar-open')
  const defaultOpen = pref === null ? true : pref === '1'
  document.body.classList.toggle('sidebar-open', defaultOpen)
  $('#sidebar-toggle').addEventListener('click', () => {
    const open = !document.body.classList.contains('sidebar-open')
    document.body.classList.toggle('sidebar-open', open)
    $('#sidebar-backdrop').classList.toggle('show', open && window.innerWidth <= 768)
    localStorage.setItem('sidebar-open', open ? '1' : '0')
  })
  $('#sidebar-backdrop').addEventListener('click', () => {
    document.body.classList.remove('sidebar-open')
    $('#sidebar-backdrop').classList.remove('show')
    localStorage.setItem('sidebar-open', '0')
  })
}

// ---------- 菜单分组折叠 ----------
function initMenuGroups() {
  $$('.menu-group').forEach((g) => {
    const key = `menu-group:${g.dataset.group}`
    const head = g.querySelector('.menu-group-head')
    // 恢复折叠状态（默认展开）
    if (localStorage.getItem(key) === '1') g.classList.add('collapsed')
    head.addEventListener('click', () => {
      g.classList.toggle('collapsed')
      localStorage.setItem(key, g.classList.contains('collapsed') ? '1' : '0')
    })
  })
}

// ---------- 主题切换（亮色/暗色）----------
function initTheme() {
  const saved = localStorage.getItem('theme') || 'light'
  applyTheme(saved)
  $('#theme-toggle').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') || 'light'
    applyTheme(cur === 'light' ? 'dark' : 'light')
  })
}
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light')
  localStorage.setItem('theme', t)
  const btn = $('#theme-toggle')
  if (!btn) return
  // 暗色显示太阳(点切回亮)，亮色显示月亮(点切到暗)
  const sun = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>'
  const moon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>'
  btn.innerHTML = t === 'dark' ? sun : moon
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
    if (name === 'library') loadLibraryStats()
    if (name === 'lib-songs') loadLibSongs()
    if (name === 'lib-playlists') loadLibPlaylists()
    if (name === 'settings') switchSettingsSub('general')
    if (name === 'search') loadSearchSquare()
    if (name === 'net-radio') loadNetRadio()
    if (name === 'local-radio') loadLocalRadio()
  })
})

// 搜索页热榜推荐（未搜索时显示，直接展示榜单歌曲）
// 缓存持久化到 localStorage（10分钟过期），避免每次登录重载慢
const RANK_CACHE_TTL = 30 * 60 * 1000
function getRankCache(key) {
  try {
    const raw = localStorage.getItem('rank:' + key)
    if (!raw) return null
    const obj = JSON.parse(raw)
    if (Date.now() - obj.ts > RANK_CACHE_TTL) return null
    return obj.list
  } catch { return null }
}
function setRankCache(key, list) {
  try { localStorage.setItem('rank:' + key, JSON.stringify({ ts: Date.now(), list })) } catch { /* quota */ }
}
let activeRankTab = null

async function loadSearchSquare() {
  // 切到热榜首页（隐藏搜索结果页）
  $('#search-home').hidden = false
  $('#search-results-page').hidden = true
  // 默认选第一个榜单标签
  const firstTab = $('#rank-tabs .ptab.active') || $('#rank-tabs .ptab')
  if (firstTab) {
    activeRankTab = firstTab
    await loadRankSongs(firstTab.dataset.src, firstTab.dataset.id, firstTab.dataset.name)
  }
}
// 返回热榜
$('#search-back').addEventListener('click', loadSearchSquare)

// 榜单标签切换
$$('#rank-tabs .ptab').forEach((t) => t.addEventListener('click', () => {
  $$('#rank-tabs .ptab').forEach((x) => x.classList.toggle('active', x === t))
  activeRankTab = t
  loadRankSongs(t.dataset.src, t.dataset.id, t.dataset.name)
}))
$('#rank-refresh').addEventListener('click', () => {
  if (!activeRankTab) return
  localStorage.removeItem('rank:' + `${activeRankTab.dataset.src}:${activeRankTab.dataset.id}`)
  loadRankSongs(activeRankTab.dataset.src, activeRankTab.dataset.id, activeRankTab.dataset.name)
})

// 加载某榜单歌曲，渲染到 #search-square-list（卡片式 + 曲库匹配）
async function loadRankSongs(source, id, name) {
  const el = $('#search-square-list')
  if (!el) return
  const cacheKey = `${source}:${id}`
  el.innerHTML = '<div class="empty">加载中…</div>'
  state.results = []
  state.selectedForCreate.clear()
  state.matchMap = new Map()
  state.createMap = new Map()
  state.createCtx = { name: name + ' - 热榜', cover: '', desc: '' }
  updateGlobalCreateBtn()
  try {
    let list = getRankCache(cacheKey)
    if (!list) {
      const d = await fetchJSON(`/api/v1/ranks/${encodeURIComponent(source)}/${encodeURIComponent(id)}?limit=50`)
      list = d.list || []
      setRankCache(cacheKey, list)
    }
    const group = renderGroup(source, list, null)
    const h3 = group.querySelector('h3')
    if (h3) h3.textContent = `${name} · ${list.length} 首`
    el.innerHTML = ''
    el.appendChild(group)
    matchSearchResults()
  } catch (err) {
    el.innerHTML = `<div class="empty">加载失败：${escapeHtml(err.message)}</div>`
  }
}

// ---------- 搜索 ----------
$('#search-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const keyword = $('#keyword').value.trim()
  if (!keyword) return
  const platform = $('#platform').value
  // 切到搜索结果页
  $('#search-home').hidden = true
  $('#search-results-page').hidden = false
  $('#search-status').textContent = '搜索中…'
  $('#results').innerHTML = ''
  state.results = []
  state.selected.clear()
  state.selectedForCreate.clear()
  state.matchMap = new Map()
  state.createMap = new Map()
  state.createCtx = { name: '', cover: '', desc: '' }
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
        <div class="song-cover-wrap">
          ${coverHtml(item.img)}
          <div class="song-wave" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        </div>
        <div class="song-card-info">
          <div class="song-card-title">${escapeHtml(item.name)}</div>
          <div class="song-card-artist">${escapeHtml(item.singer)}${item.albumName ? ' · ' + escapeHtml(item.albumName) : ''}</div>
        </div>
      </div>
      <div class="song-card-bottom">
        <span class="match-col" data-key="${key}"><span class="pending">…</span></span>
        <div class="song-card-act">
          <button class="preview-btn" data-key="${key}">▶播放</button>
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
    const quality = await pickQuality(it)
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
  $$('.song-card[data-key]').forEach((card) => {
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

// ---------- 歌单广场（平台标签 + 搜歌单 + 详情已匹配/未匹配分组）----------
// 缓存持久化到 localStorage（10分钟过期）
let plActivePlatform = ''
function getPlCache(key) {
  try { const raw = localStorage.getItem('pl:' + key); if (!raw) return null
    const o = JSON.parse(raw); if (Date.now() - o.ts > RANK_CACHE_TTL) return null; return o.groups } catch { return null }
}
function setPlCache(key, groups) {
  try { localStorage.setItem('pl:' + key, JSON.stringify({ ts: Date.now(), groups })) } catch {}
}
async function loadPlaylists() {
  // 切到歌单首页
  $('#pl-home').hidden = false
  $('#pl-detail').hidden = true
  const cacheKey = plActivePlatform || 'all'
  const cached = getPlCache(cacheKey)
  if (cached) { renderPlaylistGrid(cached); return }
  $('#pl-status').innerHTML = '<div class="status">加载广场推荐…</div>'
  try {
    const d = await fetchJSON('/api/v1/square/hot' + (plActivePlatform ? `?platform=${plActivePlatform}` : ''))
    const groups = d.groups || []
    setPlCache(cacheKey, groups)
    renderPlaylistGrid(groups)
  } catch (err) {
    $('#pl-status').innerHTML = `<div class="status err">${escapeHtml(err.message)}</div>`
  }
}
// 统一歌单卡片 HTML（热榜歌单 / 曲库歌单 / 曲库概览 三处复用，避免样式漂移）
// p 归一化字段：name, cover(封面URL|空), count(歌曲数), desc(描述), playKind('net'|'nav'), dataSrc(网络歌单平台，可选)
function playlistCardHtml(p) {
  const cover = p.cover
    ? `<img src="${escapeHtml(p.cover)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
    : ''
  const placeholder = `<div class="pl-cover-ph" style="${p.cover ? 'display:none' : 'display:flex'}">${p.coverPh || '🎶'}</div>`
  const srcAttr = p.dataSrc ? ` data-src="${escapeHtml(p.dataSrc)}"` : ''
  return `<div class="pl-card" data-id="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name)}" data-play="${p.playKind}"${srcAttr}>
    <div class="pl-cover">${cover}${placeholder}
      <div class="pl-cover-bar">
        <span class="pl-bar-count">${p.count || 0} 首歌曲</span>
        <span class="pl-bar-dur">${fmtPlayDuration(p.count || 0)}</span>
      </div>
      <div class="pl-play-btn" aria-hidden="true">▶</div>
    </div>
    <div class="pl-name">${escapeHtml(p.name)}</div>
    <div class="pl-desc">${escapeHtml(p.desc || '')}</div>
  </div>`
}
// 绑定卡片：hover 播放按钮 → 整单播放（stopPropagation 不触发卡片进详情）
function bindPlaylistCards(scope, onPlay) {
  $$(`${scope} .pl-play-btn`).forEach((btn) => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); onPlay(btn.closest('.pl-card')) })
  })
}
// 统一歌单详情页顶部 header：封面 + 名称 + 描述 + 右侧[▶播放][循环模式]
// info: { cover, name, desc, count, onPlay(整单播放回调) }
function playlistDetailHeaderHtml(info) {
  const cover = info.cover
    ? `<img src="${escapeHtml(info.cover)}" class="pl-detail-cover" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="pl-detail-cover-ph" style="display:none">🎶</div>`
    : `<div class="pl-detail-cover-ph">🎶</div>`
  const editBtn = info.editable ? `<button class="pl-edit-btn" title="编辑歌单">✏️</button>` : ''
  const deleteBtn = info.editable ? `<button class="pl-delete-btn" title="删除歌单">🗑</button>` : ''
  const descLine = info.desc ? `<div class="pl-detail-desc">${escapeHtml(info.desc)}</div>` : ''
  const metaLine = info.meta ? `<div class="pl-detail-meta-info">${escapeHtml(info.meta)}</div>` : ''
  return `<div class="pl-detail-head">
    ${cover}
    <div class="pl-detail-meta">
      <h2 class="pl-detail-name">${escapeHtml(info.name)}</h2>
      ${descLine}
      <div class="pl-detail-bottom">
        ${metaLine}
        <div class="pl-detail-act">
          <button class="pl-detail-play">▶ 播放</button>
          <button class="pl-loop-btn" title="顺序播放">▶▶</button>
        ${editBtn}
        ${deleteBtn}
        </div>
      </div>
    </div>
  </div>`
}
// 绑定详情 header 的播放 + 循环按钮（+ 可选编辑/删除）
function bindDetailHeader(scope, onPlay, onEdit, onDelete) {
  const playBtn = $(`${scope} .pl-detail-play`)
  if (playBtn) playBtn.addEventListener('click', onPlay)
  const loopBtn = $(`${scope} .pl-loop-btn`)
  if (loopBtn) {
    updateLoopBtn() // 同步所有循环按钮图标
    loopBtn.addEventListener('click', cycleLoopMode)
  }
  if (onEdit) {
    const editBtn = $(`${scope} .pl-edit-btn`)
    if (editBtn) editBtn.addEventListener('click', onEdit)
  }
  if (onDelete) {
    const delBtn = $(`${scope} .pl-delete-btn`)
    if (delBtn) delBtn.addEventListener('click', onDelete)
  }
}
// header 原地编辑：名称/描述 → 输入框，保存调 onSave(name,desc) 返回 Promise
function enterDetailEdit(scope, name, desc, onSave) {
  const meta = $(`${scope} .pl-detail-meta`)
  if (!meta) return
  meta.innerHTML = `
    <div class="pl-detail-edit-form">
      <input type="text" id="pl-edit-name" value="${escapeHtml(name)}" placeholder="歌单名称">
      <textarea id="pl-edit-desc" placeholder="歌单描述（可选）">${escapeHtml(desc || '')}</textarea>
      <div class="pl-detail-edit-btns">
        <button class="pl-detail-save">保存</button>
        <button class="pl-detail-cancel">取消</button>
      </div>
    </div>`
  const nameInp = $('#pl-edit-name'), descInp = $('#pl-edit-desc')
  $(`${scope} .pl-detail-save`).addEventListener('click', async () => {
    const n = nameInp.value.trim(), d = descInp.value.trim()
    if (!n) return toast('歌单名称不能为空')
    try { await onSave(n, d) } catch (e) { toast(`保存失败：${e.message}`) }
  })
  $(`${scope} .pl-detail-cancel`).addEventListener('click', () => {
    // 取消：重新拉取详情刷新（恢复原值）
    const el = $(scope)
    if (el?.dataset.playlistId) openLibPlaylistDetail(el.dataset.playlistId, name)
  })
}
function renderPlaylistGrid(groups) {
  const parts = groups.map((g) => {
    const cards = (g.items || []).map((p) => playlistCardHtml({
      id: p.id, name: p.name, cover: p.img, count: p.total, desc: p.desc,
      playKind: 'net', coverPh: '🎶', dataSrc: p.source,
    })).join('')
    return `<h3 class="platform-group" style="border-left:3px solid var(--accent);padding-left:6px;font-size:14px;color:#555;margin:12px 0 8px">${escapeHtml(g.keyword)}</h3><div class="pl-grid">${cards}</div>`
  })
  $('#pl-status').innerHTML = ''
  $('#pl-grid').innerHTML = parts.join('') || '<div class="empty">无结果</div>'
  // 卡片整体点击 → 进详情
  $$('#pl-grid .pl-card').forEach((card) => card.addEventListener('click', () => openPlaylistDetail(card.dataset.src, card.dataset.id, card.dataset.name)))
  // hover 播放按钮 → 整单播放（网络歌单需先取 square/detail 的歌曲列表）
  bindPlaylistCards('#pl-grid', async (card) => {
    const src = card.dataset.src, id = card.dataset.id, name = card.dataset.name
    const cover = card.querySelector('.pl-cover img')?.src || ''
    toast(`加载《${name}》歌曲列表…`)
    try {
      const d = await fetchJSON(`/api/v1/square/detail?platform=${encodeURIComponent(src)}&id=${encodeURIComponent(id)}`)
      const list = d.detail?.list || []
      playNetPlaylist({ name, cover }, list)
    } catch (err) { toast(`播放失败：${err.message}`) }
  })
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
  $('#pl-home').hidden = false
  $('#pl-status').innerHTML = '<div class="status">搜索中…</div>'
  try {
    const url = `/api/v1/square/search?keyword=${encodeURIComponent(kw)}` + (plActivePlatform ? `&platforms=${plActivePlatform}` : '')
    const d = await fetchJSON(url)
    const groups = (d.results || []).filter((r) => r.ok && r.list.length).map((r) => ({ keyword: PLATFORM_NAME[r.platform] || r.platform, items: r.list }))
    renderPlaylistGrid(groups)
  } catch (err) { $('#pl-status').innerHTML = `<div class="status err">${escapeHtml(err.message)}</div>` }
})
$('#pl-refresh-btn').addEventListener('click', () => {
  // 清所有 pl: 缓存
  Object.keys(localStorage).filter((k) => k.startsWith('pl:')).forEach((k) => localStorage.removeItem(k))
  loadPlaylists()
})

async function openPlaylistDetail(platform, id, name) {
  $('#pl-home').hidden = true
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
    const info = d.detail?.info || {}
    // 设置创建歌单默认名/图/描述（从歌单详情带过来）
    state.createCtx = { name: info.name || name, cover: info.img || '', desc: info.desc || '' }
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
    renderPlaylistDetail({ name: info.name || name, cover: info.img, desc: info.desc, platform, matched, unmatched, all: list.map((s) => ({ ...s, platform })) })
  } catch (err) {
    $('#pl-status').innerHTML = `<div class="status err">${escapeHtml(err.message)}</div>`
  }
}
function renderPlaylistDetail(info) {
  const { name, cover, desc, platform, matched, unmatched, all } = info
  const el = $('#pl-detail')
  // 合并成一栏：按 all 原始顺序，每张卡片标识是否已在曲库
  const cards = (all || [...matched, ...unmatched]).map((it) => {
    const key = rowKey(it)
    const m = state.matchMap.get(key)
    const isMatched = !!m?.matched
    const matchBadge = isMatched
      ? `<span class="ok">✓已在曲库${m.isFuzzy ? ' (模糊)' : ''}</span>`
      : `<span class="muted">未收录</span>`
    const dlBtn = isMatched
      ? `<button class="dl-one disabled" data-key="${key}" disabled title="已在曲库">⬇下载</button>`
      : `<button class="dl-one" data-key="${key}">⬇下载</button>`
    return `<div class="song-card" data-key="${key}">
      <div class="song-card-top">
        <input type="checkbox" class="create-chk" data-key="${key}" data-matched="${isMatched ? 1 : 0}" ${isMatched ? '' : 'style="visibility:hidden"'} title="勾选创建歌单">
        <div class="song-cover-wrap">
          ${coverHtml(it.img)}
          <div class="song-wave" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        </div>
        <div class="song-card-info">
          <div class="song-card-title">${escapeHtml(it.name)}</div>
          <div class="song-card-artist">${escapeHtml(it.singer)}${it.albumName ? ' · ' + escapeHtml(it.albumName) : ''}</div>
        </div>
      </div>
      <div class="song-card-bottom">
        <span class="match-col">${matchBadge}</span>
        <div class="song-card-act">
          <button class="preview-btn" data-key="${key}">▶播放</button>
          ${dlBtn}
        </div>
      </div>
    </div>`
  }).join('')
  el.innerHTML = `
    <button id="pl-back" class="back-btn" style="margin-bottom:10px">← 返回歌单列表</button>
    ${playlistDetailHeaderHtml({ cover, name, desc: desc || '', meta: `共 ${matched.length + unmatched.length} 首歌曲 · 已匹配 ${matched.length}` })}
    <div class="toolbar" style="margin:10px 0">
      <button id="pl-select-all-matched" ${matched.length ? '' : 'disabled'}>勾选所有已在曲库</button>
      <span class="muted" style="font-size:12px">共 ${matched.length + unmatched.length} 首 · 已匹配 ${matched.length}</span>
    </div>
    <div class="song-grid">${cards}</div>`
  $('#pl-back').addEventListener('click', () => { $('#pl-detail').hidden = true; $('#pl-home').hidden = false })
  // 批量勾选所有已在曲库的歌曲
  $('#pl-select-all-matched')?.addEventListener('click', () => {
    $$('#pl-detail .create-chk[data-matched="1"]').forEach((cb) => {
      cb.checked = true
      cb.closest('.song-card')?.classList.add('song-card-selected')
      state.selectedForCreate.add(cb.dataset.key)
    })
    updateGlobalCreateBtn()
    toast(`已勾选 ${matched.length} 首已在曲库歌曲`)
  })
  bindDetailHeader('#pl-detail', () => playNetPlaylist({ name, cover }, all || [...matched, ...unmatched]))
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

// ---------- 全局播放器 + 播放队列 ----------
// playQueue 统一两种来源：nav=Navidrome 库内歌曲（/stream/:id 直播），net=网络音源（/preview 取链）
// 单首播放 = 长度为 1 的队列。整单播放 = 塞入全部歌曲后从第一首开始，ended 自动切下一首。
let playQueue = []
let playIndex = -1
let currentPreview = null
// 当前播放歌单元信息（队列面板顶部展示：封面+名称）
let currentPlaylist = { cover: '', name: '' }
// 播放/暂停 SVG 图标（主播放键切换）
const PLAY_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
const PAUSE_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>'
function setPlayIcon(playing) {
  const icon = playing ? PAUSE_ICON : PLAY_ICON
  $('#gp-play').innerHTML = icon
  // 同步队列面板大封面的播放按钮
  const qBtn = document.querySelector('.queue-now-play')
  if (qBtn) qBtn.innerHTML = icon
}
// 循环模式：order=顺序(播完停止) / single=单曲循环(重播当前) / random=随机播放(随机选一首)。仅当前队列作用域。
let loopMode = 'order'
// 线性 SVG 图标（顺序/单曲/随机），非顺序态在按钮上显示激活色
const LOOP_SVG = {
  order: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
  single: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><text x="12" y="15" font-size="9" fill="currentColor" stroke="none" text-anchor="middle" font-weight="600">1</text></svg>',
  random: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></svg>',
}
const LOOP_MODES = [
  { key: 'order', title: '顺序播放' },
  { key: 'single', title: '单曲循环' },
  { key: 'random', title: '随机播放' },
]
// 试听中卡片状态：rid = platform:songmid = 卡片 data-key，直接定位
function setPlayingCard(rid) {
  document.querySelectorAll('.song-card.playing').forEach((c) => c.classList.remove('playing', 'paused'))
  if (rid) document.querySelector(`.song-card[data-key="${rid}"]`)?.classList.add('playing')
}
function resetPlayerCover() { $('#gp-icon').innerHTML = '🎵' }
// 广播电台直播流：销毁 hls 实例，避免流泄漏
function destroyHls() {
  if (window._radioHls) { try { window._radioHls.destroy() } catch { /* noop */ } window._radioHls = null }
}
// 直播流 UI：进度条置灰/恢复
function setRadioLiveUI(live) {
  const progress = $('#gp-progress')
  if (!progress) return
  progress.classList.toggle('disabled', !!live)
}
// 流失效重试：重新取流地址(key 过期) 再播
async function retryRadioStream(slug) {
  try {
    const s = await fetchJSON(`/api/v1/radio5/stream/${encodeURIComponent(slug)}`)
    const audio = $('#global-audio')
    destroyHls()
    if (window.Hls && Hls.isSupported()) {
      const hls = new Hls()
      window._radioHls = hls
      hls.loadSource(s.streamUrl)
      hls.attachMedia(audio)
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) { toast('电台流播放失败'); stopPlayer() }
      })
      audio.play().catch(() => {})
    } else {
      audio.src = s.streamUrl
      audio.play().catch(() => {})
    }
  } catch { toast('重试取流失败'); stopPlayer() }
}
function clearLibSongHighlight() { document.querySelector('.lib-song-card.playing')?.classList.remove('playing') }

// 启动队列：清空 → 塞入 items → 从第一首播。新队列重置循环模式为顺序（仅当前队列作用域）
function startQueue(items, plInfo) {
  if (!items?.length) { toast('歌单内暂无歌曲'); return }
  playQueue = items.slice()
  playIndex = 0
  loopMode = 'order'
  // 队列面板顶部歌单元信息：传入则用，否则用第一首的封面/标题
  currentPlaylist = plInfo || { cover: items[0]?.cover || '', name: items[0]?.label || '' }
  updateLoopBtn()
  playCurrent()
  renderQueuePanel()
}
// 播放当前队列项（按来源取流）
async function playCurrent() {
  const item = playQueue[playIndex]
  if (!item) return
  const audio = $('#global-audio')
  const box = $('#global-player')
  $('#gp-title').textContent = item.label
  $('#gp-sub').textContent = playQueue.length > 1 ? `${playIndex + 1} / ${playQueue.length} · 播放列表` : '试听'
  $('#gp-icon').innerHTML = coverHtml(item.cover)
  box.hidden = false
  audio.onerror = null // 先清旧 onerror，避免清空 src 中断旧流时误触发「播放失败」
  audio.src = ''
  audio.dataset.proxyTried = ''
  // 清理上一首 radio 专属状态：无论切到什么 kind 都先销毁 hls 实例并重置重试标志
  destroyHls()
  audio.dataset.radioRetry = ''
  setRadioLiveUI(false)
  renderQueuePanel() // 同步队列面板当前项高亮
  if (item.kind === 'radio') {
    // 广播电台直播流：HLS(m3u8) 用 hls.js，mp3 直链用原生 audio
    audio.dataset.rid = `radio:${item.slug || item.streamUrl}`
    audio.dataset.proxyTried = 'done'
    setRadioLiveUI(true) // 直播流：进度条置灰
    if (item.isHls && window.Hls && Hls.isSupported()) {
      destroyHls()
      const hls = new Hls()
      window._radioHls = hls
      hls.loadSource(item.streamUrl)
      hls.attachMedia(audio)
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          // 致命错误：流失效(key过期等)，重取一次
          if (!audio.dataset.radioRetry && item.slug) {
            audio.dataset.radioRetry = '1'
            retryRadioStream(item.slug)
          } else {
            toast('电台流播放失败')
            stopPlayer()
          }
        }
      })
      audio.play().catch(() => toast('播放失败，可能流已失效'))
    } else {
      // 非 HLS 或 Safari 原生支持 m3u8 / mp3 直链
      audio.src = item.streamUrl
      audio.play().catch(() => toast('播放失败，可能流已失效'))
      audio.onerror = () => {
        if (!audio.dataset.radioRetry && item.slug) {
          audio.dataset.radioRetry = '1'
          retryRadioStream(item.slug)
        } else { toast('电台流播放失败'); stopPlayer() }
      }
    }
  } else if (item.kind === 'nav') {
    // Navidrome 库内：/stream/:id 直播，无需 preview 代理重试
    audio.src = `/api/v1/navidrome/stream/${encodeURIComponent(item.id)}`
    audio.dataset.rid = `lib:${item.id}`
    audio.dataset.proxyTried = 'done'
    audio.play().catch(() => toast('播放失败，可能 Navidrome 未连接'))
    audio.onerror = () => { toast('播放失败，可能 Navidrome 未连接') }
  } else {
    // 网络音源：/preview 取 128k 直链
    try {
      const r = await fetchJSON('/api/v1/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: item.platform, musicInfo: item.musicInfo, quality: '128k' }),
      })
      audio.src = r.url
      audio.dataset.rid = `${item.platform}:${item.musicInfo.songmid}`
      currentPreview = { platform: item.platform, musicInfo: item.musicInfo, label: item.label }
      await audio.play().catch(() => {})
      // 直链失败：切流式代理重试一次
      audio.onerror = () => {
        if (audio.dataset.proxyTried === 'done' || !audio.src) return
        if (audio.dataset.proxyTried === '1') {
          audio.dataset.proxyTried = 'done'
          return // 代理也失败：静默，靠 onended 跳下一首
        }
        audio.dataset.proxyTried = '1'
        const directUrl = audio.src
        audio.src = `/api/v1/preview/proxy?url=${encodeURIComponent(directUrl)}`
        audio.play().catch(() => { /* 静默 */ })
      }
    } catch {
      // 取链失败：静默跳下一首，全队列失败才有 ended 兜底
      advanceQueue()
    }
  }
}
// 切下一首（onended 触发），按 loopMode：
//   order=顺序(越界停止) / single=单曲循环(重播当前) / random=随机播放(随机选一首，避免重复当前)
function advanceQueue() {
  if (loopMode === 'single' && playQueue.length) {
    const audio = $('#global-audio')
    audio.currentTime = 0
    audio.play().catch(() => {})
    return
  }
  if (loopMode === 'random' && playQueue.length > 1) {
    let next = playIndex
    while (next === playIndex) next = Math.floor(Math.random() * playQueue.length)
    playIndex = next
    playCurrent()
    return
  }
  playIndex++
  if (playIndex < playQueue.length) playCurrent()
  else if (loopMode === 'random' && playQueue.length) { playIndex = Math.floor(Math.random() * playQueue.length); playCurrent() }
  else stopPlayer()
}
// 上一首：index--，越界到末首
function playPrev() {
  if (!playQueue.length) return
  playIndex--
  if (playIndex < 0) playIndex = playQueue.length - 1
  playCurrent()
}
// 下一首（手动触发，不区分单曲循环）：越界按 loopMode 处理
function playNext() {
  if (!playQueue.length) return
  if (loopMode === 'random' && playQueue.length > 1) {
    let next = playIndex
    while (next === playIndex) next = Math.floor(Math.random() * playQueue.length)
    playIndex = next
    playCurrent()
    return
  }
  playIndex++
  if (playIndex < playQueue.length) playCurrent()
  else if (loopMode === 'list' || loopMode === 'random') { playIndex = 0; playCurrent() }
  else stopPlayer()
}
// 循环模式按钮：点击循环切档 order→single→random→order
function cycleLoopMode() {
  const idx = LOOP_MODES.findIndex((m) => m.key === loopMode)
  loopMode = LOOP_MODES[(idx + 1) % LOOP_MODES.length].key
  updateLoopBtn()
  toast(LOOP_MODES.find((m) => m.key === loopMode).title)
}
// 同步所有循环按钮（详情 header .pl-loop-btn + 播放条 #gp-loop-btn）图标/标题
// 同步所有循环按钮（详情 header .pl-loop-btn + 播放条 #gp-loop-btn）SVG 图标/标题/激活态
function updateLoopBtn() {
  const m = LOOP_MODES.find((x) => x.key === loopMode)
  const active = loopMode !== 'order' // 非顺序态显示激活色
  const apply = (el) => {
    el.innerHTML = LOOP_SVG[loopMode]
    el.title = m.title
    el.classList.toggle('active', active)
  }
  document.querySelectorAll('.pl-loop-btn').forEach(apply)
  const gp = $('#gp-loop-btn')
  if (gp) apply(gp)
}
function stopPlayer() {
  const audio = $('#global-audio')
  audio.pause(); audio.src = ''; audio.dataset.proxyTried = ''
  audio.dataset.radioRetry = ''
  destroyHls()
  setRadioLiveUI(false)
  $('#gp-title').textContent = '未播放'
  $('#gp-sub').textContent = '试听'
  resetPlayerCover()
  setPlayingCard(null)
  clearLibSongHighlight()
  setPlayIcon(false)
  $('#gp-progress-fill').style.width = '0%'
  $('#gp-current').textContent = '0:00'
  $('#gp-duration').textContent = '0:00'
}

// 单首试听（网络音源，热榜歌曲/热榜歌单详情用）
// 已有队列时插到当前播放歌曲后面并播放（不替换队列）；无队列则新建单曲队列
async function previewSong(platform, musicInfo, label) {
  const audio = $('#global-audio')
  const rid = `${platform}:${musicInfo.songmid}`
  if (audio.dataset.rid === rid && audio.src) { togglePlay(); return }
  const item = { kind: 'net', platform, musicInfo, label: label || `${musicInfo.name} - ${musicInfo.singer}`, cover: musicInfo.img }
  if (playQueue.length) { playQueue.splice(playIndex + 1, 0, item); playIndex++; playCurrent() }
  else startQueue([item])
}
// 单首播放（Navidrome 库内歌曲，曲库歌曲/歌单详情用）
// 已有队列时插到当前播放歌曲后面并播放（不替换队列）；无队列则新建单曲队列
function playLibSong(song) {
  const audio = $('#global-audio')
  const rid = `lib:${song.id}`
  if (audio.dataset.rid === rid && audio.src) { togglePlay(); return }
  Array.from(document.querySelectorAll('.lib-song-card')).forEach((r) => r.classList.toggle('playing', r.dataset.id === song.id))
  const item = { kind: 'nav', id: song.id, label: `${song.title} - ${song.artist}`, cover: song.coverArt ? `/api/v1/navidrome/cover/${encodeURIComponent(song.coverArt)}` : '' }
  if (playQueue.length) { playQueue.splice(playIndex + 1, 0, item); playIndex++; playCurrent() }
  else startQueue([item])
}
// 整单播放（Navidrome 歌单）
function playLibPlaylist(playlist, songs) {
  if (!songs?.length) { toast('歌单内暂无歌曲'); return }
  const cover = playlist.cover || (songs[0]?.coverArt ? `/api/v1/navidrome/cover/${encodeURIComponent(songs[0].coverArt)}` : '')
  startQueue(songs.map((s) => ({ kind: 'nav', id: s.id, label: `${s.title} - ${s.artist}`, cover: s.coverArt ? `/api/v1/navidrome/cover/${encodeURIComponent(s.coverArt)}` : '' })), { cover, name: playlist.name || '曲库歌单' })
}
// 整单播放（网络歌单）
function playNetPlaylist(playlist, songs) {
  if (!songs?.length) { toast('歌单内暂无歌曲'); return }
  startQueue(songs.map((s) => ({ kind: 'net', platform: s.source, musicInfo: s, label: `${s.name} - ${s.singer}`, cover: s.img })), { cover: playlist.cover || '', name: playlist.name || '网络歌单' })
}

$('#gp-close').addEventListener('click', () => { playQueue = []; playIndex = -1; stopPlayer(); hideQueuePanel() })

// ---------- 播放队列面板 ----------
function renderQueuePanel() {
  const panel = $('#queue-panel')
  if (!panel) return
  if (!playQueue.length) { panel.innerHTML = '<div class="queue-empty">队列为空</div>'; return }
  // 头部展示当前正在播放的歌曲（非歌单）：大封面 + 左上"正在播放" + 左下播放按钮
  const now = playQueue[playIndex] || playQueue[0]
  const [nowTitle, ...nowRest] = (now?.label || '').split(' - ')
  const nowArtist = nowRest.join(' - ')
  const isPlaying = !$('#global-audio')?.paused
  const cover = now?.cover
    ? `<img class="queue-now-cover" src="${escapeHtml(now.cover)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="queue-now-cover-ph" style="display:none">🎵</div>`
    : `<div class="queue-now-cover-ph">🎵</div>`
  const items = playQueue.map((it, i) => {
    const [title, ...rest] = (it.label || '').split(' - ')
    const artist = rest.join(' - ')
    const cur = i === playIndex ? 'current' : ''
    return `<div class="queue-item ${cur}" data-idx="${i}">
      <span class="queue-idx">${i === playIndex ? '▶' : (i + 1)}</span>
      ${it.cover ? `<img class="queue-item-cover" src="${escapeHtml(it.cover)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="queue-item-cover-ph" style="display:none">🎵</span>` : `<span class="queue-item-cover-ph">🎵</span>`}
      <div class="queue-item-info">
        <div class="queue-item-title">${escapeHtml(title)}</div>
        ${artist ? `<div class="queue-item-artist">${escapeHtml(artist)}</div>` : ''}
      </div>
    </div>`
  }).join('')
  panel.innerHTML = `
    <div class="queue-head">
      <div class="queue-now-cover-wrap">
        ${cover}
        <div class="queue-now-badge">正在播放</div>
        <button class="queue-now-play" title="播放/暂停">${isPlaying ? PAUSE_ICON : PLAY_ICON}</button>
      </div>
      <div class="queue-now-info">
        <div class="queue-now-title">${escapeHtml(nowTitle)}</div>
        <div class="queue-now-artist">${escapeHtml(nowArtist)}</div>
        <div class="queue-now-sub">${playQueue.length} 首 · 当前第 ${playIndex + 1} 首 <button class="queue-clear-btn" title="清空队列">清空</button></div>
      </div>
    </div>
    <div class="queue-list">${items}</div>`
  // 点击列表项跳播
  panel.querySelectorAll('.queue-item').forEach((it) => it.addEventListener('click', () => {
    const idx = Number(it.dataset.idx)
    if (idx === playIndex) return
    playIndex = idx
    playCurrent()
  }))
  panel.querySelector('.queue-now-play')?.addEventListener('click', (e) => { e.stopPropagation(); togglePlay() })
  // 清空队列
  panel.querySelector('.queue-clear-btn')?.addEventListener('click', (e) => {
    e.stopPropagation()
    if (!confirm('确定清空播放队列？')) return
    playQueue = []; playIndex = -1; stopPlayer(); renderQueuePanel(); toast('队列已清空')
  })
}
function showQueuePanel() {
  document.body.classList.add('queue-open')
  $('#queue-panel').classList.add('show')
  // 移动端才显示遮罩（PC 端 CSS 已隐藏 backdrop）
  if (window.innerWidth <= 768) $('#queue-backdrop').classList.add('show')
  renderQueuePanel()
}
function hideQueuePanel() {
  document.body.classList.remove('queue-open')
  $('#queue-panel').classList.remove('show')
  $('#queue-backdrop').classList.remove('show')
}
function toggleQueuePanel() {
  if (!$('#queue-panel').classList.contains('show')) showQueuePanel()
  else hideQueuePanel()
}
$('#gp-queue-btn').addEventListener('click', toggleQueuePanel)
$('#queue-backdrop').addEventListener('click', hideQueuePanel)
$('#gp-loop-btn').addEventListener('click', cycleLoopMode)
updateLoopBtn() // 初始化播放条循环按钮图标

// 播放/暂停 + 进度条 + 时间
function togglePlay() {
  const audio = $('#global-audio')
  if (!audio.src) return
  if (audio.paused) { audio.play().catch(() => {}); setPlayIcon(true) }
  else { audio.pause(); setPlayIcon(false) }
}
function fmtTime(s) {
  if (!s || isNaN(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec < 10 ? '0' : ''}${sec}`
}
// 歌单播放时长：单曲按 3.9 分钟，count*3.9 分钟 → "X小时Y分" / "Y分"
function fmtPlayDuration(count) {
  let mins = Math.round(count * 3.9) // 59.9 → 60 进位
  if (mins < 60) return `${mins}分`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}小时${m}分`
}
const _audio = document.querySelector('#global-audio')
$('#gp-play').addEventListener('click', togglePlay)
$('#gp-prev').addEventListener('click', playPrev)
$('#gp-next').addEventListener('click', playNext)
_audio.addEventListener('play', () => { setPlayIcon(true); document.querySelector('.song-card.playing')?.classList.remove('paused') })
_audio.addEventListener('pause', () => { setPlayIcon(false); if (_audio.src) document.querySelector('.song-card.playing')?.classList.add('paused') })
_audio.addEventListener('timeupdate', () => {
  const cur = _audio.currentTime, dur = _audio.duration
  $('#gp-current').textContent = fmtTime(cur)
  $('#gp-duration').textContent = fmtTime(dur)
  if (dur) $('#gp-progress-fill').style.width = `${(cur / dur) * 100}%`
})
_audio.addEventListener('loadedmetadata', () => { $('#gp-duration').textContent = fmtTime(_audio.duration) })
// 队列自动推进：播完一首切下一首，队列末尾则停止
_audio.addEventListener('ended', () => { advanceQueue() })
// 拖动进度条 seek
$('#gp-progress').addEventListener('click', (e) => {
  const bar = $('#gp-progress')
  const rect = bar.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  if (_audio.duration) { _audio.currentTime = ratio * _audio.duration }
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
  const ctx = state.createCtx || { name: '', cover: '', desc: '' }
  const defaultName = ctx.name || ''
  const defaultDesc = ctx.desc || ''
  const coverImg = ctx.cover
    ? `<img src="${escapeHtml(ctx.cover)}" style="width:48px;height:48px;border-radius:8px;object-fit:cover;margin-right:10px" onerror="this.style.display='none'">`
    : ''
  $('#float-create-panel').innerHTML = `
    <div class="float-panel-head"><b>✅ 创建 Navidrome 歌单（${items.length} 首）</b><button class="float-panel-close" data-close>×</button></div>
    <div style="display:flex;align-items:center;margin-bottom:10px">${coverImg}
      <input type="text" id="create-pl-name" placeholder="歌单名称" class="name-in" value="${escapeHtml(defaultName)}">
    </div>
    <input type="text" id="create-pl-desc" placeholder="歌单描述（可选）" class="name-in" style="width:100%;margin-bottom:10px" value="${escapeHtml(defaultDesc)}">
    <div style="max-height:200px;overflow-y:auto;margin-bottom:10px"><table class="card"><thead><tr><th>歌曲</th><th>歌手</th><th>平台</th></tr></thead><tbody>${rows}</tbody></table></div>
    <button id="create-pl-btn" class="create-btn">创建 Navidrome 歌单</button>`
  $('#create-pl-btn').addEventListener('click', async () => {
    const name = $('#create-pl-name').value.trim()
    if (!name) return toast('请输入歌单名称')
    const desc = $('#create-pl-desc').value.trim()
    const ids = items.map((it) => state.createMap.get(rowKey(it))?.libId).filter(Boolean)
    if (!ids.length) return toast('无有效歌曲')
    try {
      const d = await fetchJSON('/api/v1/navidrome/playlist/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, song_ids: ids, desc: desc || undefined }),
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

// ---------- 网络电台 (radio5.cn) ----------
let netRadioCatalog = null
let netRadioActivePath = 'fm/cmg'

async function loadNetRadio() {
  // 切回分类首页
  $('#net-radio-home').hidden = false
  $('#net-radio-search-page').hidden = true
  // 加载分类目录填充筛选下拉
  if (!netRadioCatalog) {
    try {
      netRadioCatalog = await fetchJSON('/api/v1/radio5/categories')
      fillFilterSelects(netRadioCatalog)
    } catch { /* 目录静态，失败也继续 */ }
  }
  // 默认加载第一个快捷标签（央媒）
  const activeTab = $('#net-radio-quick-tabs .ptab.active[data-path]') || $('#net-radio-quick-tabs .ptab[data-path]')
  if (activeTab) {
    netRadioActivePath = activeTab.dataset.path
    await loadNetRadioStations(netRadioActivePath)
  }
}

function fillFilterSelects(cat) {
  const fill = (sel, opts) => {
    const el = $(sel)
    if (!el) return
    opts.forEach((o) => { const opt = document.createElement('option'); opt.value = o.path; opt.textContent = o.label; el.appendChild(opt) })
  }
  fill('#filter-level', cat.level)
  fill('#filter-area', cat.area)
  fill('#filter-type', cat.type)
  fill('#filter-language', cat.language)
}

async function loadNetRadioStations(path) {
  netRadioActivePath = path
  $('#net-radio-home').hidden = false
  $('#net-radio-search-page').hidden = true
  const grid = $('#net-radio-grid')
  const status = $('#net-radio-status')
  status.textContent = '加载中…'
  grid.innerHTML = ''
  try {
    const d = await fetchJSON(`/api/v1/radio5/stations?cat=${encodeURIComponent(path)}`)
    status.textContent = `共 ${d.total} 个电台`
    renderNetRadioGrid(grid, d.stations)
  } catch (err) {
    status.textContent = ''
    grid.innerHTML = `<div class="empty">加载失败：${escapeHtml(err.message)}</div>`
  }
}

function renderNetRadioGrid(grid, stations) {
  if (!stations.length) { grid.innerHTML = '<div class="empty">暂无电台</div>'; return }
  grid.innerHTML = stations.map((s) => `
    <div class="radio-card" data-slug="${escapeHtml(s.slug)}" data-name="${escapeHtml(s.name)}" data-cover="${escapeHtml(s.cover || '')}">
      <div class="radio-cover-wrap">${coverHtml(s.cover)}</div>
      <div class="radio-info">
        <div class="radio-name">${escapeHtml(s.name)}</div>
        <div class="radio-artist">${escapeHtml(s.artist || '网络电台')}</div>
      </div>
      <div class="radio-card-act">
        <button class="radio-play-btn" data-slug="${escapeHtml(s.slug)}">▶ 播放</button>
        <button class="radio-add-btn" data-slug="${escapeHtml(s.slug)}" title="添加到 Navidrome 本地电台">＋ 本地</button>
      </div>
    </div>`).join('')
  grid.querySelectorAll('.radio-card').forEach((card) => {
    // 点卡片区域（非按钮）播放
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return
      playRadioStream(card.dataset.slug, card)
    })
    card.querySelector('.radio-play-btn')?.addEventListener('click', (e) => {
      e.stopPropagation()
      playRadioStream(card.dataset.slug, card)
    })
    card.querySelector('.radio-add-btn')?.addEventListener('click', (e) => {
      e.stopPropagation()
      addRadioToLocal(card.dataset.slug, card.dataset.name, card)
    })
  })
}

// 添加网络电台到 Navidrome 本地电台：现取流地址 + 详情页 URL，调创建接口
// 注：Subsonic createInternetRadioStation 不支持封面图，电台图片无法通过 API 创建
async function addRadioToLocal(slug, name, cardEl) {
  const btn = cardEl?.querySelector('.radio-add-btn')
  if (btn) { btn.disabled = true; btn.textContent = '添加中…' }
  try {
    // 取流地址（时效 key，服务端现取）
    const stream = await fetchJSON(`/api/v1/radio5/stream/${encodeURIComponent(slug)}`)
    const detailUrl = `https://radio5.cn/play/radio/${encodeURIComponent(slug)}`
    await fetchJSON('/api/v1/navidrome/radio', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ streamUrl: stream.streamUrl, name: name || stream.title, homepageUrl: detailUrl }),
    })
    toast(`已添加到本地电台：${name}`)
    if (btn) { btn.textContent = '✓ 已添加'; btn.classList.add('added') }
  } catch (err) {
    toast(`添加失败：${err.message}`)
    if (btn) { btn.disabled = false; btn.textContent = '＋ 本地' }
  }
}

// 快捷标签切换
$$('#net-radio-quick-tabs .ptab').forEach((t) => {
  t.addEventListener('click', () => {
    if (t.dataset.advanced) {
      // 高级筛选折叠切换
      $('#net-radio-filter').hidden = !$('#net-radio-filter').hidden
      return
    }
    $$('#net-radio-quick-tabs .ptab').forEach((x) => x.classList.toggle('active', x === t))
    loadNetRadioStations(t.dataset.path)
  })
})

// 高级筛选应用：四维任选，应用后取消快捷标签激活
$('#filter-apply')?.addEventListener('click', () => {
  const path = $('#filter-level').value || $('#filter-area').value || $('#filter-type').value || $('#filter-language').value
  if (!path) { toast('请至少选择一个筛选维度'); return }
  $$('#net-radio-quick-tabs .ptab').forEach((x) => x.classList.remove('active'))
  loadNetRadioStations(path)
})
$('#filter-reset')?.addEventListener('click', () => {
  ;['#filter-level', '#filter-area', '#filter-type', '#filter-language'].forEach((s) => { $(s).value = '' })
})

// 刷新
$('#net-radio-refresh')?.addEventListener('click', () => loadNetRadioStations(netRadioActivePath))

// 搜索
$('#net-radio-search-btn')?.addEventListener('click', () => {
  const q = $('#net-radio-keyword').value.trim()
  if (!q) return
  searchNetRadio(q)
})
$('#net-radio-keyword')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { const q = $('#net-radio-keyword').value.trim(); if (q) searchNetRadio(q) }
})
$('#net-radio-back')?.addEventListener('click', () => loadNetRadioStations(netRadioActivePath))

async function searchNetRadio(q) {
  $('#net-radio-home').hidden = true
  $('#net-radio-search-page').hidden = false
  const grid = $('#net-radio-search-grid')
  const status = $('#net-radio-search-status')
  status.textContent = '搜索中…'
  grid.innerHTML = ''
  try {
    const d = await fetchJSON(`/api/v1/radio5/search?q=${encodeURIComponent(q)}`)
    status.textContent = `找到 ${d.total} 个电台`
    renderNetRadioGrid(grid, d.stations)
  } catch (err) {
    status.textContent = ''
    grid.innerHTML = `<div class="empty">搜索失败：${escapeHtml(err.message)}</div>`
  }
}

// 点电台卡片 → 取流 → 播放（HLS）
async function playRadioStream(slug, cardEl) {
  document.querySelectorAll('.radio-card.playing').forEach((c) => c.classList.remove('playing'))
  if (cardEl) cardEl.classList.add('playing')
  let stream
  try {
    stream = await fetchJSON(`/api/v1/radio5/stream/${encodeURIComponent(slug)}`)
  } catch (err) {
    toast(`取流失败：${err.message}`)
    return
  }
  // 单元素队列播放，radio 类型走 HLS 分支
  startQueue([{
    kind: 'radio',
    slug,
    streamUrl: stream.streamUrl,
    label: stream.title || '网络电台',
    cover: stream.cover || '',
    artist: stream.artist || '',
    isHls: true,
  }], { cover: stream.cover || '', name: stream.title || '网络电台' })
}

// ---------- 本地电台 (Navidrome) ----------
async function loadLocalRadio() {
  const list = $('#local-radio-list')
  const status = $('#local-radio-status')
  const summary = $('#local-radio-summary')
  status.textContent = '加载中…'
  list.innerHTML = ''
  summary.textContent = ''
  try {
    const d = await fetchJSON('/api/v1/navidrome/radio')
    status.textContent = ''
    summary.textContent = `共 ${d.total} 个电台`
    renderLocalRadioList(list, d.stations)
  } catch (err) {
    status.textContent = ''
    summary.textContent = ''
    list.innerHTML = `<div class="empty">${escapeHtml(err.message)}。请在 Navidrome 后台 Settings > Radio 添加电台。</div>`
  }
}

function renderLocalRadioList(listEl, stations) {
  if (!stations.length) { listEl.innerHTML = '<div class="empty">未配置电台。请到 Navidrome 后台 > Settings > Radio 添加。</div>'; return }
  listEl.className = 'pl-grid'
  listEl.innerHTML = stations.map((s) => {
    // 有 coverArt 走封面代理，无则占位图 📻
    const cover = s.coverArt
      ? `<img class="song-card-cover" src="/api/v1/navidrome/cover/${encodeURIComponent(s.coverArt)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="song-card-icon" style="display:none">📻</span>`
      : `<span class="song-card-icon">📻</span>`
    // 首页URL可点击（有则显示，stopPropagation 避免触发卡片播放）
    const home = s.homepageUrl
      ? `<a class="radio-home-url" href="${escapeHtml(s.homepageUrl)}" target="_blank" rel="noopener" title="电台首页">${escapeHtml(s.homepageUrl)}</a>`
      : '<span class="radio-home-url none">无首页</span>'
    return `
    <div class="radio-card local-radio-card" data-url="${escapeHtml(s.streamUrl)}" data-name="${escapeHtml(s.name)}">
      <div class="radio-cover-wrap">${cover}</div>
      <div class="radio-info">
        <div class="radio-name">${escapeHtml(s.name)}</div>
        <div class="radio-stream" title="${escapeHtml(s.streamUrl)}">推流：${escapeHtml(s.streamUrl)}</div>
        ${home}
      </div>
      <div class="radio-card-act">
        <button class="radio-play-btn">▶ 播放</button>
      </div>
    </div>` }).join('')
  listEl.querySelectorAll('.local-radio-card').forEach((card) => {
    // 点卡片区域（非按钮/链接）播放
    card.addEventListener('click', (e) => {
      if (e.target.closest('button, a')) return
      playLocalRadio(card.dataset.url, card.dataset.name, card)
    })
    card.querySelector('.radio-play-btn')?.addEventListener('click', (e) => {
      e.stopPropagation()
      playLocalRadio(card.dataset.url, card.dataset.name, card)
    })
    // 首页链接点击不触发播放
    card.querySelector('.radio-home-url')?.addEventListener('click', (e) => e.stopPropagation())
  })
}

function playLocalRadio(url, name, cardEl) {
  document.querySelectorAll('.local-radio-card.playing').forEach((r) => r.classList.remove('playing'))
  if (cardEl) cardEl.classList.add('playing')
  // mp3 直链，原生 audio 播放，radio 类型非 HLS 分支
  startQueue([{
    kind: 'radio',
    streamUrl: url,
    label: name,
    cover: '',
    artist: '',
    isHls: false,
  }], { cover: '', name })
}

$('#local-radio-refresh')?.addEventListener('click', loadLocalRadio)

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
// ---------- 曲库统计（独立曲库菜单）----------
let libStatsCache = null
async function loadLibraryStats(force = false) {
  const el = $('#library-stats')
  const sum = $('#lib-stats-summary')
  if (!el) return
  // 有缓存直接渲染，跳过实时 Navidrome /stats 往返，避免切换卡顿；force=true 强制重拉
  if (!force && libStatsCache) { renderLibraryStats(libStatsCache); return }
  el.innerHTML = '<div class="empty">加载中…</div>'
  try {
    const d = await fetchJSON('/api/v1/navidrome/stats')
    libStatsCache = d
    renderLibraryStats(d)
  } catch (err) {
    el.innerHTML = `<div class="empty">加载失败：${escapeHtml(err.message)}</div>`
  }
}
function renderLibraryStats(d) {
  const el = $('#library-stats')
  const sum = $('#lib-stats-summary')
  if (!el || !d) return
  sum.textContent = `${d.songCount} 首 · ${d.artistCount} 位艺术家 · ${d.albumCount} 张专辑`
  const pls = d.playlists || []
  el.innerHTML = `
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">
      <div class="src-card" style="flex:1;min-width:120px;text-align:center"><div style="font-size:24px;font-weight:600;color:var(--accent)">${d.songCount}</div><div style="font-size:13px;color:var(--text-muted)">歌曲</div></div>
      <div class="src-card" style="flex:1;min-width:120px;text-align:center"><div style="font-size:24px;font-weight:600;color:var(--accent)">${d.artistCount}</div><div style="font-size:13px;color:var(--text-muted)">艺术家</div></div>
      <div class="src-card" style="flex:1;min-width:120px;text-align:center"><div style="font-size:24px;font-weight:600;color:var(--accent)">${d.albumCount}</div><div style="font-size:13px;color:var(--text-muted)">专辑</div></div>
      <div class="src-card" style="flex:1;min-width:120px;text-align:center"><div style="font-size:24px;font-weight:600;color:var(--accent)">${pls.length}</div><div style="font-size:13px;color:var(--text-muted)">歌单</div></div>
    </div>
    <h3 class="platform-group" style="border-left:3px solid var(--accent);padding-left:6px;font-size:14px;color:#555;margin:12px 0 8px">🎵 Navidrome 歌单</h3>
    <div id="lib-stats-pl-grid" class="pl-grid"></div>`
  const grid = $('#lib-stats-pl-grid')
  if (!pls.length) { grid.innerHTML = '<div class="empty">暂无歌单</div>'; return }
  grid.innerHTML = pls.map((p) => playlistCardHtml({
    id: p.id, name: p.name,
    cover: p.coverArt ? `/api/v1/navidrome/cover/${encodeURIComponent(p.coverArt)}` : '',
    count: p.songCount, desc: `${p.owner || ''}${p.public ? ' · 公开' : ''}`,
    playKind: 'nav', coverPh: '📁',
  })).join('')
  // 概览页无详情视图，卡片整体不导航；仅 hover 播放按钮 → 整单播放
  bindPlaylistCards('#lib-stats-pl-grid', async (card) => {
    const id = card.dataset.id, name = card.dataset.name
    const cover = card.querySelector('.pl-cover img')?.src || ''
    toast(`加载《${name}》歌曲列表…`)
    try {
      const d2 = await fetchJSON(`/api/v1/navidrome/playlist/${encodeURIComponent(id)}`)
      playLibPlaylist({ name, cover }, d2.songs)
    } catch (err) { toast(`播放失败：${err.message}`) }
  })
}
$('#lib-stats-refresh').addEventListener('click', () => loadLibraryStats(true))

// ---------- 曲库歌曲（Navidrome 库内歌曲列表 + 可播放）----------
let libSongsCache = []
let libStarredIds = new Set() // 已收藏歌曲 id 集合
let libSongsPage = 1
let libSongsTotalPages = 1
let libSongsTotal = 0
let libSongsKeyword = ''
let libSongsFilterTimer = null
async function loadLibSongs(force = false) {
  const list = $('#lib-songs-list')
  const status = $('#lib-songs-status')
  const sum = $('#lib-songs-summary')
  if (!list) return
  // force=true 回到第 1 页（刷新/重进场景）
  if (force) libSongsPage = 1
  status.innerHTML = '<div class="status">加载中…</div>'
  list.innerHTML = ''
  try {
    // 并行取当前页歌曲 + 收藏 id 集合（starred 全量，每页比对收藏状态）
    const qs = new URLSearchParams({ page: String(libSongsPage), pageSize: '18' })
    if (libSongsKeyword) qs.set('keyword', libSongsKeyword)
    const [d, sd] = await Promise.all([
      fetchJSON(`/api/v1/navidrome/songs?${qs.toString()}`),
      fetchJSON('/api/v1/navidrome/starred'),
    ])
    libSongsCache = d.songs || []
    libStarredIds = new Set(sd.ids || [])
    libSongsTotal = d.total
    libSongsTotalPages = d.totalPages
    sum.textContent = d.loading ? `${d.total} 首 · 曲库刷新中` : `${d.total} 首`
    renderLibSongs(libSongsCache)
    renderLibSongsPager()
  } catch (err) {
    status.innerHTML = `<div class="status err">${escapeHtml(err.message)}</div>`
  }
}
// 翻页：更新页码后重拉当前页
function libSongsGoPage(page) {
  if (page < 1 || page > libSongsTotalPages || page === libSongsPage) return
  libSongsPage = page
  loadLibSongs(false)
}
// 分页器渲染：上一页 · 第X/Y页 · 下一页 + 跳页输入
function renderLibSongsPager() {
  const pager = $('#lib-songs-pager')
  if (!pager) return
  if (libSongsTotalPages <= 1) { pager.hidden = true; return }
  pager.hidden = false
  const prevDisabled = libSongsPage <= 1
  const nextDisabled = libSongsPage >= libSongsTotalPages
  pager.innerHTML = `
    <button class="pager-btn" data-page="${libSongsPage - 1}" ${prevDisabled ? 'disabled' : ''}>上一页</button>
    <span class="pager-info">第 <input type="number" class="pager-input" min="1" max="${libSongsTotalPages}" value="${libSongsPage}"> / ${libSongsTotalPages} 页</span>
    <button class="pager-btn" data-page="${libSongsPage + 1}" ${nextDisabled ? 'disabled' : ''}>下一页</button>`
  pager.querySelectorAll('.pager-btn').forEach((b) => {
    b.addEventListener('click', () => libSongsGoPage(parseInt(b.dataset.page, 10)))
  })
  const input = pager.querySelector('.pager-input')
  if (input) {
    input.addEventListener('change', () => {
      const p = parseInt(input.value, 10)
      if (p >= 1 && p <= libSongsTotalPages) libSongsGoPage(p)
      else input.value = String(libSongsPage)
    })
  }
}
function libSongRowHtml(s, opts = {}) {
  // 大卡片模式：大封面在上 + 信息 + 操作按钮在底
  const cover = s.coverArt
    ? `<img class="lib-song-cover" src="/api/v1/navidrome/cover/${encodeURIComponent(s.coverArt)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="lib-song-cover-ph" style="display:none">🎵</div>`
    : `<div class="lib-song-cover-ph">🎵</div>`
  const dur = s.duration ? fmtTime(s.duration) : ''
  const plays = (typeof s.playCount === 'number' && s.playCount > 0) ? `<span class="lib-song-plays" title="播放次数">▶ ${s.playCount}</span>` : ''
  const removeBtn = opts.removable ? `<button class="lib-song-remove" data-id="${escapeHtml(s.id)}" title="移出歌单"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>` : ''
  const starred = libStarredIds.has(s.id)
  const starIcon = starred
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7-4.5-9.5-9C1 9 2.5 5 6 5c2 0 3.5 1 6 3.5C14.5 6 16 5 18 5c3.5 0 5 4 3.5 7-2.5 4.5-9.5 9-9.5 9z"/></svg>'
    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>'
  return `<div class="lib-song-card" data-id="${escapeHtml(s.id)}">
    <div class="lib-song-cover-wrap">${cover}</div>
    <div class="lib-song-info">
      <div class="lib-song-title">${escapeHtml(s.title)}</div>
      <div class="lib-song-artist">${escapeHtml(s.artist)}${s.album ? ' · ' + escapeHtml(s.album) : ''}</div>
      <div class="lib-song-meta">${plays}${dur ? `<span class="lib-song-dur">${dur}</span>` : ''}</div>
    </div>
    <div class="lib-song-act">
      <button class="lib-song-play preview-btn" data-id="${escapeHtml(s.id)}">▶播放</button>
      <button class="lib-song-queue" data-id="${escapeHtml(s.id)}" title="加入播放队列"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8M8 12h8"/></svg></button>
      <button class="lib-song-star ${starred ? 'starred' : ''}" data-id="${escapeHtml(s.id)}" title="${starred ? '取消收藏' : '收藏'}">${starIcon}</button>
      ${removeBtn}
    </div>
  </div>`
}
function bindLibSongPlay(container, songs) {
  container.querySelectorAll('.lib-song-play').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation()
    const song = songs.find((x) => x.id === b.dataset.id)
    if (song) playLibSong(song)
  }))
  // 加入播放队列（追加到 playQueue 末尾，不立即播放）
  container.querySelectorAll('.lib-song-queue').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation()
    const song = songs.find((x) => x.id === b.dataset.id)
    if (!song) return
    const item = { kind: 'nav', id: song.id, label: `${song.title} - ${song.artist}`, cover: song.coverArt ? `/api/v1/navidrome/cover/${encodeURIComponent(song.coverArt)}` : '' }
    playQueue.push(item)
    // 若队列原本为空，则从这首开始播
    if (playIndex < 0) { playIndex = 0; playCurrent() }
    else { renderQueuePanel(); toast(`已加入队列：${song.title}`) }
  }))
  // 收藏 / 取消收藏
  const STAR_FILL = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7-4.5-9.5-9C1 9 2.5 5 6 5c2 0 3.5 1 6 3.5C14.5 6 16 5 18 5c3.5 0 5 4 3.5 7-2.5 4.5-9.5 9-9.5 9z"/></svg>'
  const STAR_LINE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>'
  container.querySelectorAll('.lib-song-star').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation()
    const id = b.dataset.id
    const wasStarred = libStarredIds.has(id)
    try {
      await fetchJSON(`/api/v1/navidrome/${wasStarred ? 'unstar' : 'star'}/${encodeURIComponent(id)}`, { method: 'POST' })
      if (wasStarred) { libStarredIds.delete(id); b.classList.remove('starred'); b.innerHTML = STAR_LINE; b.title = '收藏'; toast('已取消收藏') }
      else { libStarredIds.add(id); b.classList.add('starred'); b.innerHTML = STAR_FILL; b.title = '取消收藏'; toast('已收藏') }
    } catch (err) { toast(`操作失败：${err.message}`) }
  }))
}
function renderLibSongs(songs) {
  const list = $('#lib-songs-list')
  const status = $('#lib-songs-status')
  status.innerHTML = ''
  if (!songs.length) { list.innerHTML = '<div class="empty">曲库暂无歌曲</div>'; return }
  list.className = 'pl-grid'
  list.innerHTML = songs.map(libSongRowHtml).join('')
  bindLibSongPlay(list, songs)
}
// playLibSong 已在上方播放队列模块定义（插队头播放逻辑），此处不再重复定义
$('#lib-songs-refresh').addEventListener('click', () => loadLibSongs(true))
$('#lib-songs-keyword').addEventListener('input', () => {
  // debounce 300ms → 后端过滤，回第 1 页（避免大库本地 filter 卡顿）
  clearTimeout(libSongsFilterTimer)
  libSongsFilterTimer = setTimeout(() => {
    libSongsKeyword = $('#lib-songs-keyword').value.trim()
    libSongsPage = 1
    loadLibSongs(false)
  }, 300)
})

// ---------- 曲库歌单（Navidrome 歌单列表 + 详情可播放）----------
let libPlCache = null
async function loadLibPlaylists(force = false) {
  const grid = $('#lib-pl-grid')
  const status = $('#lib-pl-status')
  const sum = $('#lib-pl-summary')
  $('#lib-pl-home').hidden = false
  $('#lib-pl-detail').hidden = true
  if (!grid) return
  // 有缓存直接渲染，跳过实时 Navidrome /stats 往返，避免切换卡顿；force=true 强制重拉
  if (!force && libPlCache) { renderLibPlaylists(libPlCache); return }
  status.innerHTML = '<div class="status">加载中…</div>'
  grid.innerHTML = ''
  try {
    const d = await fetchJSON('/api/v1/navidrome/stats')
    libPlCache = d.playlists || []
    renderLibPlaylists(libPlCache)
  } catch (err) {
    status.innerHTML = `<div class="status err">${escapeHtml(err.message)}</div>`
  }
}
function renderLibPlaylists(pls) {
  const grid = $('#lib-pl-grid')
  const status = $('#lib-pl-status')
  const sum = $('#lib-pl-summary')
  sum.textContent = `${pls.length} 个歌单`
  status.innerHTML = ''
  if (!pls.length) { grid.innerHTML = '<div class="empty">暂无歌单</div>'; return }
  grid.innerHTML = pls.map((p) => playlistCardHtml({
    id: p.id, name: p.name,
    cover: p.coverArt ? `/api/v1/navidrome/cover/${encodeURIComponent(p.coverArt)}` : '',
    count: p.songCount, desc: `${p.owner || ''}${p.public ? ' · 公开' : ''}`,
    playKind: 'nav', coverPh: '📁',
  })).join('')
  // 卡片整体点击 → 进详情
  $$('#lib-pl-grid .pl-card').forEach((card) => card.addEventListener('click', () =>
    openLibPlaylistDetail(card.dataset.id, card.dataset.name)))
  // hover 播放按钮 → 整单播放（Navidrome 歌单需先取 /playlist/:id 的歌曲列表）
  bindPlaylistCards('#lib-pl-grid', async (card) => {
    const id = card.dataset.id, name = card.dataset.name
    toast(`加载《${name}》歌曲列表…`)
    try {
      const d = await fetchJSON(`/api/v1/navidrome/playlist/${encodeURIComponent(id)}`)
      playLibPlaylist({ name }, d.songs)
    } catch (err) { toast(`播放失败：${err.message}`) }
  })
}
async function openLibPlaylistDetail(id, name) {
  const el = $('#lib-pl-detail')
  $('#lib-pl-home').hidden = true
  el.hidden = false
  el.dataset.playlistId = id
  el.innerHTML = '<div class="status">加载中…</div>'
  try {
    const d = await fetchJSON(`/api/v1/navidrome/playlist/${encodeURIComponent(id)}`)
    const songs = d.songs || []
    const meta = `${d.songCount || 0} 首歌曲${d.owner ? ' · ' + escapeHtml(d.owner) : ''}${d.public ? ' · 公开' : ''}`
    el.innerHTML = `
      <button class="back-btn" id="lib-pl-back" style="margin-bottom:10px">← 返回歌单列表</button>
      ${playlistDetailHeaderHtml({ cover: d.coverArt ? `/api/v1/navidrome/cover/${encodeURIComponent(d.coverArt)}` : '', name: d.name || name, desc: d.comment || '', meta, editable: true })}
      <div id="lib-pl-songs"></div>`
    renderLibPlaylistSongs(songs)
    $('#lib-pl-back').addEventListener('click', () => { el.hidden = true; $('#lib-pl-home').hidden = false })
    bindDetailHeader('#lib-pl-detail', () => playLibPlaylist({ name: d.name || name, cover: d.coverArt ? `/api/v1/navidrome/cover/${encodeURIComponent(d.coverArt)}` : '' }, songs), () => {
      enterDetailEdit('#lib-pl-detail', d.name || name, d.comment || '', async (n, dd) => {
        await fetchJSON('/api/v1/navidrome/playlist/update?id=' + encodeURIComponent(id), {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n, desc: dd }),
        })
        toast('歌单已更新')
        openLibPlaylistDetail(id, n) // 刷新详情
      })
    }, () => {
      // 删除歌单
      if (!confirm(`确定删除歌单「${d.name || name}」？此操作不可恢复。`)) return
      fetchJSON(`/api/v1/navidrome/playlist/${encodeURIComponent(id)}`, { method: 'DELETE' })
        .then(() => { toast('歌单已删除'); libPlCache = null; $('#lib-pl-detail').hidden = true; $('#lib-pl-home').hidden = false; loadLibPlaylists(true) })
        .catch((e) => toast(`删除失败：${e.message}`))
    })
  } catch (err) {
    el.innerHTML = `<div class="status err">${escapeHtml(err.message)}</div>`
  }
}
// 渲染曲库歌单详情的歌曲列表（带移出按钮 + 播放次数）
function renderLibPlaylistSongs(songs) {
  const box = $('#lib-pl-songs')
  if (!box) return
  if (!songs.length) { box.innerHTML = '<div class="empty">歌单内暂无歌曲</div>'; return }
  box.className = 'lib-songs-compact'
  box.innerHTML = songs.map((s) => libSongRowHtml(s, { removable: true })).join('')
  bindLibSongPlay(box, songs)
  // 移出歌单
  box.querySelectorAll('.lib-song-remove').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation()
    const songId = b.dataset.id
    const row = b.closest('.lib-song-card')
    const title = row?.querySelector('.lib-song-title')?.textContent || '该歌曲'
    if (!confirm(`确定将「${title}」移出歌单？`)) return
    const plId = $('#lib-pl-detail').dataset.playlistId
    try {
      await fetchJSON(`/api/v1/navidrome/playlist/${encodeURIComponent(plId)}/remove`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ song_id: songId }),
      })
      row?.remove()
      toast('已移出歌单')
      // songCount 同步减一（刷新歌单列表缓存下次进入生效）
      const cnt = $('#lib-pl-detail .pl-detail-desc')?.textContent
      // 重新拉取详情更新计数
      openLibPlaylistDetail(plId, $('#lib-pl-detail .pl-detail-name')?.textContent || '')
    } catch (err) { toast(`移出失败：${err.message}`) }
  }))
}
$('#lib-pl-refresh').addEventListener('click', () => loadLibPlaylists(true))

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
initMenuGroups()
initTheme()
// 默认着陆页为首页（view-home，内容空），无需初始加载
