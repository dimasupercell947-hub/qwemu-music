import { StorageAdapter } from './storage-adapter.js';
import { ApiAdapter } from './api-adapter.js';
import { AuthAdapter } from './auth-adapter.js';
import { BrowserAudioAdapter } from './audio-adapter.js';
import { fingerprintFile } from './file-fingerprint.js';
import { CloudWriteQueue } from './cloud-write-queue.js';

const $ = selector => document.querySelector(selector);
const storage = new StorageAdapter();
const api = new ApiAdapter();
const auth = new AuthAdapter(api);
const audio = new BrowserAudioAdapter($('#audio'));
const cloudWrites = new CloudWriteQueue();
const savedFavorites=storage.read('favorites', []);
const savedPlaylists=storage.read('playlists', []);
const savedSettings=storage.read('settings', {});
const validThemes = ['dark-red','orange-night','midnight','pure-black','light'];
function normalizeSettings(value) {
  const source=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const volume=Number(source.volume);
  return { theme: validThemes.includes(source.theme)?source.theme:'dark-red', volume:Number.isFinite(volume)?Math.max(0,Math.min(1,volume)):0.8, reducedMotion:source.reducedMotion===true };
}
const state = {
  page: 'home', tracks: [], favorites: Array.isArray(savedFavorites)?savedFavorites.filter(value=>typeof value==='string').slice(0,5000):[],
  playlists: Array.isArray(savedPlaylists)?savedPlaylists.filter(item=>item&&typeof item.id==='string'&&typeof item.name==='string'&&Array.isArray(item.trackIds)).slice(0,300):[],
  settings: normalizeSettings(savedSettings), settingsRevision: 0, repeat: false,
  currentId: null, playRequestId: 0, search: '', user: null, authMode: 'login', cloudReady: false, cloudLoadId: 0, authTransition: false, activePlaylist: null, toastTimer: null
};
const themes = { 'dark-red': ['#0c0b0d','#b51e32','#f07832'], 'orange-night': ['#100d0a','#b84b1e','#ff9b42'], midnight: ['#090d18','#394c9c','#9b85ff'], 'pure-black': ['#000000','#b51e32','#f07832'], light: ['#f3eef0','#a51f35','#e66a27'] };
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const uid = () => globalThis.crypto?.randomUUID?.() || `track-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const formatTime = value => { const n = Number(value); return Number.isFinite(n) && n >= 0 ? `${Math.floor(n/60)}:${String(Math.floor(n%60)).padStart(2,'0')}` : '0:00'; };
function toast(message) {
  const node = $('#toast'); node.textContent = message; node.classList.add('show');
  clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => node.classList.remove('show'), 3600);
}
function localKey(key) { return state.user ? `account.${state.user.id}.${key}` : key; }
function writeLocal(key, value) {
  try { storage.write(localKey(key), value); return true; }
  catch (error) { toast(error.message); return false; }
}
function loadScopedLocal() {
  const favorites=storage.read(localKey('favorites'),[]);
  const playlists=storage.read(localKey('playlists'),[]);
  const settings=storage.read(localKey('settings'),{});
  state.favorites=Array.isArray(favorites)?favorites.filter(value=>typeof value==='string').slice(0,5000):[];
  state.playlists=Array.isArray(playlists)?playlists.filter(item=>item&&typeof item.id==='string'&&typeof item.name==='string'&&Array.isArray(item.trackIds)).slice(0,300):[];
  state.settings=normalizeSettings(settings);
}
function saveLocal() {
  writeLocal('favorites', state.favorites);
  writeLocal('playlists', state.playlists);
  writeLocal('settings', state.settings);
}
function applyTheme() {
  const selected = themes[state.settings.theme] ? state.settings.theme : 'dark-red';
  document.documentElement.classList.toggle('reduce-motion', state.settings.reducedMotion);
  const [bg, red, orange] = themes[selected];
  document.documentElement.style.setProperty('--bg', bg);
  document.documentElement.style.setProperty('--red', red);
  document.documentElement.style.setProperty('--orange', orange);
  document.documentElement.style.setProperty('--accent', `linear-gradient(115deg,${red},${orange})`);
  document.documentElement.style.colorScheme = selected === 'light' ? 'light' : 'dark';
  if (selected === 'light') {
    document.documentElement.style.setProperty('--panel', '#ffffff');
    document.documentElement.style.setProperty('--panel2', '#f6edf0');
    document.documentElement.style.setProperty('--line', '#dfd1d7');
    document.documentElement.style.setProperty('--text', '#21191e');
    document.documentElement.style.setProperty('--muted', '#766a71');
  } else {
    for (const [key, value] of [['--panel','#151316'],['--panel2','#1b181b'],['--line','#2a2429'],['--text','#f6f0f1'],['--muted','#a79da3']]) document.documentElement.style.setProperty(key, value);
  }
}
function visibleTracks() {
  let list = state.tracks;
  if (state.page === 'favorites') list = list.filter(track => state.favorites.includes(track.id));
  if (state.page === 'playlists' && state.activePlaylist) {
    const playlist = state.playlists.find(item => item.id === state.activePlaylist);
    list = list.filter(track => playlist?.trackIds.includes(track.id));
  }
  const query = state.search.trim().toLocaleLowerCase();
  if (query) list = list.filter(track => `${track.title} ${track.artist} ${track.album}`.toLocaleLowerCase().includes(query));
  return list;
}
function renderTracks(list) {
  if (!list.length) return `<div class="empty-state"><b>Здесь пока пусто</b>Добавь свои аудиофайлы — они останутся в памяти текущей вкладки браузера.<br><br><label class="primary-button file-label">Выбрать аудио<input id="file-input-empty" type="file" accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a,.aac" multiple></label></div>`;
  return `<div class="track-list">${list.map(track => `<article class="track-row"><div class="track-thumb" aria-hidden="true">♫</div><div class="track-meta"><b>${escapeHtml(track.title)}</b><span>${escapeHtml(track.artist)}${track.duration ? ` · ${formatTime(track.duration)}` : ''}</span></div><div class="row-actions"><button class="small-button" data-action="play-track" data-id="${escapeHtml(track.id)}" aria-label="Воспроизвести ${escapeHtml(track.title)}">▶</button><button class="small-button ${state.favorites.includes(track.id)?'active':''}" data-action="favorite" data-id="${escapeHtml(track.id)}" aria-label="Избранное">♥</button>${state.page==='playlists'&&state.activePlaylist?`<button class="small-button" data-action="remove-playlist-track" data-id="${escapeHtml(track.id)}" aria-label="Убрать из плейлиста">−</button>`:`<button class="small-button" data-action="add-playlist-track" data-id="${escapeHtml(track.id)}" aria-label="Добавить в плейлист">＋</button>`}</div></article>`).join('')}</div>`;
}
function librarySummary() {
  const count = state.tracks.length;
  const duration = state.tracks.reduce((sum, track) => sum + (Number(track.duration) || 0), 0);
  return `<div class="stats-grid"><div class="stat-card"><strong>${count}</strong><span>Треков в этой сессии</span></div><div class="stat-card"><strong>${state.favorites.length}</strong><span>Избранное</span></div><div class="stat-card"><strong>${formatTime(duration)}</strong><span>Известная длительность</span></div></div>`;
}
function pageContent() {
  if (state.page === 'home') return `<section class="hero"><div class="eyebrow">QWEMU MUSIC · INFINITY EVOLUTION</div><h1>Твоя музыка.<br><span style="color:#ff9868">Твои правила.</span></h1><p>Веб-плеер для собственной музыкальной коллекции. Выбирай файлы на устройстве, слушай в браузере и синхронизируй только плейлисты и настройки, если войдёшь в аккаунт.</p><div class="hero-actions"><label class="primary-button file-label">＋ Добавить музыку<input id="file-input-hero" type="file" accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a,.aac" multiple></label><button class="secondary-button" data-page="library">Открыть медиатеку</button></div></section>${librarySummary()}<div class="section-head"><div><h2>Недавно добавленные</h2><p>Файлы, выбранные в этой вкладке браузера</p></div><button class="text-button" data-page="library">Вся медиатека →</button></div>${renderTracks([...state.tracks].slice(-6).reverse())}`;
  if (state.page === 'library') return `<div class="page-head"><div><div class="eyebrow">YOUR COLLECTION</div><h1 class="page-title">Медиатека</h1><p class="muted">Файлы не отправляются на сервер. После закрытия вкладки их нужно выбрать заново.</p></div><label class="primary-button file-label">＋ Добавить файлы<input id="file-input-library" type="file" accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a,.aac" multiple></label></div>${renderTracks(visibleTracks())}`;
  if (state.page === 'favorites') return `<div class="page-head"><div><div class="eyebrow">YOUR FAVORITES</div><h1 class="page-title">Избранное</h1><p class="muted">Список избранного хранится локально.</p></div></div>${renderTracks(visibleTracks())}`;
  if (state.page === 'playlists') return `<div class="page-head"><div><div class="eyebrow">PERSONAL COLLECTIONS</div><h1 class="page-title">Плейлисты</h1><p class="muted">Создавай подборки из треков, добавленных в текущей сессии.</p></div><button class="primary-button" data-action="create-playlist">＋ Новый плейлист</button></div>${state.activePlaylist ? `<button class="text-button" data-action="back-playlists">← Все плейлисты</button><div class="section-head"><h2>${escapeHtml(state.playlists.find(p=>p.id===state.activePlaylist)?.name||'Плейлист')}</h2></div>${renderTracks(visibleTracks())}` : `<div class="playlist-grid">${state.playlists.map(p=>`<article class="playlist-card"><div class="eyebrow">QWEMU PLAYLIST</div><h3>${escapeHtml(p.name)}</h3><p>${p.trackIds.length} треков · ${escapeHtml(p.description||'Без описания')}</p><button class="secondary-button" data-action="open-playlist" data-id="${escapeHtml(p.id)}">Открыть</button> <button class="small-button" data-action="rename-playlist" data-id="${escapeHtml(p.id)}" aria-label="Переименовать">✎</button> <button class="small-button" data-action="delete-playlist" data-id="${escapeHtml(p.id)}" aria-label="Удалить">×</button></article>`).join('')}</div>${state.playlists.length?'':'<div class="empty-state"><b>Плейлистов ещё нет</b>Создай первую подборку — кнопка находится справа вверху.</div>'}`}`;
  if (state.page === 'settings') return `<div class="page-head"><div><div class="eyebrow">PREFERENCES</div><h1 class="page-title">Настройки</h1><p class="muted">Настройки веб-версии отдельно от Desktop Edition.</p></div></div><section class="surface"><h2>Внешний вид</h2><div class="form-grid"><label>Тема<select id="theme-select">${Object.keys(themes).map(theme=>`<option value="${theme}" ${state.settings.theme===theme?'selected':''}>${theme}</option>`).join('')}</select></label><label>Громкость по умолчанию<input id="volume-setting" type="range" min="0" max="1" step="0.01" value="${state.settings.volume}"></label><label class="motion-setting"><input id="reduced-motion-setting" type="checkbox" ${state.settings.reducedMotion?'checked':''}> Уменьшить анимации</label></div></section><section class="surface" style="margin-top:14px"><h2>Данные и приватность</h2><p class="muted">Аудиофайлы обрабатываются браузером и не передаются в Cloudflare. При входе синхронизируются только структурированные метаданные аккаунта.</p><button class="secondary-button" data-action="sync">Синхронизировать метаданные</button></section>`;
  if (state.page === 'profile') return `<div class="page-head"><div><div class="eyebrow">ACCOUNT</div><h1 class="page-title">Профиль</h1></div></div>${state.user ? `<section class="surface"><h2>${escapeHtml(state.user.displayName)}</h2><p class="muted">@${escapeHtml(state.user.username)} · ${escapeHtml(state.user.email||'Почта не указана')}</p><form id="profile-edit-form" class="form-grid"><label>Отображаемое имя<input name="displayName" required minlength="2" maxlength="32" value="${escapeHtml(state.user.displayName)}"></label><label>Email<input name="email" type="email" maxlength="160" value="${escapeHtml(state.user.email||'')}"></label><button class="primary-button" type="submit">Сохранить профиль</button></form><button class="secondary-button" data-action="logout">Выйти</button></section>` : `<div class="empty-state"><b>Ты используешь локальный режим</b>Войди в аккаунт, чтобы сохранять плейлисты и настройки в веб-версии.<br><br><button class="primary-button" data-action="open-auth">Войти или зарегистрироваться</button></div>`}`;
  return '';
}
function render() {
  $('#view').innerHTML = pageContent();
  document.querySelectorAll('[data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === state.page));
  $('#account-button').textContent = state.user ? state.user.displayName : 'Войти';
  $('#account-button').setAttribute('aria-label', state.user ? 'Открыть профиль' : 'Войти в аккаунт');
  const current = state.tracks.find(track => track.id === state.currentId);
  $('#player-title').textContent = current?.title || 'Ничего не воспроизводится';
  $('#player-artist').textContent = current?.artist || 'Добавь аудиофайлы из своей коллекции';
  $('#cover').textContent = current ? '♫' : 'Q';
  $('#play').textContent = audio.getStatus().playing ? 'Ⅱ' : '▶';
  $('#repeat').classList.toggle('active', state.repeat); $('#repeat').setAttribute('aria-label',state.repeat?'Выключить повтор':'Включить повтор');
  $('#play').setAttribute('aria-label', audio.getStatus().playing ? 'Пауза' : 'Воспроизвести');
}
function setPage(page) {
  if (!['home','library','playlists','favorites','settings','profile'].includes(page)) return;
  state.page = page; render();
}
function persistCloud(key, value) {
  const userId = state.user?.id;
  if (!userId || state.authTransition) return Promise.resolve(false);
  let snapshot;
  try { snapshot = JSON.parse(JSON.stringify(value)); }
  catch (error) { toast(`Не удалось подготовить облачные данные: ${error.message}`); return Promise.resolve(false); }
  return cloudWrites.enqueue(`${userId}:${key}`, async () => {
    // A queued request must never be sent under a different account's cookie.
    if (state.user?.id !== userId) return false;
    await api.request(`/api/${key}`, { method: 'PUT', headers: auth.csrfHeaders(), body: { value: snapshot } });
    return true;
  }).catch(error => {
    toast(`Локально сохранено, облачная синхронизация не выполнена: ${error.message}`);
    return false;
  });
}
async function loadCloud() {
  const userId = state.user?.id;
  if (!userId || state.authTransition) return;
  const requestId = ++state.cloudLoadId;
  const settingsRevisionAtRequest = state.settingsRevision;
  try {
    const [playlists, favorites, settings] = await Promise.all(['playlists','favorites','settings'].map(key=>api.request(`/api/${key}`)));
    // Ignore a delayed response after a newer refresh or account transition.
    if (requestId !== state.cloudLoadId || state.user?.id !== userId || state.authTransition) return;
    if (Array.isArray(playlists.value)) state.playlists = mergePlaylists(state.playlists, playlists.value);
    if (Array.isArray(favorites.value)) state.favorites = [...new Set([...state.favorites,...favorites.value])].slice(0,5000);
    if (settings.value && typeof settings.value === 'object' && state.settingsRevision === settingsRevisionAtRequest) state.settings = normalizeSettings({ ...state.settings, ...settings.value });
    saveLocal(); state.cloudReady = true; applyTheme(); render();
  } catch (error) {
    if (requestId === state.cloudLoadId && state.user?.id === userId && !state.authTransition) {
      toast(`Аккаунт доступен, но метаданные не загружены: ${error.message}`);
    }
  }
}
function mergePlaylists(local, remote) {
  const map = new Map();
  for (const item of [...remote, ...local]) if (item && typeof item.id === 'string') map.set(item.id, item);
  return [...map.values()].slice(0,300);
}
async function addFiles(fileList) {
  const selected = [...(fileList || [])].filter(file => file instanceof File && (file.type.startsWith('audio/') || /\.(mp3|wav|flac|ogg|oga|m4a|aac|aiff)$/i.test(file.name)));
  if (selected.length > 500) { toast('За один импорт можно добавить не более 500 файлов.'); return; }
  if (!selected.length) { toast('Не найдено поддерживаемых аудиофайлов.'); return; }
  const files=selected.filter(file=>file.size>0 && file.size<=512*1024*1024);
  const alreadyUsed=state.tracks.reduce((sum,track)=>sum+(Number(track.size)||0),0);
  const remainingBytes=Math.max(0,2*1024*1024*1024-alreadyUsed);
  let plannedBytes=0;
  const boundedFiles=files.filter(file=>{if(plannedBytes+file.size>remainingBytes)return false;plannedBytes+=file.size;return true;});
  const rejected=selected.length-boundedFiles.length;
  if (rejected) toast(`Пропущено файлов из-за пустого файла или лимита размера (512 МиБ на файл, 2 ГиБ на сессию): ${rejected}.`);
  if (state.tracks.length + boundedFiles.length > 5000) { toast('Лимит Web Edition — 5000 треков в одной сессии.'); return; }
  let added = 0;
  const existing=new Set(state.tracks.map(track=>track.id));
  for (const file of boundedFiles) {
    let id;
    try { id = await fingerprintFile(file); }
    catch (error) { toast(error?.message || 'Не удалось проверить аудиофайл.'); return; }
    if (existing.has(id)) continue;
    const title = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g,' ').trim() || file.name;
    state.tracks.push({ id, name: file.name, title, artist: 'Неизвестный исполнитель', album: 'Локальный файл', file, size: file.size, lastModified: file.lastModified, duration: 0 });
    existing.add(id); added++;
  }
  render(); toast(added ? `Добавлено файлов: ${added}. Они остаются в этой вкладке.` : 'Выбранные файлы уже добавлены.');
}
async function playTrack(id) {
  const index = state.tracks.findIndex(track => track.id === id); if (index < 0) return;
  const track = state.tracks[index];
  const requestId = ++state.playRequestId;
  try {
    await audio.play(track);
    if (requestId !== state.playRequestId) return;
    state.currentId = id; render();
  } catch (error) {
    if (requestId !== state.playRequestId) return;
    audio.stop(); state.currentId = null; render();
    toast(`Не удалось воспроизвести «${track.title}»: ${error.message || 'проверь формат файла и поддержку браузера'}`);
  }
}
function stopPlayback() {
  state.playRequestId += 1;
  audio.stop();
  state.currentId = null;
  render();
}
function advance(direction) {
  if (!state.tracks.length) return;
  const current = state.tracks.findIndex(track => track.id === state.currentId);
  const next = (current + direction + state.tracks.length) % state.tracks.length;
  playTrack(state.tracks[next].id);
}
function toggleFavorite(id) {
  state.favorites = state.favorites.includes(id) ? state.favorites.filter(value => value !== id) : [...state.favorites, id].slice(0,5000);
  writeLocal('favorites', state.favorites); persistCloud('favorites', state.favorites); render();
}
function createPlaylist() {
  const name = prompt('Название плейлиста:'); if (!name) return;
  const clean = name.trim().slice(0,60); if (!clean) return;
  if (state.playlists.length >= 300) { toast('Достигнут лимит в 300 плейлистов.'); return; }
  const playlist = { id: uid(), name: clean, description: '', trackIds: [] };
  state.playlists.push(playlist); writeLocal('playlists', state.playlists); persistCloud('playlists', state.playlists); render(); toast('Плейлист создан.');
}
function renamePlaylist(id) {
  const playlist=state.playlists.find(item=>item.id===id);if(!playlist)return;
  const name=prompt('Новое название плейлиста:',playlist.name);if(name===null)return;
  const clean=name.trim().slice(0,60);if(!clean){toast('Название не может быть пустым.');return;}
  playlist.name=clean;writeLocal('playlists',state.playlists);persistCloud('playlists',state.playlists);render();toast('Плейлист переименован.');
}
function deletePlaylist(id) {
  const playlist=state.playlists.find(item=>item.id===id);if(!playlist)return;
  if(!confirm(`Удалить плейлист «${playlist.name}»? Аудиофайлы останутся в медиатеке.`))return;
  state.playlists=state.playlists.filter(item=>item.id!==id);if(state.activePlaylist===id)state.activePlaylist=null;
  writeLocal('playlists',state.playlists);persistCloud('playlists',state.playlists);render();toast('Плейлист удалён.');
}
function addTrackToPlaylist(trackId) {
  if(!state.playlists.length){toast('Сначала создай плейлист.');return;}
  const options=state.playlists.map((item,index)=>`${index+1}. ${item.name}`).join('\n');
  const answer=prompt(`В какой плейлист добавить трек? Введи номер:\n${options}`);if(answer===null)return;
  const index=Number(answer)-1;const playlist=Number.isInteger(index)?state.playlists[index]:null;
  if(!playlist){toast('Номер плейлиста не распознан.');return;}
  if(!playlist.trackIds.includes(trackId))playlist.trackIds.push(trackId);
  writeLocal('playlists',state.playlists);persistCloud('playlists',state.playlists);render();toast('Трек добавлен в плейлист.');
}
function removeTrackFromPlaylist(trackId) {
  const playlist=state.playlists.find(item=>item.id===state.activePlaylist);if(!playlist)return;
  playlist.trackIds=playlist.trackIds.filter(id=>id!==trackId);writeLocal('playlists',state.playlists);persistCloud('playlists',state.playlists);render();toast('Трек убран из плейлиста.');
}
async function submitAuth(event) {
  event.preventDefault(); const errorNode = $('#auth-error'); errorNode.textContent = '';
  const username = $('#auth-username').value.trim(); const password = $('#auth-password').value;
  try {
    if (state.authMode === 'register') {
      const displayName = $('#auth-display').value.trim(); const email = $('#auth-email').value.trim();
      state.user = await auth.register({ username, displayName, email, password });
    } else state.user = await auth.login(username, password);
    state.cloudLoadId += 1;
    loadScopedLocal(); applyTheme();
    $('#auth-dialog').close(); $('#auth-form').reset(); render(); await loadCloud(); toast(`Добро пожаловать, ${state.user.displayName}.`);
  } catch (error) { errorNode.textContent = error.message; }
}
function setAuthMode(mode) {
  state.authMode = mode; const register = mode === 'register';
  $('#auth-heading').textContent = register ? 'Создание аккаунта' : 'Вход в QWEMU';
  $('#display-label').classList.toggle('hidden', !register); $('#email-label').classList.toggle('hidden', !register);
  $('#auth-display').required = register; $('#auth-password').autocomplete = register ? 'new-password' : 'current-password';
  $('#auth-submit').textContent = register ? 'Создать аккаунт' : 'Войти';
  $('#auth-switch').textContent = register ? 'Уже есть аккаунт? Войти' : 'Создать аккаунт';
  $('#auth-switch').dataset.action = register ? 'switch-login' : 'switch-register';
  $('#auth-error').textContent = '';
}
function openAuth() { setAuthMode('login'); $('#auth-dialog').showModal(); }

document.addEventListener('click', async event => {
  const page = event.target.closest('[data-page]'); if (page) { setPage(page.dataset.page); return; }
  const action = event.target.closest('[data-action]'); if (!action) return;
  const { action: name, id } = action.dataset;
  if (name === 'play-track') await playTrack(id);
  else if (name === 'favorite') toggleFavorite(id);
  else if (name === 'create-playlist') createPlaylist();
  else if (name === 'rename-playlist') renamePlaylist(id);
  else if (name === 'delete-playlist') deletePlaylist(id);
  else if (name === 'add-playlist-track') addTrackToPlaylist(id);
  else if (name === 'remove-playlist-track') removeTrackFromPlaylist(id);
  else if (name === 'open-playlist') { state.activePlaylist = id; render(); }
  else if (name === 'back-playlists') { state.activePlaylist = null; render(); }
  else if (name === 'open-auth') openAuth();
  else if (name === 'close-auth') $('#auth-dialog').close();
  else if (name === 'switch-register') setAuthMode('register');
  else if (name === 'switch-login') setAuthMode('login');
  else if (name === 'logout') {
    state.authTransition = true;
    state.cloudLoadId += 1;
    try {
      await cloudWrites.drain();
      await auth.logout();
      state.user = null; state.cloudReady = false; loadScopedLocal(); applyTheme(); render(); toast('Выход выполнен.');
    } catch (error) { toast(error.message); }
    finally { state.authTransition = false; }
  }
  else if (name === 'sync') { await loadCloud(); toast(state.cloudReady ? 'Метаданные обновлены.' : 'Синхронизация пока недоступна.'); }
  else if (name === 'stop') stopPlayback();
  else if (name === 'repeat') { state.repeat=!state.repeat; audio.setRepeat(state.repeat); render(); }
});
document.addEventListener('change', event => {
  if (event.target.matches('input[type="file"]')) { addFiles(event.target.files); event.target.value = ''; }
  if (event.target.id === 'theme-select') { state.settingsRevision += 1; state.settings.theme = validThemes.includes(event.target.value)?event.target.value:'dark-red'; applyTheme(); saveLocal(); persistCloud('settings', state.settings); }
  if (event.target.id === 'volume-setting') { state.settingsRevision += 1; state.settings.volume = Number(event.target.value); $('#volume').value = String(state.settings.volume); audio.setVolume(state.settings.volume); saveLocal(); persistCloud('settings', state.settings); }
  if (event.target.id === 'reduced-motion-setting') { state.settingsRevision += 1; state.settings.reducedMotion = event.target.checked; applyTheme(); saveLocal(); persistCloud('settings', state.settings); }
});
$('#auth-form').addEventListener('submit', submitAuth);
document.addEventListener('submit', async event => {
  if(event.target.id!=='profile-edit-form')return;event.preventDefault();
  const form=new FormData(event.target);try{state.user=await auth.updateProfile({displayName:String(form.get('displayName')||'').trim(),email:String(form.get('email')||'').trim()});render();toast('Профиль сохранён.');}
  catch(error){toast(`Не удалось сохранить профиль: ${error.message}`);}
});
$('#account-button').addEventListener('click', () => setPage(state.user ? 'profile' : (openAuth(), state.page)));
$('#search').addEventListener('input', event => { state.search = event.target.value; render(); const input=$('#search'); input.focus(); input.setSelectionRange(input.value.length,input.value.length); });
$('#stop').addEventListener('click', stopPlayback);
$('#repeat').addEventListener('click', () => { state.repeat=!state.repeat; audio.setRepeat(state.repeat); render(); });
$('#play').addEventListener('click', async () => { if (!state.currentId) { const first=state.tracks[0]; if (first) await playTrack(first.id); return; } if (audio.getStatus().playing) audio.pause(); else await audio.resume().catch(error=>toast(error.message)); render(); });
$('#prev').addEventListener('click', () => advance(-1)); $('#next').addEventListener('click', () => advance(1));
$('#seek').addEventListener('input', event => { const duration=audio.getStatus().duration; if(duration>0)audio.seek(duration*Number(event.target.value)/1000); });
$('#volume').value=String(state.settings.volume); audio.setVolume($('#volume').value);
$('#volume').addEventListener('input', event => { audio.setVolume(event.target.value); state.settings.volume=Number(event.target.value); state.settingsRevision += 1; saveLocal(); });
$('#volume').addEventListener('change', () => persistCloud('settings', state.settings));
$('#mute').addEventListener('click', () => { const muted=!$('#audio').muted; $('#audio').muted=muted; $('#mute').textContent=muted?'×':'◖))'; $('#mute').setAttribute('aria-label',muted?'Включить звук':'Отключить звук'); });
audio.on('timeupdate', () => { const status=audio.getStatus(); $('#seek').value=String(status.duration?status.position/status.duration*1000:0); $('#elapsed').textContent=formatTime(status.position); $('#duration').textContent=formatTime(status.duration); });
audio.on('loadedmetadata', () => { const track=state.tracks.find(item=>item.id===state.currentId); if(track)track.duration=audio.getStatus().duration; render(); });
audio.on('play', render); audio.on('pause', render);
audio.on('ended', () => { if (state.tracks.length > 1) advance(1); else { state.currentId=null; audio.stop(); render(); } });
audio.on('error', () => toast('Браузер не смог декодировать этот файл. Попробуй другой формат.'));
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase()==='k') { event.preventDefault(); $('#search').focus(); } if (event.key==='Escape' && $('#auth-dialog').open) $('#auth-dialog').close(); });
window.addEventListener('pagehide', () => { state.playRequestId += 1; audio.destroy(); }, { once: true });

applyTheme(); render();
const initialAuthGeneration = state.cloudLoadId;
auth.restore().then(async user => {
  if (initialAuthGeneration !== state.cloudLoadId || state.authTransition) return;
  state.user=user; if(user)loadScopedLocal(); applyTheme(); render(); if(user)await loadCloud();
}).catch(error => {
  if (initialAuthGeneration === state.cloudLoadId && !state.authTransition) toast(`Облачный сервис недоступен. Локальный режим продолжает работать: ${error.message}`);
});
