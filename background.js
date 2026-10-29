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
  closeOnOutside: true,
  useIframe: true,
  readingDefault: false,
  maxPeek: 3,
  width: 880,
  height: 620,
  theme: 'auto',
  dim: true,
  autoRoute: true,
  siteRules: {}
};

const MENU_PEEK = 'peek-inline';
const MENU_WINDOW = 'peek-window';
const MENU_FAV = 'peek-favorites';
const MENU_DISABLE = 'peek-disable-site';

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

async function openPopupWindow(url, rect) {
  if (!/^https?:\/\//i.test(url || '')) return;
  const width = 960;
  const height = 720;
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
    await chrome.windows.create(data);
  } catch (e) {
    try {
      await chrome.windows.create({ url, type: 'popup', width, height });
    } catch (e2) {
      console.warn('[Peek] 创建小窗失败', e2);
    }
  }
}

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
  const opt = frameId != null && frameId > 0 ? { frameId } : undefined;
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
    const next = Object.assign({}, stored.siteRules || {});
    next[host] = 'off';
    await chrome.storage.local.set({ siteRules: next });
    // 让已经开着的浮层立刻让位
    if (tab && tab.id != null) sendToFrame(tab.id, info.frameId, { type: 'peek:sync-rules' });
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

  if (msg.type === 'peek:open-window') {
    openPopupWindow(msg.url, msg.rect).then(() => reply({ ok: true }));
    return true;
  }
});

/* ---------- 清理 ---------- */

chrome.tabs.onRemoved.addListener((tabId) => {
  clearTimeout(pendingRelease.get(tabId));
  pendingRelease.delete(tabId);
  removeTabRule(tabId);
});

chrome.runtime.onSuspend && chrome.runtime.onSuspend.addListener(() => {});
