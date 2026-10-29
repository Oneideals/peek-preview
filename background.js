/* Peek — background service worker
 * 职责：
 *  1. 按需为某个 tab 放开 iframe 的 X-Frame-Options / CSP（会话级规则，随 tab 关闭清理）
 *  2. 右键菜单：页内预览 / 独立小窗
 *  3. 打开新标签页、创建小窗
 */

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

const MENU_PEEK = 'peek-inline';
const MENU_WINDOW = 'peek-window';
const MENU_FAV = 'peek-favorites';
const MENU_DISABLE = 'peek-disable-site';
const AI_HISTORY_MESSAGES = 12; // 6 轮对话 = 12 条 user/assistant 消息

/* ---------- iframe 头放行（会话规则，按 tab 隔离） ---------- */

const pendingRelease = new Map();

async function addTabRule(tabId) {
  if (!tabId || tabId < 0) return;
  clearTimeout(pendingRelease.get(tabId));
  pendingRelease.delete(tabId);
  try {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId] });
  } catch (e) {
    /* 规则不存在时会抛错，忽略 */
  }
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: [
        {
          id: tabId,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            /* 三种常见的"拒绝被嵌入"响应头。CORP 是最后一块：
             * XFO 与 CSP 之外，Cross-Origin-Resource-Policy: same-origin 也会拦掉 iframe。 */
            responseHeaders: [
              { header: 'x-frame-options', operation: 'remove' },
              { header: 'content-security-policy', operation: 'remove' },
              { header: 'content-security-policy-report-only', operation: 'remove' },
              { header: 'cross-origin-resource-policy', operation: 'remove' }
            ]
          },
          condition: {
            tabIds: [tabId],
            resourceTypes: ['sub_frame'],
            urlFilter: '*'
          }
        }
      ]
    });
  } catch (e) {
    console.warn('[Peek] 无法为 tab 添加放行规则', e);
  }
}

async function removeTabRule(tabId) {
  if (!tabId) return;
  try {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId] });
  } catch (e) {}
}

function scheduleRelease(tabId) {
  if (!tabId) return;
  clearTimeout(pendingRelease.get(tabId));
  // 稍作延迟：用户关掉一个 Peek 立刻点开另一个时，不要反复拆装规则
  pendingRelease.set(
    tabId,
    setTimeout(() => {
      pendingRelease.delete(tabId);
      removeTabRule(tabId);
    }, 1500)
  );
}

/* ---------- 小窗 ---------- */

const WIN_SIZE_LIMIT = 200;
const trackedPopups = new Map();

function hostKeyOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch (e) {
    return '';
  }
}

function clampSize(w, h) {
  return {
    w: Math.round(Math.min(Math.max(Number(w) || 960, 320), 2400)),
    h: Math.round(Math.min(Math.max(Number(h) || 720, 240), 1600))
  };
}

function popupSizeFor(winSizes, url) {
  const host = hostKeyOf(url);
  const s = host && winSizes && typeof winSizes === 'object' ? winSizes[host] : null;
  if (s && Number.isFinite(s.w) && Number.isFinite(s.h)) return { ...clampSize(s.w, s.h), host };
  return { w: 960, h: 720, host };
}

function trackPopup(win, host) {
  if (!win || win.id == null || !host) return;
  trackedPopups.set(win.id, {
    host,
    lastW: win.width,
    lastH: win.height,
    timer: null
  });
}

async function saveWindowSize(host, w, h) {
  const size = clampSize(w, h);
  const stored = await chrome.storage.local.get({ winSizes: {} });
  const map = Object.assign({}, stored.winSizes && typeof stored.winSizes === 'object' ? stored.winSizes : {});
  map[host] = { w: size.w, h: size.h, at: Date.now() };

  const keys = Object.keys(map);
  if (keys.length > WIN_SIZE_LIMIT) {
    keys
      .sort((a, b) => (map[a].at || 0) - (map[b].at || 0))
      .slice(0, keys.length - WIN_SIZE_LIMIT)
      .forEach((k) => delete map[k]);
  }
  try {
    await chrome.storage.local.set({ winSizes: map });
  } catch (e) {}
}

chrome.windows.onBoundsChanged.addListener((win) => {
  if (!win || win.id == null) return;
  const rec = trackedPopups.get(win.id);
  if (!rec) return;
  if (!Number.isFinite(win.width) || !Number.isFinite(win.height)) return;
  if (win.width === rec.lastW && win.height === rec.lastH) return;
  rec.lastW = win.width;
  rec.lastH = win.height;
  clearTimeout(rec.timer);
  rec.timer = setTimeout(() => {
    if (trackedPopups.get(win.id) === rec) saveWindowSize(rec.host, win.width, win.height);
  }, 700);
});

chrome.windows.onRemoved.addListener((windowId) => {
  const rec = trackedPopups.get(windowId);
  if (rec) clearTimeout(rec.timer);
  trackedPopups.delete(windowId);
});

async function openPopupWindow(url, rect) {
  if (!/^https?:\/\//i.test(url || '')) return;
  let stored = { winSizes: {} };
  try {
    stored = await chrome.storage.local.get({ winSizes: {} });
  } catch (e) {}
  const size = popupSizeFor(stored.winSizes, url);
  const width = size.w;
  const height = size.h;
  const data = { url, type: 'popup', width, height, focused: true };

  try {
    const win = await chrome.windows.getLastFocused();
    const wx = win.left ?? 0;
    const wy = win.top ?? 0;
    const ww = win.width ?? width;
    const wh = win.height ?? height;

    let left, top;
    if (rect && Number.isFinite(rect.left)) {
      left = wx + rect.left + Math.min(rect.width || 0, 360) / 2 - width / 3;
      top = wy + rect.bottom + 14;
    } else {
      left = wx + (ww - width) / 2;
      top = wy + (wh - height) / 2;
    }

    left = Math.round(Math.max(wx - 40, Math.min(left, wx + ww - width + 40)));
    top = Math.round(Math.max(0, Math.min(top, wy + wh - height + 40)));
    if (Number.isFinite(left)) data.left = left;
    if (Number.isFinite(top)) data.top = top;
  } catch (e) {
    /* 拿不到窗口位置就居中创建 */
  }

  try {
    const win = await chrome.windows.create(data);
    trackPopup(win, size.host);
  } catch (e) {
    try {
      const win = await chrome.windows.create({ url, type: 'popup', width, height });
      trackPopup(win, size.host);
    } catch (e2) {
      console.warn('[Peek] 创建小窗失败', e2);
    }
  }
}

/* ---------- 自动把新标签页转成小窗 ---------- */

const autoConverted = new Set();
const autoBusy = new Set();
let autoPopupOn = null;

async function autoPopupEnabled() {
  if (autoPopupOn !== null) return autoPopupOn;
  try {
    const stored = await chrome.storage.local.get({ autoPopupTabs: false });
    autoPopupOn = !!stored.autoPopupTabs;
  } catch (e) {
    autoPopupOn = false;
  }
  return autoPopupOn;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.autoPopupTabs) return;
  autoPopupOn = !!changes.autoPopupTabs.newValue;
});

function siteMode(rules, host) {
  if (!rules || typeof rules !== 'object') return null;
  const valid = (v) => v === 'window' || v === 'iframe' || v === 'off';
  const key = String(host || '').toLowerCase().replace(/^www\./, '');
  if (!key) return null;
  const clean = (s) => String(s || '').trim().toLowerCase().replace(/^www\./, '');
  if (valid(rules[key])) return rules[key];

  let wildcard = null;
  let wildcardLen = -1;
  for (const raw of Object.keys(rules)) {
    if (!valid(rules[raw])) continue;
    const k = clean(raw);
    if (k.slice(0, 2) !== '*.') continue;
    const suffix = k.slice(2);
    if (!suffix || key === suffix) continue;
    if (key.length > suffix.length && key.slice(-suffix.length - 1) === '.' + suffix && suffix.length > wildcardLen) {
      wildcard = rules[raw];
      wildcardLen = suffix.length;
    }
  }
  if (wildcard) return wildcard;

  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(key)) {
    const labels = key.split('.');
    for (let i = 1; i < labels.length - 1; i++) {
      const parent = labels.slice(i).join('.');
      if (valid(rules[parent])) return rules[parent];
    }
  }
  return null;
}

async function considerAutoPopup(tab) {
  if (!tab || tab.id == null || tab.openerTabId == null) return;
  if (autoConverted.has(tab.id) || autoBusy.has(tab.id)) return;
  if (!(await autoPopupEnabled())) return;
  const url = tab.pendingUrl || tab.url || '';
  if (!url) return;

  autoBusy.add(tab.id);
  try {
    if (autoConverted.has(tab.id)) return;
    if (!/^https?:\/\//i.test(url)) return;
    const host = hostKeyOf(url);
    if (!host) return;
    const stored = await chrome.storage.local.get({ siteRules: {}, winSizes: {} });
    if (siteMode(stored.siteRules, host) === 'off') return;

    autoConverted.add(tab.id);
    const size = popupSizeFor(stored.winSizes, url);
    try {
      const win = await chrome.windows.create({
        tabId: tab.id,
        type: 'popup',
        width: size.w,
        height: size.h,
        focused: true
      });
      trackPopup(win, size.host);
    } catch (e) {
      autoConverted.delete(tab.id);
      console.warn('[Peek] 自动转小窗失败', e);
    }
  } finally {
    autoBusy.delete(tab.id);
  }
}

chrome.tabs.onCreated.addListener((tab) => {
  considerAutoPopup(tab);
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (!info.url && !info.status) return;
  considerAutoPopup(tab);
});

/* ---------- 阅读模式：借 offscreen 页面跑 Readability ---------- */

async function ensureOffscreen() {
  try {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (contexts && contexts.length) return true;
  } catch (e) {}
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_PARSER'],
      justification: '用 Readability 抽取文章正文，需要 DOMParser'
    });
    return true;
  } catch (e) {
    console.warn('[Peek] offscreen 创建失败', e);
    return false;
  }
}

async function runExtract(msg, reply) {
  const ready = await ensureOffscreen();
  if (!ready) return reply({ ok: false, error: '无法启动正文解析器' });
  try {
    const out = await chrome.runtime.sendMessage({ ...msg, hop: true });
    reply(out || { ok: false, error: '解析器没有响应' });
  } catch (e) {
    reply({ ok: false, error: '解析器没有响应' });
  }
}

/* ---------- AI 问答：OpenAI 兼容接口 ---------- */

function aiTextOf(data) {
  if (!data || typeof data !== 'object') return '';
  const choice = Array.isArray(data.choices) ? data.choices[0] : null;
  const content = choice && (choice.message ? choice.message.content : choice.text);
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  if (typeof data.output_text === 'string') return data.output_text;
  if (typeof data.response === 'string') return data.response;
  return '';
}

async function runAi(msg, reply) {
  let settings;
  try {
    settings = await chrome.storage.local.get(DEFAULTS);
  } catch (e) {
    return reply({ ok: false, error: '读不到设置' });
  }
  if (!settings.aiEnabled) return reply({ ok: false, error: 'AI 问答没有启用' });

  const endpoint = String(settings.aiEndpoint || '').trim();
  const model = String(settings.aiModel || '').trim();
  const key = String(settings.aiKey || '').trim();
  if (!/^https?:\/\//i.test(endpoint)) return reply({ ok: false, error: '接口地址不是有效的 http(s) URL' });
  if (!model) return reply({ ok: false, error: '还没填模型名' });

  const question = String(msg.question || '').trim().slice(0, 4000);
  if (!question) return reply({ ok: false, error: '问题是空的' });

  const pageText = String(msg.pageText || '').slice(0, 16000);
  const pageTitle = String(msg.pageTitle || '').slice(0, 200);
  const pageUrl = String(msg.pageUrl || '').slice(0, 1000);
  const base =
    String(settings.aiPrompt || '').trim() ||
    '你是一个阅读助手。只依据用户提供的网页内容回答，内容里没有的信息要直接说明没读到，不要编造。回答使用简体中文，简洁、分点。';

  const system = [
    base,
    '',
    '页面标题：' + (pageTitle || '（未知）'),
    '页面地址：' + (pageUrl || '（未知）'),
    '页面正文：',
    pageText ? pageText : '（没有取到正文。请仅根据标题和网址回答，并说明你没能读到页面内容。）'
  ].join('\n');

  const messages = [{ role: 'system', content: system }];
  if (Array.isArray(msg.history)) {
    msg.history.slice(-AI_HISTORY_MESSAGES).forEach((m) => {
      if (!m || (m.role !== 'user' && m.role !== 'assistant')) return;
      const content = String(m.content || '').slice(0, 4000);
      if (content) messages.push({ role: m.role, content });
    });
  }
  messages.push({ role: 'user', content: question });

  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = 'Bearer ' + key;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, messages, temperature: 0.3, stream: false }),
      signal: controller.signal
    });
  } catch (e) {
    clearTimeout(timer);
    return reply({ ok: false, error: controller.signal.aborted ? '请求超时（45 秒）' : '连不上接口：' + String((e && e.message) || e) });
  }
  clearTimeout(timer);

  const raw = await res.text().catch(() => '');
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch (e) {}

  if (!res.ok) {
    const detail =
      (data && data.error && (data.error.message || data.error.type)) || String(raw || '').replace(/\s+/g, ' ').slice(0, 240);
    return reply({ ok: false, error: '接口返回 HTTP ' + res.status + (detail ? '：' + detail : '') });
  }
  const text = aiTextOf(data).trim();
  if (!text) return reply({ ok: false, error: '接口返回了无法识别的内容，确认它兼容 OpenAI Chat Completions' });
  reply({ ok: true, text: text.slice(0, 20000) });
}

/* ---------- 右键菜单 ---------- */

function buildMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_PEEK,
      title: '用 Peek 悬浮预览',
      contexts: ['link']
    });
    chrome.contextMenus.create({
      id: MENU_WINDOW,
      title: '在独立小窗中打开',
      contexts: ['link']
    });
    chrome.contextMenus.create({
      id: MENU_FAV,
      title: '查看收藏的链接（Alt + U）',
      contexts: ['page']
    });
    chrome.contextMenus.create({
      id: MENU_DISABLE,
      title: '在此网站停用 Peek',
      contexts: ['page']
    });
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(DEFAULTS);
  await chrome.storage.local.set({ ...DEFAULTS, ...stored });
  buildMenus();
});

chrome.runtime.onStartup.addListener(buildMenus);

/* 发给某个 tab 的指定 frame。all_frames 打开后，不带 frameId 会让
 * 每个内嵌 frame 的内容脚本都执行一遍，必须精确投递。 */
function sendToFrame(tabId, frameId, msg) {
  // frameId 0 也表示顶层 frame；不能省略参数，否则会广播到所有 iframe。
  const opt = { frameId: Number.isInteger(frameId) ? frameId : 0 };
  return chrome.tabs.sendMessage(tabId, msg, opt).catch(() => null);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = info.linkUrl;

  if (info.menuItemId === MENU_FAV) {
    if (tab && tab.id != null) sendToFrame(tab.id, info.frameId, { type: 'peek:favorites' });
    return;
  }

  if (info.menuItemId === MENU_DISABLE) {
    let host = '';
    try {
      host = new URL(tab && tab.url ? tab.url : '').hostname.toLowerCase().replace(/^www\./, '');
    } catch (e) {}
    if (!host) return;
    const stored = await chrome.storage.local.get({ siteRules: {} });
    const rules = stored.siteRules || {};
    const prev = rules[host] === 'window' || rules[host] === 'iframe' || rules[host] === 'off' ? rules[host] : null;
    const next = Object.assign({}, rules);
    next[host] = 'off';
    await chrome.storage.local.set({ siteRules: next });
    // 已开着的浮层由 content 的 storage.onChanged 同步设置；这里给一次反悔机会
    if (tab && tab.id != null) {
      sendToFrame(tab.id, info.frameId, {
        type: 'peek:notice',
        text: '已在此网站停用 Peek',
        undo: { host, prev }
      });
    }
    return;
  }

  if (!url) return;

  if (info.menuItemId === MENU_WINDOW) {
    openPopupWindow(url, null);
    return;
  }

  if (info.menuItemId === MENU_PEEK) {
    if (!tab || tab.id == null) {
      openPopupWindow(url, null);
      return;
    }
    const ack = await sendToFrame(tab.id, info.frameId, { type: 'peek:open', url });
    if (ack === null) {
      // 内容脚本不在（chrome:// 等页面）时退回小窗
      openPopupWindow(url, null);
    }
  }
});

/* ---------- 消息 ---------- */

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabId = sender && sender.tab ? sender.tab.id : null;

  if (!msg || typeof msg.type !== 'string') return;

  if (msg.type === 'peek:frame-rule') {
    addTabRule(tabId).then(() => reply({ ok: true }));
    return true;
  }

  if (msg.type === 'peek:release-rule') {
    scheduleRelease(tabId);
    reply({ ok: true });
    return false;
  }

  if (msg.type === 'peek:open-tab') {
    if (/^https?:\/\//i.test(msg.url || '')) {
      chrome.tabs.create({ url: msg.url });
    }
    reply({ ok: true });
    return false;
  }

  if (msg.type === 'peek:extract') {
    if (msg.hop) return false; // 自己转发给 offscreen 的那一跳，别接
    runExtract(msg, reply);
    return true;
  }

  if (msg.type === 'peek:ai') {
    runAi(msg, reply);
    return true;
  }

  if (msg.type === 'peek:open-window') {
    openPopupWindow(msg.url, msg.rect).then(() => reply({ ok: true }));
    return true;
  }
});

/* ---------- 清理 ---------- */

chrome.tabs.onRemoved.addListener((tabId) => {
  clearTimeout(pendingRelease.get(tabId));
  pendingRelease.delete(tabId);
  autoConverted.delete(tabId);
  autoBusy.delete(tabId);
  removeTabRule(tabId);
});

chrome.runtime.onSuspend && chrome.runtime.onSuspend.addListener(() => {});
