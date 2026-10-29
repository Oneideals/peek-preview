const DEFAULTS = {
  triggerShift: true,
  triggerAlt: false,
  triggerMeta: false,
  triggerMiddle: false,
  triggerDouble: false,
  triggerHover: false,
  hoverDelay: 450,
  triggerDrag: true,
  selectionTools: true,
  selectionDrag: true,
  searchEngine: 'google',
  translateEngine: 'google',
  translateTo: 'zh',
  closeOnOutside: true,
  useIframe: true,
  readingDefault: false,
  maxPeek: 3,
  width: 880,
  height: 620,
  theme: 'auto',
  dim: true,
  blur: true,
  autoRoute: true,
  autoPopupTabs: false,
  aiEnabled: false,
  aiEndpoint: '',
  aiModel: '',
  aiKey: '',
  aiPrompt: '',
  siteRules: {},
  siteSizes: {},
  winSizes: {}
};

const SEARCH_URLS = {
  google: (q) => 'https://www.google.com/search?q=' + encodeURIComponent(q),
  bing: (q) => 'https://www.bing.com/search?q=' + encodeURIComponent(q),
  baidu: (q) => 'https://www.baidu.com/s?wd=' + encodeURIComponent(q),
  duckduckgo: (q) => 'https://duckduckgo.com/?q=' + encodeURIComponent(q)
};

const FAV_LIMIT = 400;

const HINTS = {
  iframe: '在当前页面上浮出一层，看完按 Esc 或点外侧就关，不留标签页。极少数站点仍会拒绝嵌入，可切到独立小窗。',
  window: '每次触发都开一个没有标签栏的小窗，兼容所有站点，代价是会多一个窗口。'
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

let state = { ...DEFAULTS };

function save(patch) {
  Object.assign(state, patch);
  chrome.storage.local.set(patch);
}

function render() {
  $$('input[type="checkbox"][data-k]').forEach((el) => {
    el.checked = Boolean(state[el.dataset.k]);
  });

  $$('input[type="number"][data-k]').forEach((el) => {
    el.value = state[el.dataset.k];
  });

  $$('select[data-k]').forEach((el) => {
    el.value = state[el.dataset.k];
  });

  $$('input[type="text"][data-k],input[type="password"][data-k],textarea[data-k]').forEach((el) => {
    el.value = state[el.dataset.k] == null ? '' : state[el.dataset.k];
  });

  $$('#mode button').forEach((b) => {
    b.classList.toggle('on', b.dataset.mode === (state.useIframe ? 'iframe' : 'window'));
  });

  $$('#theme button').forEach((b) => {
    b.classList.toggle('on', b.dataset.theme === state.theme);
  });

  $$('#maxPeek button').forEach((b) => {
    b.classList.toggle('on', Number(b.dataset.max) === Number(state.maxPeek));
  });

  $('#modeHint').textContent = HINTS[state.useIframe ? 'iframe' : 'window'];

  const aiBody = $('#aiBody');
  if (aiBody) aiBody.hidden = !state.aiEnabled;

  renderRules();
  renderSizes();
  renderFavCount();
}

function countKeys(obj) {
  return obj && typeof obj === 'object' ? Object.keys(obj).length : 0;
}

function renderSizes() {
  const n1 = countKeys(state.siteSizes);
  const n2 = countKeys(state.winSizes);
  const el = $('#sizeCount');
  if (el) el.textContent = n1 || n2 ? '浮层 ' + n1 + ' · 小窗 ' + n2 : '暂无';
  const btn = $('#sizeClear');
  if (btn) {
    const any = n1 + n2 > 0;
    btn.disabled = !any;
    btn.style.opacity = any ? '' : '.45';
    btn.style.cursor = any ? 'pointer' : 'default';
  }
}

/* 添加规则时用哪种模式。规则列表里每个站点各自可选，这里只决定新条目的默认值。 */
function draftMode() {
  const sel = $('#ruleMode');
  if (!sel) return 'window';
  const v = sel.value;
  return RULE_ORDER.indexOf(v) === -1 ? 'window' : v;
}

const RULE_LABEL = { iframe: '浮层', window: '小窗', off: '停用' };
const RULE_ORDER = ['iframe', 'window', 'off'];

function renderRules() {
  const box = $('#rules');
  if (!box) return;
  const map = state.siteRules && typeof state.siteRules === 'object' ? state.siteRules : {};
  const keys = Object.keys(map)
    .filter((k) => RULE_ORDER.indexOf(map[k]) !== -1)
    .sort();
  box.textContent = '';

  if (!keys.length) {
    const p = document.createElement('p');
    p.className = 'rule-empty';
    p.textContent = '暂无规则';
    box.appendChild(p);
    return;
  }

  keys.forEach((k) => {
    const row = document.createElement('div');
    row.className = 'rule';

    const name = document.createElement('span');
    name.className = 'rule-h';
    name.textContent = k;
    name.title = k;

    const sel = document.createElement('select');
    sel.className = 'rule-sel';
    sel.setAttribute('aria-label', k + ' 的打开方式');
    RULE_ORDER.forEach((mode) => {
      const o = document.createElement('option');
      o.value = mode;
      o.textContent = RULE_LABEL[mode];
      o.selected = map[k] === mode;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => {
      const next = Object.assign({}, state.siteRules || {});
      next[k] = sel.value;
      save({ siteRules: next });
      render();
    });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'rule-x';
    del.textContent = '移除';
    del.setAttribute('aria-label', '移除 ' + k);
    del.addEventListener('click', () => {
      const next = Object.assign({}, state.siteRules || {});
      delete next[k];
      save({ siteRules: next });
      render();
    });

    row.appendChild(name);
    row.appendChild(sel);
    row.appendChild(del);
    box.appendChild(row);
  });
}

/* 收藏夹计数 + 入口 */
async function renderFavCount() {
  const el = $('#favCount');
  if (!el) return;
  let n = 0;
  try {
    const d = await chrome.storage.local.get({ favorites: [] });
    n = Array.isArray(d.favorites) ? d.favorites.length : 0;
  } catch (e) {}
  el.textContent = String(n);
}

function normalizeHost(value) {
  let s = String(value || '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^[a-z]+:\/\//i, '').replace(/[/?#].*$/, '');
  let wildcard = false;
  if (s.indexOf('*.') === 0) {
    wildcard = true;
    s = s.slice(2);
  }
  s = s.replace(/^www\./, '');
  if (!/^[a-z0-9][a-z0-9.\-]*$/.test(s) || s.indexOf('.') === -1) return '';
  return (wildcard ? '*.' : '') + s;
}

/* ---------------- 当前页快捷操作 ---------------- */

function shorten(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch (e) {
    return '';
  }
}

async function activePage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab && /^https?:\/\//i.test(tab.url || '')) return tab;
  } catch (e) {}
  return null;
}

function setQuickEnabled(on) {
  ['#qSearch', '#qWindow', '#qFav'].forEach((sel) => {
    const el = $(sel);
    if (el) el.disabled = !on;
  });
}

async function refreshQuick() {
  const hint = $('#quickHint');
  const tab = await activePage();
  if (!tab) {
    setQuickEnabled(false);
    if (hint) hint.textContent = '当前标签页不是网页（chrome:// 或扩展页面），快捷操作不可用。';
    return null;
  }
  setQuickEnabled(true);
  if (hint) hint.textContent = '当前页：' + shorten(tab.title || tab.url, 52);
  return tab;
}

async function quickSearch() {
  const tab = await refreshQuick();
  if (!tab) return;
  const title = String(tab.title || tab.url || '').trim();
  if (!title) return;
  const build = SEARCH_URLS[state.searchEngine] || SEARCH_URLS.google;
  await chrome.tabs.create({ url: build(title.slice(0, 120)) });
  const hint = $('#quickHint');
  if (hint) hint.textContent = '已在新标签页搜索：' + shorten(title, 40);
}

async function quickWindow() {
  const tab = await refreshQuick();
  if (!tab) return;
  await chrome.runtime.sendMessage({ type: 'peek:open-window', url: tab.url, rect: null }).catch(() => {});
}

async function quickFavorite() {
  const tab = await refreshQuick();
  if (!tab) {
    const hint = $('#quickHint');
    if (hint) hint.textContent = '这里不是网页，没法收藏。';
    return;
  }
  const title = String(tab.title || '').replace(/\s+/g, ' ').trim().slice(0, 120) || hostOf(tab.url);
  const stored = await chrome.storage.local.get({ favorites: [] });
  const list = Array.isArray(stored.favorites) ? stored.favorites : [];
  const hint = $('#quickHint');
  if (list.some((x) => x && x.url === tab.url)) {
    if (hint) hint.textContent = '这个页面已经收藏过了。';
    return;
  }
  list.unshift({ url: tab.url, title, host: hostOf(tab.url), at: Date.now(), tags: [] });
  await chrome.storage.local.set({ favorites: list.slice(0, FAV_LIMIT) });
  renderFavCount();
  if (hint) hint.textContent = '已收藏：' + shorten(title, 40);
}

/* ---------------- 配置导入 / 导出 ---------------- */

function cleanTags(raw) {
  const arr = Array.isArray(raw) ? raw : String(raw || '').split(/[,，;；\s]+/);
  const out = [];
  for (const item of arr) {
    const tag = String(item || '').replace(/^#/, '').replace(/\s+/g, '').trim();
    if (!tag || tag.length > 16) continue;
    if (!out.some((x) => x.toLowerCase() === tag.toLowerCase())) out.push(tag);
    if (out.length >= 3) break;
  }
  return out;
}

function normalizeFavorite(raw) {
  if (!raw || typeof raw.url !== 'string') return null;
  let u;
  try {
    u = new URL(raw.url);
  } catch (e) {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const title = typeof raw.title === 'string' ? raw.title.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  return {
    url: u.href,
    title: title || host,
    host,
    at: Number.isFinite(raw.at) ? raw.at : Date.now(),
    tags: cleanTags(raw.tags != null ? raw.tags : raw.tag)
  };
}

const NUM_RANGES = {
  hoverDelay: [120, 3000],
  maxPeek: [2, 4],
  width: [360, 1600],
  height: [240, 1200]
};

const ENUMS = {
  searchEngine: ['google', 'bing', 'baidu', 'duckduckgo'],
  translateEngine: ['google', 'bing', 'deepl'],
  translateTo: ['zh', 'en', 'ja', 'ko'],
  theme: ['auto', 'light', 'dark', 'sepia']
};

function sanitizeSettings(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const k of Object.keys(DEFAULTS)) {
    if (!(k in raw)) continue;
    const def = DEFAULTS[k];
    const v = raw[k];
    if (typeof def === 'number') {
      const n = Number(v);
      if (Number.isFinite(n)) {
        const range = NUM_RANGES[k];
        out[k] = range ? Math.min(Math.max(Math.round(n), range[0]), range[1]) : n;
      }
    } else if (typeof def === 'boolean') {
      if (typeof v === 'boolean') out[k] = v;
    } else if (typeof def === 'string') {
      if (typeof v === 'string') {
        const allow = ENUMS[k];
        if (allow && allow.indexOf(v) === -1) continue;
        out[k] = v.slice(0, k === 'aiPrompt' ? 4000 : 1000);
      }
    } else if (def && typeof def === 'object' && v && typeof v === 'object' && !Array.isArray(v)) {
      if (k === 'siteRules') {
        const map = {};
        Object.keys(v).forEach((host) => {
          if (v[host] === 'window' || v[host] === 'iframe' || v[host] === 'off') map[host] = v[host];
        });
        out[k] = map;
      } else {
        const map = {};
        Object.keys(v).forEach((host) => {
          const s = v[host];
          if (s && Number.isFinite(s.w) && Number.isFinite(s.h)) {
            map[host] = { w: Math.round(s.w), h: Math.round(s.h), at: Number.isFinite(s.at) ? s.at : Date.now() };
          }
        });
        out[k] = map;
      }
    }
  }
  return out;
}

function downloadJson(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  a.href = url;
  a.download = 'peek-backup-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function exportConfig() {
  const hint = $('#ioHint');
  try {
    const stored = await chrome.storage.local.get(null);
    const settings = {};
    Object.keys(DEFAULTS).forEach((k) => {
      if (stored[k] !== undefined) settings[k] = stored[k];
    });
    const favorites = Array.isArray(stored.favorites) ? stored.favorites : [];
    downloadJson({
      app: 'peek',
      version: chrome.runtime.getManifest().version,
      exportedAt: new Date().toISOString(),
      settings,
      favorites
    });
    if (hint) hint.textContent = '已导出配置和 ' + favorites.length + ' 条收藏。文件里包含 AI Key，请妥善保管。';
  } catch (e) {
    if (hint) hint.textContent = '导出失败：' + String((e && e.message) || e);
  }
}

async function importConfigFile(file) {
  const hint = $('#ioHint');
  if (!file) return;
  if (file.size > 4 * 1024 * 1024) {
    if (hint) hint.textContent = '导入失败：文件超过 4 MB。';
    return;
  }
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (e) {
    if (hint) hint.textContent = '导入失败：不是有效的 JSON 文件。';
    return;
  }

  let settings = {};
  let favorites = null;
  if (Array.isArray(data)) {
    favorites = data;
  } else if (data && typeof data === 'object') {
    settings = sanitizeSettings(data.settings || data);
    if (Array.isArray(data.favorites)) favorites = data.favorites;
    else if (Array.isArray(data.links)) favorites = data.links;
  } else {
    if (hint) hint.textContent = '导入失败：文件结构无法识别。';
    return;
  }

  let favAdded = 0;
  let favSkipped = 0;
  try {
    if (Object.keys(settings).length) await chrome.storage.local.set(settings);
    if (favorites) {
      const stored = await chrome.storage.local.get({ favorites: [] });
      const list = Array.isArray(stored.favorites) ? stored.favorites : [];
      const seen = new Set(list.map((x) => x && x.url));
      for (let i = favorites.length - 1; i >= 0; i--) {
        const item = normalizeFavorite(favorites[i]);
        if (!item) {
          favSkipped++;
          continue;
        }
        if (seen.has(item.url) || list.length >= FAV_LIMIT) {
          favSkipped++;
          continue;
        }
        seen.add(item.url);
        list.unshift(item);
        favAdded++;
      }
      await chrome.storage.local.set({ favorites: list.slice(0, FAV_LIMIT) });
    }
    state = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
    render();
    await refreshQuick();
    const bits = [];
    const n = Object.keys(settings).length;
    if (n) bits.push('导入 ' + n + ' 项设置');
    if (favorites) bits.push('新增 ' + favAdded + ' 条收藏' + (favSkipped ? '（跳过 ' + favSkipped + ' 条）' : ''));
    if (hint) hint.textContent = bits.length ? bits.join('，') + '。' : '这个文件里没有可导入的设置或收藏。';
  } catch (e) {
    if (hint) hint.textContent = '导入失败：' + String((e && e.message) || e);
  }
}

function bind() {
  $$('input[type="checkbox"][data-k]').forEach((el) => {
    el.addEventListener('change', () => {
      save({ [el.dataset.k]: el.checked });
      if (el.dataset.k === 'aiEnabled') render();
    });
  });

  $$('input[type="number"][data-k]').forEach((el) => {
    el.addEventListener('change', () => {
      const min = Number(el.min) || 0;
      const max = Number(el.max) || 9999;
      const raw = parseInt(el.value, 10);
      const value = Math.min(Math.max(Number.isFinite(raw) ? raw : DEFAULTS[el.dataset.k], min), max);
      el.value = value;
      save({ [el.dataset.k]: value });
    });
  });

  $$('select[data-k]').forEach((el) => {
    el.addEventListener('change', () => {
      save({ [el.dataset.k]: el.value });
    });
  });

  $$('input[type="text"][data-k],input[type="password"][data-k],textarea[data-k]').forEach((el) => {
    el.addEventListener('change', () => {
      save({ [el.dataset.k]: el.value });
    });
  });

  $$('#mode button').forEach((b) => {
    b.addEventListener('click', () => {
      const useIframe = b.dataset.mode === 'iframe';
      save({ useIframe });
      render();
    });
  });

  $$('#theme button').forEach((b) => {
    b.addEventListener('click', () => {
      save({ theme: b.dataset.theme });
      render();
    });
  });

  $$('#maxPeek button').forEach((b) => {
    b.addEventListener('click', () => {
      save({ maxPeek: Number(b.dataset.max) });
      render();
    });
  });

  const ruleAdd = $('#ruleAdd');
  const ruleHost = $('#ruleHost');
  if (ruleAdd && ruleHost) {
    const commit = () => {
      const h = normalizeHost(ruleHost.value);
      if (!h) {
        ruleHost.focus();
        return;
      }
      const next = Object.assign({}, state.siteRules || {});
      next[h] = draftMode();
      ruleHost.value = '';
      save({ siteRules: next });
      render();
    };
    ruleAdd.addEventListener('click', commit);
    ruleHost.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
    });
  }

  const favOpen = $('#favOpen');
  if (favOpen) {
    favOpen.addEventListener('click', async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.id != null) {
          await chrome.tabs.sendMessage(tab.id, { type: 'peek:favorites' }, { frameId: 0 }).catch(() => {});
          window.close();
        }
      } catch (e) {}
    });
  }

  const sizeClear = $('#sizeClear');
  if (sizeClear) {
    sizeClear.addEventListener('click', () => {
      save({ siteSizes: {}, winSizes: {} });
      render();
    });
  }

  const qSearch = $('#qSearch');
  if (qSearch) qSearch.addEventListener('click', quickSearch);
  const qWindow = $('#qWindow');
  if (qWindow) qWindow.addEventListener('click', quickWindow);
  const qFav = $('#qFav');
  if (qFav) qFav.addEventListener('click', quickFavorite);

  const exportCfg = $('#exportCfg');
  if (exportCfg) exportCfg.addEventListener('click', exportConfig);

  const importCfg = $('#importCfg');
  const importFile = $('#importFile');
  if (importCfg && importFile) {
    importCfg.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', () => {
      const file = importFile.files && importFile.files[0];
      importFile.value = '';
      importConfigFile(file);
    });
  }

  $('#reset').addEventListener('click', () => {
    state = { ...DEFAULTS };
    chrome.storage.local.set(DEFAULTS);
    render();
  });
}

(async function init() {
  try {
    const stored = await chrome.storage.local.get(DEFAULTS);
    state = { ...DEFAULTS, ...stored };
  } catch (e) {}
  bind();
  render();
  refreshQuick();
})();
