/* Peek — 内容脚本
 * 在页面里拦截链接点击，用一个隔离在 Shadow DOM 里的浮层加载目标页面。
 * 支持多个浮层并排，以及把正文抽出来重排的阅读视图。
 */

(function () {
  'use strict';

  if (window.__peekContentLoaded) return;
  window.__peekContentLoaded = true;

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

  /* 多久等不到 load 事件就判定"这个站点嵌不进来" */
  const LOAD_TIMEOUT = 6000;

  /* 登录 / OAuth 这类页面在 iframe 里几乎必然出问题：
   * SameSite 会话 cookie 不发、授权跳转被拒、或站点直接拒绝被嵌套。
   * 命中就直接走独立小窗，而不是先白等一次。 */
  const AUTH_HOST_EXACT = /^(accounts\.google\.com|login\.microsoftonline\.com|login\.live\.com|appleid\.apple\.com|id\.apple\.com|accounts\.spotify\.com|auth\.alipay\.com|openapi\.alipay\.com)$/i;
  const AUTH_HOST_VENDOR = /(^|\.)(okta|auth0|onelogin|pingidentity|duosecurity|jumpcloud|azuread|authing|cognito)\./i;
  const AUTH_HOST_PREFIX = /^(accounts?|login|signin|sign-in|sso|auth|oauth2?|passport|cas|identity)\./i;
  const AUTH_PATH = /\/(login|signin|sign-in|sign_in|logout|oauth|oauth2|authorize|saml|sso|cas|session\/new|account\/login|captcha|challenge|auth)(\/|$|\?|#)/i;

  const ICON = {
    read:
      '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M8.2 2.4H4.4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 2 2h3.8"/><path d="M8.2 2.4l3.4 11.2M8.2 2.4l3.4 11.2"/></svg>',
    dock:
      '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="1.9" y="2.9" width="12.2" height="10.2" rx="2.2"/><path d="M9.6 2.9v10.2"/></svg>',
    window:
      '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="2" y="4.6" width="8.4" height="8.2" rx="1.8"/><path d="M13.4 2v3.2M13.4 2h-3.2"/><path d="M13.4 2 9.2 6.2"/></svg>',
    tab:
      '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9.4 2.6h4v4"/><path d="M13.4 2.6 7.9 8.1"/><path d="M12.8 9.6v2.2a1.6 1.6 0 0 1-1.6 1.6H5.1a1.6 1.6 0 0 1-1.6-1.6V5.7a1.6 1.6 0 0 1 1.6-1.6h2.2"/></svg>',
    close:
      '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4.4 4.4l7.2 7.2M11.6 4.4l-7.2 7.2"/></svg>',
    star:
      '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M8 2.2l1.8 3.7 4 .6-2.9 2.8.7 4-3.6-1.9-3.6 1.9.7-4L2.2 6.5l4-.6z"/></svg>',
    starOn:
      '<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"><path d="M8 2.2l1.8 3.7 4 .6-2.9 2.8.7 4-3.6-1.9-3.6 1.9.7-4L2.2 6.5l4-.6z"/></svg>',
    export:
      '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.4v7.6"/><path d="M5.2 7.2 8 10l2.8-2.8"/><path d="M2.8 11.4v1.4a1 1 0 0 0 1 1h8.4a1 1 0 0 0 1-1v-1.4"/></svg>',
    trash:
      '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.2 4.6h9.6"/><path d="M6.4 4.6V3.4h3.2v1.2"/><path d="M4.6 4.6l.6 8h5.6l.6-8"/><path d="M6.8 7v3.6M9.2 7v3.6"/></svg>'
  };

  const STYLES = `
:host {
  all: initial;
  position: fixed;
  inset: 0;
  display: block;
  z-index: 2147483647;
  pointer-events: none;
  --pk-bg: #ffffff;
  --pk-bg-2: #f3f3f6;
  --pk-text: #17171b;
  --pk-muted: #86868f;
  --pk-line: rgba(0,0,0,.09);
  --pk-hover: rgba(0,0,0,.055);
  --pk-accent: #5b4fd6;
  --pk-accent-soft: rgba(91,79,214,.12);
  --pk-shadow: 0 28px 70px rgba(12,12,20,.26), 0 2px 8px rgba(12,12,20,.10);
  --pk-dim: rgba(14,14,20,.16);
  color-scheme: light;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
}
:host([data-theme="dark"]) {
  --pk-bg: #1e1e22;
  --pk-bg-2: #151518;
  --pk-text: #f2f2f5;
  --pk-muted: #8b8b96;
  --pk-line: rgba(255,255,255,.10);
  --pk-hover: rgba(255,255,255,.08);
  --pk-accent: #a99cff;
  --pk-accent-soft: rgba(169,156,255,.16);
  --pk-shadow: 0 28px 80px rgba(0,0,0,.62), 0 2px 10px rgba(0,0,0,.44);
  --pk-dim: rgba(0,0,0,.44);
  color-scheme: dark;
}
/* 遮罩只负责变暗，不拦截事件 —— 事件交给下面的文档级监听，
 * 否则遮罩会连右键菜单一起吃掉，也没法在浮层打开时再点第二个链接。 */
.backdrop {
  position: fixed; inset: 0; background: var(--pk-dim);
  pointer-events: none; opacity: 0; transition: opacity .18s ease;
}
:host([data-ready]) .backdrop { opacity: 1; }
:host([data-nodim]) .backdrop { background: transparent; }
:host([data-docked]) .backdrop { background: transparent; }
.card {
  position: fixed; display: flex; flex-direction: column;
  background: var(--pk-bg); border: 1px solid var(--pk-line);
  border-radius: 14px; box-shadow: var(--pk-shadow); overflow: hidden;
  pointer-events: auto; opacity: 0; transform: scale(.986);
  transition: opacity .16s ease, transform .16s ease;
}
:host([data-ready]) .card { opacity: 1; transform: none; }
:host([data-multi]) .card.focused { border-color: var(--pk-accent); }
.bar {
  display: flex; align-items: center; gap: 10px; flex: 0 0 auto;
  padding: 8px 8px 8px 12px; border-bottom: 1px solid var(--pk-line);
  background: var(--pk-bg); cursor: grab;
  user-select: none; -webkit-user-select: none;
}
.card.dragging .bar { cursor: grabbing; }
.fav { width: 16px; height: 16px; border-radius: 4px; flex: 0 0 auto; object-fit: contain; }
.meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.t1 {
  font-size: 12.5px; font-weight: 600; line-height: 1.35; color: var(--pk-text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.t2 {
  font-size: 11px; line-height: 1.35; color: var(--pk-muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.acts { display: flex; align-items: center; gap: 1px; flex: 0 0 auto; }
.btn {
  width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
  border: 0; background: transparent; color: var(--pk-muted);
  border-radius: 7px; padding: 0; cursor: pointer;
  transition: background .12s ease, color .12s ease;
}
.btn:hover { background: var(--pk-hover); color: var(--pk-text); }
.btn.on { background: var(--pk-accent-soft); color: var(--pk-accent); }
.stage { position: relative; flex: 1; min-height: 0; background: var(--pk-bg-2); }
.frame { width: 100%; height: 100%; border: 0; display: block; background: #fff; }
.card.dragging .frame, .card.resizing .frame { pointer-events: none; }
.loader {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  gap: 8px; font-size: 12px; color: var(--pk-muted); background: var(--pk-bg-2);
  transition: opacity .22s ease;
}
.loader.hide { opacity: 0; pointer-events: none; }
.spin {
  width: 13px; height: 13px; border-radius: 50%;
  border: 1.5px solid var(--pk-line); border-top-color: var(--pk-accent);
  animation: pk-spin .7s linear infinite;
}
@keyframes pk-spin { to { transform: rotate(360deg); } }
.fallback {
  position: absolute; inset: 0; display: none; flex-direction: column;
  align-items: center; justify-content: center; gap: 9px; padding: 28px;
  text-align: center; background: var(--pk-bg-2);
}
.fallback.show { display: flex; }
.fb-t { font-size: 13px; font-weight: 600; color: var(--pk-text); }
.fb-d { font-size: 12px; line-height: 1.65; color: var(--pk-muted); max-width: 340px; }
.fb-row { display: flex; gap: 8px; margin-top: 2px; }
.fb-b {
  font-size: 12px; font-weight: 500; color: #fff; font-family: inherit;
  background: var(--pk-accent); border: 0; border-radius: 7px;
  padding: 7px 14px; cursor: pointer;
}
.fb-b.ghost { background: transparent; color: var(--pk-accent); border: 1px solid var(--pk-line); }
.rz { position: absolute; z-index: 3; }
.rz-e { top: 0; right: 0; width: 6px; height: 100%; cursor: ew-resize; }
.rz-s { left: 0; bottom: 0; height: 6px; width: 100%; cursor: ns-resize; }
.rz-se { right: 0; bottom: 0; width: 16px; height: 16px; cursor: nwse-resize; }
.toast {
  font-size: 12.5px; line-height: 1.45; color: var(--pk-text);
  background: var(--pk-bg); border: 1px solid var(--pk-line);
  border-radius: 10px; padding: 9px 15px; box-shadow: var(--pk-shadow);
  max-width: 76vw; text-align: center;
  opacity: 0; transform: translateY(6px);
  transition: opacity .18s ease, transform .18s ease;
}
:host([data-ready]) .toast { opacity: 1; transform: none; }

/* 拖拽时跟着光标的小 pill */
.chip {
  font-size: 12px; font-weight: 500; color: var(--pk-text);
  background: var(--pk-bg); border: 1px solid var(--pk-line);
  border-radius: 8px; padding: 6px 11px; box-shadow: var(--pk-shadow);
  white-space: nowrap; pointer-events: none; max-width: 70vw;
  overflow: hidden; text-overflow: ellipsis;
}

/* 收藏面板 */
.fav-card { width: 440px; max-width: calc(100vw - 32px); height: auto; max-height: 72vh; }
.fav-body { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.fav-list { overflow-y: auto; padding: 4px; }
.fav-item {
  display: flex; align-items: center; gap: 9px; padding: 7px 8px;
  border-radius: 9px; cursor: pointer;
}
.fav-item:hover { background: var(--pk-hover); }
.fav-ic { width: 16px; height: 16px; border-radius: 4px; flex: 0 0 auto; object-fit: contain; }
.fav-tx { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.fav-t1 {
  font-size: 12.5px; font-weight: 500; color: var(--pk-text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.fav-t2 {
  font-size: 10.5px; color: var(--pk-muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.fav-x {
  width: 24px; height: 24px; flex: 0 0 auto; display: flex; align-items: center; justify-content: center;
  border: 0; background: transparent; color: var(--pk-muted); border-radius: 6px;
  padding: 0; cursor: pointer; opacity: 0; transition: opacity .12s ease;
}
.fav-item:hover .fav-x { opacity: 1; }
.fav-x:hover { background: var(--pk-hover); color: var(--pk-text); }
.fav-empty {
  padding: 30px 24px; text-align: center; font-size: 12px;
  line-height: 1.7; color: var(--pk-muted);
}
.fav-empty b { color: var(--pk-text); font-weight: 600; }
`;

  const TEMPLATE = `
<div class="backdrop"></div>
<div class="card" role="dialog" aria-label="链接预览">
  <header class="bar">
    <img class="fav" alt="" referrerpolicy="no-referrer">
    <div class="meta"><div class="t1"></div><div class="t2"></div></div>
    <div class="acts">
      <button class="btn" data-act="read" title="阅读视图：抽出正文重排" aria-label="阅读视图">${ICON.read}</button>
      <button class="btn" data-act="dock" title="停靠右侧（分屏）" aria-label="停靠右侧">${ICON.dock}</button>
      <button class="btn" data-act="window" title="在独立小窗中打开" aria-label="独立小窗">${ICON.window}</button>
      <button class="btn" data-act="tab" title="在新标签页打开" aria-label="新标签页">${ICON.tab}</button>
      <button class="btn" data-act="close" title="关闭 (Esc)" aria-label="关闭">${ICON.close}</button>
    </div>
  </header>
  <div class="stage">
    <iframe class="frame" title="链接预览" referrerpolicy="no-referrer-when-downgrade"
      allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"></iframe>
    <div class="loader"><span class="spin"></span><span class="lt">正在加载</span></div>
    <div class="fallback">
      <div class="fb-t">这个页面没能嵌进来</div>
      <div class="fb-d"></div>
      <div class="fb-row">
        <button class="fb-b" data-act="window">用独立小窗打开</button>
        <button class="fb-b ghost" data-act="always-window">始终用窗口</button>
        <button class="fb-b ghost" data-act="read">试试阅读视图</button>
      </div>
    </div>
  </div>
  <div class="rz rz-e" data-rz="e"></div>
  <div class="rz rz-s" data-rz="s"></div>
  <div class="rz rz-se" data-rz="se"></div>
</div>`;

  const FAV_TEMPLATE = `
<div class="card fav-card" role="dialog" aria-label="收藏的链接">
  <header class="bar">
    <div class="meta">
      <div class="t1">收藏的链接</div>
      <div class="t2" data-role="count"></div>
    </div>
    <div class="acts">
      <button class="btn" data-fact="save-current" title="收藏当前页面" aria-label="收藏当前页面">${ICON.star}</button>
      <button class="btn" data-fact="export" title="导出为 Markdown" aria-label="导出">${ICON.export}</button>
      <button class="btn" data-fact="close" title="关闭 (Esc)" aria-label="关闭">${ICON.close}</button>
    </div>
  </header>
  <div class="fav-body">
    <div class="fav-list" data-role="list"></div>
    <div class="fav-empty" data-role="empty" style="display:none">
      还没有收藏。<br>把链接<b>拖到页面空白处</b>，或 <b>Ctrl + 右键</b>点击链接即可收藏。
    </div>
  </div>
</div>`;

  let settings = { ...DEFAULTS };
  const peeks = [];
  let hoverTimer = null;
  let lastHovered = null;
  let sizeSaveTimer = null;
  let sharedSheet = null;
  let dragLink = null;
  let dragChip = null;
  let dragChipText = null;
  let favHost = null;

  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

  /* ---------------- 设置 ---------------- */

  async function loadSettings() {
    try {
      if (!chrome || !chrome.runtime || !chrome.runtime.id) return;
      settings = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
    } catch (e) {}
  }

  function watchSettings() {
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        for (const k of Object.keys(changes)) {
          if (k in DEFAULTS) settings[k] = changes[k].newValue;
        }
        syncChrome();
      });
    } catch (e) {}
  }

  function sendBg(msg) {
    try {
      if (!chrome || !chrome.runtime || !chrome.runtime.id) return Promise.resolve(null);
      return chrome.runtime.sendMessage(msg).catch(() => null);
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  /* ---------------- 站点路由 ---------------- */

  function hostKeyOf(urlStr) {
    try {
      return new URL(urlStr).hostname.toLowerCase().replace(/^www\./, '');
    } catch (e) {
      return '';
    }
  }

  /* 站点规则三种取值：
   *   'window' —— 这个站点一律走独立小窗
   *   'iframe' —— 这个站点一律走页内浮层（不启用启发式降级）
   *   'off'    —— 这个站点彻底停用 Peek，点击完全交给浏览器
   * 没有规则时返回 null。 */
  function ruleFor(host) {
    const map = settings.siteRules;
    if (!host || !map || typeof map !== 'object') return null;
    const v = map[host];
    return v === 'window' || v === 'iframe' || v === 'off' ? v : null;
  }

  function setRule(host, mode) {
    if (!host) return;
    const next = Object.assign({}, settings.siteRules || {});
    next[host] = mode;
    settings.siteRules = next;
    try {
      chrome.storage.local.set({ siteRules: next });
    } catch (e) {}
  }

  function looksAuthish(parsed) {
    const host = parsed.hostname.toLowerCase();
    if (AUTH_HOST_EXACT.test(host)) return true;
    if (AUTH_HOST_VENDOR.test(host)) return true;
    if (AUTH_HOST_PREFIX.test(host)) return true;
    if (AUTH_PATH.test(parsed.pathname)) return true;
    return false;
  }

  /* 决定这个链接该怎么打开。返回值：
   *   'off'    站点被停用，什么都不做
   *   'window' 开独立小窗
   *   'iframe' 开页内浮层
   * 优先级：记住的站点规则 > "始终小窗"全局设置 > 登录/OAuth 启发式 > 浮层 */
  function routeFor(parsed, host) {
    const rule = ruleFor(host);
    if (rule === 'off') return 'off';
    if (rule === 'window' || rule === 'iframe') return rule;
    if (!settings.useIframe) return 'window';
    if (settings.autoRoute !== false && looksAuthish(parsed)) return 'window';
    return 'iframe';
  }

  function rectOf(rect) {
    if (!rect) return null;
    return { left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width };
  }

  function openInWindow(url, rect) {
    sendBg({ type: 'peek:open-window', url, rect: rectOf(rect) });
  }

  let toastHost = null;
  let toastTimer = null;

  function toast(text, ms) {
    try {
      if (toastHost) {
        toastHost.remove();
        toastHost = null;
      }
      clearTimeout(toastTimer);

      const { host, shadow } = mountFloat();
      host.setAttribute('data-peek-toast', '');
      host.style.setProperty('left', '0', 'important');
      host.style.setProperty('right', '0', 'important');
      host.style.setProperty('bottom', '26px', 'important');
      host.style.setProperty('display', 'flex', 'important');
      host.style.setProperty('justify-content', 'center', 'important');
      host.setAttribute('data-theme', resolveTheme());

      const box = document.createElement('div');
      box.className = 'toast';
      box.textContent = text;
      shadow.appendChild(box);
      document.documentElement.appendChild(host);
      toastHost = host;

      requestAnimationFrame(() => {
        if (toastHost === host) host.setAttribute('data-ready', '');
      });
      toastTimer = setTimeout(() => {
        try {
          host.remove();
        } catch (e) {}
        if (toastHost === host) toastHost = null;
      }, ms || 2800);
    } catch (e) {}
  }

  /* 浮层这条路走不通 —— 关掉它，换成真窗口，并记住这个站点。
   * 真窗口是第一方上下文：登录态、OAuth 跳转、页内查找全都正常。 */
  function degrade(peek, why) {
    const url = peek.url;
    const host = peek.hostKey;
    const rect = peek.card.getBoundingClientRect();
    const remember = settings.autoRoute !== false;

    closePeek(peek);
    openInWindow(url, rect);
    if (remember && host) setRule(host, 'window');
    toast(host + ' ' + why + '，已改用独立小窗' + (remember ? '，下次直接开小窗' : ''));
  }

  /* ---------------- 触发判定 ---------------- */

  function isOurs(e) {
    if (!peeks.length) return false;
    const path = (e.composedPath && e.composedPath()) || [];
    return peeks.some((p) => path.indexOf(p.host) !== -1);
  }

  function findAnchor(node) {
    const path = (node && node.composedPath && node.composedPath()) || [];
    for (let i = 0; i < path.length; i++) {
      const el = path[i];
      if (el && el.nodeType === 1 && el.tagName === 'A') return el;
    }
    let el = node;
    if (el && el.nodeType !== 1) el = el.parentElement;
    while (el) {
      if (el.tagName === 'A') return el;
      el = el.parentElement;
    }
    return null;
  }

  function hrefOf(a) {
    const raw = a.getAttribute('href') || a.getAttribute('xlink:href') || '';
    if (!raw) return null;
    let u;
    try {
      u = new URL(raw, document.baseURI);
    } catch (e) {
      return null;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  }

  function skipAnchor(a) {
    if (a.hasAttribute('download')) return true;
    if (a.closest && a.closest('[data-peek-ignore]')) return true;
    const raw = a.getAttribute('href') || '';
    if (!raw || raw.charAt(0) === '#') return true;
    if (/^(javascript|mailto|tel|data|blob|magnet):/i.test(raw)) return true;
    return false;
  }

  function wantClick(e) {
    return (
      (settings.triggerShift && e.shiftKey) ||
      (settings.triggerAlt && e.altKey) ||
      (settings.triggerMeta && (e.metaKey || e.ctrlKey))
    );
  }

  function fire(e) {
    if (isOurs(e)) return null;
    const a = findAnchor(e.target);
    if (!a || skipAnchor(a)) return null;
    const url = hrefOf(a);
    return url ? { a, url } : null;
  }

  function onClick(e) {
    if (e.button !== 0 || e.detail > 1) return;
    if (!wantClick(e)) return;
    const hit = fire(e);
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    openPeek(hit.url, hit.a.getBoundingClientRect());
  }

  function onAuxClick(e) {
    if (!settings.triggerMiddle || e.button !== 1) return;
    const hit = fire(e);
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    openPeek(hit.url, hit.a.getBoundingClientRect());
  }

  function onDblClick(e) {
    if (!settings.triggerDouble) return;
    const hit = fire(e);
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    const sel = window.getSelection();
    if (sel && sel.removeAllRanges) sel.removeAllRanges();
    openPeek(hit.url, hit.a.getBoundingClientRect());
  }

  function onMouseOver(e) {
    if (!settings.triggerHover || peeks.length) return;
    const hit = fire(e);
    if (!hit) return;
    const a = hit.a;
    if (a === lastHovered) return;
    lastHovered = a;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      if (peeks.length) return;
      openPeek(hit.url, a.getBoundingClientRect());
    }, settings.hoverDelay || 450);
  }

  function onMouseOut(e) {
    clearTimeout(hoverTimer);
    if (!lastHovered) return;
    const to = e.relatedTarget;
    if (to && (to === lastHovered || (lastHovered.contains && lastHovered.contains(to)))) return;
    lastHovered = null;
  }

  /* ---------------- 拖拽触发 ---------------- */

  /* 落点是不是"页面空白处"。输入框、可编辑区、链接、按钮、标记了
   * data-peek-ignore 的容器都不接 —— 那些地方的原生拖拽行为必须保留。
   * 站点自己的拖放面板多数落在具体容器上，这条检查能挡掉大部分。 */
  function dropBlocked(node) {
    const chain = [];
    if (node && node.composedPath) {
      for (const n of node.composedPath()) if (n && n.nodeType === 1) chain.push(n);
    }
    let el = node;
    if (el && el.nodeType !== 1) el = el.parentElement;
    while (el) {
      chain.push(el);
      el = el.parentElement;
    }
    for (const n of chain) {
      if (!n.tagName) continue;
      if (n.hasAttribute && n.hasAttribute('data-peek-ignore')) return true;
      const tag = n.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (tag === 'A' || tag === 'BUTTON') return true;
      if (n.isContentEditable) return true;
    }
    return false;
  }

  function onDragStart(e) {
    if (!settings.triggerDrag) return;
    const a = findAnchor(e.target);
    if (!a || skipAnchor(a)) return;
    const url = hrefOf(a);
    if (!url) return;
    dragLink = { url, host: hostKeyOf(url) };
    try {
      e.dataTransfer.setData('text/uri-list', url);
      e.dataTransfer.setData('text/plain', url);
      e.dataTransfer.effectAllowed = 'copy';
    } catch (err) {}
  }

  function showDragChip(x, y) {
    if (!dragChip) {
      const { host, shadow } = mountFloat();
      const box = document.createElement('div');
      box.className = 'chip';
      shadow.appendChild(box);
      host.setAttribute('data-theme', resolveTheme());
      host.style.setProperty('right', 'auto', 'important');
      host.style.setProperty('bottom', 'auto', 'important');
      document.documentElement.appendChild(host);
      dragChip = host;
      dragChipText = box;
      host.setAttribute('data-peek-chip', '');
    }
    dragChipText.textContent = '松开预览 ' + (dragLink ? dragLink.host : '');
    dragChip.style.left = Math.round(Math.min(x + 14, window.innerWidth - 12)) + 'px';
    dragChip.style.top = Math.round(Math.min(y + 16, window.innerHeight - 12)) + 'px';
  }

  function hideDragChip() {
    if (dragChip) {
      try {
        dragChip.remove();
      } catch (e) {}
    }
    dragChip = null;
    dragChipText = null;
  }

  function onDragOver(e) {
    if (!dragLink) return;
    if (isOurs(e) || dropBlocked(e.target)) {
      hideDragChip();
      return;
    }
    e.preventDefault();
    try {
      e.dataTransfer.dropEffect = 'copy';
    } catch (err) {}
    showDragChip(e.clientX, e.clientY);
  }

  function onDrop(e) {
    const link = dragLink;
    dragLink = null;
    hideDragChip();
    if (!link) return;
    if (isOurs(e) || dropBlocked(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    openPeek(link.url, { left: e.clientX, top: e.clientY, bottom: e.clientY, width: 0 });
  }

  function onDragEnd() {
    dragLink = null;
    hideDragChip();
  }

  /* ---------------- 收藏 / 稍后读 ---------------- */

  const FAV_LIMIT = 400;

  function favRead() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get({ favorites: [] }, (d) => {
          resolve(Array.isArray(d && d.favorites) ? d.favorites : []);
        });
      } catch (e) {
        resolve([]);
      }
    });
  }

  function favWrite(list) {
    try {
      chrome.storage.local.set({ favorites: list.slice(0, FAV_LIMIT) });
    } catch (e) {}
  }

  async function favToggle(url, title) {
    const list = await favRead();
    const i = list.findIndex((x) => x && x.url === url);
    if (i !== -1) {
      list.splice(i, 1);
      favWrite(list);
      toast('已取消收藏');
      return false;
    }
    list.unshift({ url, title: title || hostKeyOf(url), host: hostKeyOf(url), at: Date.now() });
    favWrite(list);
    toast('已收藏 · 按 Alt + U 查看列表');
    return true;
  }

  function onContextMenu(e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    const a = findAnchor(e.target);
    if (!a || skipAnchor(a)) return;
    const url = hrefOf(a);
    if (!url) return;
    e.preventDefault();
    e.stopPropagation();
    const title = (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90);
    favToggle(url, title);
  }

  function closeFavorites() {
    if (!favHost) return;
    try {
      favHost.remove();
    } catch (e) {}
    favHost = null;
  }

  async function favExport() {
    const list = await favRead();
    if (!list.length) {
      toast('收藏夹是空的');
      return;
    }
    const md = list.map((x) => '- [' + (x.title || x.host || x.url) + '](' + x.url + ')').join('\n');
    try {
      await navigator.clipboard.writeText('# Peek 收藏\n\n' + md + '\n');
      toast('已复制 ' + list.length + ' 条到剪贴板');
    } catch (e) {
      toast('复制失败：浏览器拒绝了剪贴板访问');
    }
  }

  async function renderFavList(shadow) {
    const list = await favRead();
    const box = shadow.querySelector('[data-role="list"]');
    const empty = shadow.querySelector('[data-role="empty"]');
    const count = shadow.querySelector('[data-role="count"]');
    if (!box) return;

    box.textContent = '';
    count.textContent = list.length ? list.length + ' 个链接' : '';
    box.style.display = list.length ? 'block' : 'none';
    empty.style.display = list.length ? 'none' : 'block';

    list.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'fav-item';

      const ic = document.createElement('img');
      ic.className = 'fav-ic';
      ic.alt = '';
      ic.referrerPolicy = 'no-referrer';
      try {
        ic.src = chrome.runtime.getURL('/_favicon/?pageUrl=' + encodeURIComponent(item.url) + '&size=32');
      } catch (e) {}
      ic.addEventListener('error', () => {
        ic.style.visibility = 'hidden';
      });

      const tx = document.createElement('div');
      tx.className = 'fav-tx';
      const t1 = document.createElement('div');
      t1.className = 'fav-t1';
      // 标题来自网页，一律走 textContent，不当 HTML 拼
      t1.textContent = item.title || item.host || item.url;
      const t2 = document.createElement('div');
      t2.className = 'fav-t2';
      t2.textContent = item.host || '';
      tx.appendChild(t1);
      tx.appendChild(t2);

      const x = document.createElement('button');
      x.className = 'fav-x';
      x.type = 'button';
      x.title = '取消收藏';
      x.setAttribute('aria-label', '取消收藏');
      x.innerHTML = ICON.trash;
      x.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        favRead().then((cur) => {
          favWrite(cur.filter((y) => !(y && y.url === item.url)));
          renderFavList(shadow);
        });
      });

      row.appendChild(ic);
      row.appendChild(tx);
      row.appendChild(x);
      row.addEventListener('click', () => {
        const r = row.getBoundingClientRect();
        closeFavorites();
        openPeek(item.url, r);
      });
      box.appendChild(row);
    });
  }

  async function openFavorites() {
    if (favHost) {
      closeFavorites();
      return;
    }
    let built;
    try {
      built = mountFloat();
    } catch (e) {
      return;
    }
    const { host, shadow } = built;
    shadow.innerHTML = FAV_TEMPLATE;
    host.setAttribute('data-theme', resolveTheme());
    host.setAttribute('data-peek-fav', '');
    document.documentElement.appendChild(host);
    favHost = host;

    const card = shadow.querySelector('.card');
    card.style.left = Math.max(16, window.innerWidth - 440 - 28) + 'px';
    card.style.top = '76px';
    requestAnimationFrame(() => {
      if (favHost === host) host.setAttribute('data-ready', '');
    });

    bindMove(card, shadow.querySelector('.bar'));

    shadow.addEventListener(
      'click',
      (e) => {
        const el = e.target && e.target.closest ? e.target.closest('[data-fact]') : null;
        if (!el) return;
        e.preventDefault();
        e.stopPropagation();
        const act = el.getAttribute('data-fact');
        if (act === 'close') closeFavorites();
        else if (act === 'export') favExport();
        else if (act === 'save-current') {
          favToggle(location.href, (document.title || '').replace(/\s+/g, ' ').trim().slice(0, 90)).then(() =>
            renderFavList(shadow)
          );
        }
      },
      true
    );

    await renderFavList(shadow);
  }

  function inFav(e) {
    if (!favHost) return false;
    const path = (e.composedPath && e.composedPath()) || [];
    return path.indexOf(favHost) !== -1;
  }

  /* 点浮层外面就收起来。规则：
   * - 只要有浮层处于停靠状态：那是分屏模式，不关
   * - 如果这次是带修饰键点链接：留给 openPeek 开第二个浮层，不关
   * - 单个浮层关它自己；多个浮层一次全关（逐个用 Esc）
   */
  let swallowUntil = 0;

  function onOutPointerDown(e) {
    // 收藏面板：点在面板外面就收起来
    if (favHost && !inFav(e)) closeFavorites();

    if (!peeks.length || e.button !== 0) return;
    if (!settings.closeOnOutside) return;
    if (isOurs(e)) return;

    if (wantClick(e) && findAnchor(e.target)) return;
    if (peeks.some((p) => p.card.classList.contains('docked'))) return;

    e.preventDefault();
    swallowUntil = Date.now() + 60;
    if (peeks.length === 1) closePeek(peeks[0]);
    else peeks.slice().forEach(closePeek);
  }

  function swallowClick(e) {
    if (!swallowUntil || Date.now() > swallowUntil) return;
    swallowUntil = 0;
    e.preventDefault();
    e.stopPropagation();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape' && favHost) {
      e.preventDefault();
      e.stopPropagation();
      closeFavorites();
      return;
    }

    /* Alt + U 唤出收藏夹。用 e.code 而不是 e.key：
     * macOS 上按住 Option 会把 u 变成死键，e.key 会是 "Dead"。 */
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyU' && !e.repeat) {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      e.preventDefault();
      e.stopPropagation();
      openFavorites();
      return;
    }

    if (!peeks.length) return;
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    const target = peeks.find((p) => p.card.classList.contains('focused')) || peeks[peeks.length - 1];
    if (target) closePeek(target);
  }

  /* ---------------- 骨架 ---------------- */

  function ensureSheet() {
    if (sharedSheet) return sharedSheet;
    try {
      sharedSheet = new CSSStyleSheet();
      sharedSheet.replaceSync(STYLES);
      return sharedSheet;
    } catch (e) {
      return null;
    }
  }

  function applyStyles(shadow) {
    const sheet = ensureSheet();
    if (sheet) {
      shadow.adoptedStyleSheets = [sheet];
      return;
    }
    const style = document.createElement('style');
    style.textContent = STYLES;
    shadow.appendChild(style);
  }

  /* 建一个钉在视口上的 shadow 宿主。toast / 拖拽 chip / 收藏面板共用。
   * 宿主本身 pointer-events: none，交互交给内部的 .card。 */
  function mountFloat() {
    const host = document.createElement('div');
    host.style.setProperty('all', 'initial', 'important');
    host.style.setProperty('position', 'fixed', 'important');
    host.style.setProperty('inset', '0', 'important');
    host.style.setProperty('display', 'block', 'important');
    host.style.setProperty('z-index', '2147483647', 'important');
    host.style.setProperty('pointer-events', 'none', 'important');
    const shadow = host.attachShadow({ mode: 'open' });
    applyStyles(shadow);
    return { host, shadow };
  }

  /* 拖标题栏移动。浮层和收藏面板共用。 */
  function bindMove(card, bar) {
    if (!bar) return;
    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest('button')) return;
      const r = card.getBoundingClientRect();
      const sx = e.clientX;
      const sy = e.clientY;
      card.classList.add('dragging');
      const move = (ev) => {
        const nx = clamp(r.left + ev.clientX - sx, 8, window.innerWidth - r.width - 8);
        const ny = clamp(r.top + ev.clientY - sy, 8, window.innerHeight - r.height - 8);
        card.style.left = Math.round(nx) + 'px';
        card.style.top = Math.round(ny) + 'px';
      };
      const up = () => {
        card.classList.remove('dragging');
        window.removeEventListener('pointermove', move, true);
        window.removeEventListener('pointerup', up, true);
        window.removeEventListener('pointercancel', up, true);
      };
      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointerup', up, true);
      window.addEventListener('pointercancel', up, true);
      e.preventDefault();
    });
  }

  function resolveTheme() {
    if (settings.theme === 'light' || settings.theme === 'dark') return settings.theme;
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (e) {
      return 'light';
    }
  }

  function geometry(rect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(settings.width || 880, Math.max(360, vw - 40));
    const h = Math.min(settings.height || 620, Math.max(280, vh - 40));

    let left;
    let top;

    if (rect && rect.left != null) {
      left = rect.left + (rect.width || 0) / 2 - w / 2;
      top = (rect.bottom != null ? rect.bottom : rect.top) + 10;
      if (top + h > vh - 12) top = rect.top - h - 10;
      if (top < 12) top = (vh - h) / 2;
    } else {
      left = (vw - w) / 2;
      top = (vh - h) / 2;
    }

    left = Math.max(12, Math.min(left, vw - w - 12));
    top = Math.max(12, Math.min(top, vh - h - 12));
    return { left: Math.round(left), top: Math.round(top), w: Math.round(w), h: Math.round(h) };
  }

  /* 同时存在多个浮层时自动并排；已停靠的不参与排列 */
  function tile() {
    const shown = peeks.filter((p) => !p.card.classList.contains('docked'));
    if (shown.length < 2) return;
    const margin = 14;
    const gap = 10;
    const avail = window.innerWidth - margin * 2 - gap * (shown.length - 1);
    const w = Math.max(340, Math.floor(avail / shown.length));
    const h = Math.min(settings.height || 620, window.innerHeight - margin * 2);
    const top = Math.max(12, Math.round((window.innerHeight - h) / 2));

    shown.forEach((p, i) => {
      p.card.style.width = w + 'px';
      p.card.style.height = h + 'px';
      p.card.style.left = Math.round(margin + i * (w + gap)) + 'px';
      p.card.style.top = top + 'px';
    });
  }

  function syncChrome() {
    const multi = peeks.length > 1;
    const dim = settings.dim !== false;
    peeks.forEach((p, i) => {
      p.host.setAttribute('data-docked', p.card.classList.contains('docked') ? '' : null);
      if (multi) p.host.setAttribute('data-multi', '');
      else p.host.removeAttribute('data-multi');
      if (!dim || i > 0) p.host.setAttribute('data-nodim', '');
      else p.host.removeAttribute('data-nodim');
    });
  }

  function setFocus(p) {
    peeks.forEach((x) => x.card.classList.toggle('focused', x === p));
  }

  /* ---------------- 打开 / 关闭 ---------------- */

  async function openPeek(url, rect) {
    if (!url || !/^https?:\/\//i.test(url)) return;

    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      return;
    }

    const site = hostKeyOf(url);
    const route = routeFor(parsed, site);
    if (route === 'off') return; // 这个站点被用户停用了，点击原样交给浏览器
    if (route === 'window') {
      openInWindow(url, rect);
      // 只在"启发式判断"时提示；用户显式设的规则或全局小窗模式不必啰嗦
      if (settings.useIframe && ruleFor(site) !== 'window') {
        toast('这是登录 / 授权页，已直接用独立小窗打开');
      }
      return;
    }

    const maxPeek = clamp(settings.maxPeek || 3, 1, 4);
    while (peeks.length >= maxPeek) closePeek(peeks[0]);

    const theme = resolveTheme();

    const host = document.createElement('div');
    host.setAttribute('data-peek-root', '');
    // 宿主元素是唯一暴露给页面 CSS 的节点，关键布局用内联 !important 钉死
    host.style.setProperty('all', 'initial', 'important');
    host.style.setProperty('position', 'fixed', 'important');
    host.style.setProperty('inset', '0', 'important');
    host.style.setProperty('display', 'block', 'important');
    host.style.setProperty('z-index', '2147483647', 'important');
    host.style.setProperty('pointer-events', 'none', 'important');

    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = TEMPLATE;
    applyStyles(shadow);

    host.setAttribute('data-theme', theme);

    const card = shadow.querySelector('.card');
    const frame = shadow.querySelector('.frame');
    const bar = shadow.querySelector('.bar');
    const loader = shadow.querySelector('.loader');
    const fallback = shadow.querySelector('.fallback');
    const readBtn = shadow.querySelector('[data-act="read"]');
    const dockBtn = shadow.querySelector('[data-act="dock"]');

    const g = geometry(rect);
    card.style.left = g.left + 'px';
    card.style.top = g.top + 'px';
    card.style.width = g.w + 'px';
    card.style.height = g.h + 'px';

    const hostname = parsed.hostname.replace(/^www\./, '');
    let pathText = parsed.pathname + parsed.search;
    try {
      pathText = decodeURIComponent(pathText);
    } catch (e) {}
    if (!pathText) pathText = '/';

    const t1 = shadow.querySelector('.t1');
    const t2 = shadow.querySelector('.t2');

    t1.textContent = hostname;
    t2.textContent = pathText;
    t2.title = url;
    shadow.querySelector('.lt').textContent = '正在加载 ' + hostname;

    try {
      const fav = shadow.querySelector('.fav');
      fav.src = chrome.runtime.getURL('/_favicon/?pageUrl=' + encodeURIComponent(url) + '&size=32');
      fav.addEventListener('error', () => {
        fav.style.display = 'none';
      });
    } catch (e) {}

    document.documentElement.appendChild(host);

    const peek = {
      host, shadow, card, frame, bar, loader, fallback, readBtn, dockBtn, t1,
      url, theme, hostName: hostname, hostKey: site, timer: null, prev: null, reading: false
    };

    peeks.push(peek);
    setFocus(peek);
    syncChrome();
    if (peeks.length > 1) tile();

    requestAnimationFrame(() => {
      if (peeks.indexOf(peek) !== -1) host.setAttribute('data-ready', '');
    });

    /* --- 交互 --- */

    card.addEventListener('pointerdown', () => setFocus(peek), true);

    shadow.addEventListener('click', (e) => {
      const el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      const act = el.getAttribute('data-act');

      if (act === 'close') closePeek(peek);
      else if (act === 'tab') {
        sendBg({ type: 'peek:open-tab', url });
        closePeek(peek);
      } else if (act === 'window') {
        const r = card.getBoundingClientRect();
        sendBg({ type: 'peek:open-window', url, rect: { left: r.left, top: r.top, bottom: r.bottom, width: r.width } });
        closePeek(peek);
      } else if (act === 'always-window') {
        const r = card.getBoundingClientRect();
        setRule(peek.hostKey, 'window');
        sendBg({ type: 'peek:open-window', url, rect: { left: r.left, top: r.top, bottom: r.bottom, width: r.width } });
        closePeek(peek);
        toast(peek.hostKey + ' 以后都用独立小窗打开');
      } else if (act === 'dock') toggleDock(peek);
      else if (act === 'read') toggleRead(peek);
    }, true);

    bindMove(card, bar);

    let draft = null;
    shadow.querySelectorAll('[data-rz]').forEach((handle) => {
      handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const dir = handle.getAttribute('data-rz');
        const r = card.getBoundingClientRect();
        const sx = e.clientX;
        const sy = e.clientY;
        card.classList.add('resizing');

        const move = (ev) => {
          let w = r.width;
          let h = r.height;
          if (dir.indexOf('e') !== -1) w = clamp(r.width + ev.clientX - sx, 340, window.innerWidth - r.left - 8);
          if (dir.indexOf('s') !== -1) h = clamp(r.height + ev.clientY - sy, 240, window.innerHeight - r.top - 8);
          card.style.width = Math.round(w) + 'px';
          card.style.height = Math.round(h) + 'px';
          draft = { width: Math.round(w), height: Math.round(h) };
        };

        const up = () => {
          card.classList.remove('resizing');
          window.removeEventListener('pointermove', move, true);
          window.removeEventListener('pointerup', up, true);
          window.removeEventListener('pointercancel', up, true);
          if (draft) {
            clearTimeout(sizeSaveTimer);
            sizeSaveTimer = setTimeout(() => {
              try {
                chrome.storage.local.set(draft);
              } catch (err) {}
              draft = null;
            }, 400);
          }
        };

        window.addEventListener('pointermove', move, true);
        window.addEventListener('pointerup', up, true);
        window.addEventListener('pointercancel', up, true);
      });
    });

    frame.addEventListener('load', () => {
      if (peeks.indexOf(peek) === -1) return;
      clearTimeout(peek.timer);
      loader.classList.add('hide');
      fallback.classList.remove('show');
    });

    peek.timer = setTimeout(() => {
      if (peeks.indexOf(peek) === -1) return;
      if (loader.classList.contains('hide')) return;
      if (settings.autoRoute !== false) {
        degrade(peek, '加载超时');
        return;
      }
      showFallback(peek, '站点拒绝了嵌入，或加载超时。换成独立小窗一般能打开，也可以试着直接抽正文。');
    }, LOAD_TIMEOUT);

    if (settings.readingDefault) {
      toggleRead(peek);
      return;
    }

    await sendBg({ type: 'peek:frame-rule' });
    if (peeks.indexOf(peek) === -1) return;
    try {
      frame.src = url;
    } catch (e) {
      showFallback(peek, '这个地址没法预览。');
    }
  }

  function showFallback(peek, text) {
    peek.loader.classList.add('hide');
    peek.fallback.querySelector('.fb-d').textContent = text;
    peek.fallback.classList.add('show');
  }

  function closePeek(peek) {
    const i = peeks.indexOf(peek);
    if (i === -1) return;
    peeks.splice(i, 1);
    clearTimeout(peek.timer);

    try {
      peek.frame.removeAttribute('srcdoc');
      peek.frame.src = 'about:blank';
    } catch (e) {}
    try {
      peek.host.remove();
    } catch (e) {}

    if (peeks.length) {
      setFocus(peeks[peeks.length - 1]);
      tile();
    }
    syncChrome();
    if (!peeks.length) sendBg({ type: 'peek:release-rule' });
  }

  /* ---------------- 停靠 / 阅读视图 ---------------- */

  function toggleDock(peek) {
    const card = peek.card;
    if (card.classList.contains('docked')) {
      card.classList.remove('docked');
      peek.host.removeAttribute('data-docked');
      peek.dockBtn.classList.remove('on');
      if (peek.prev) {
        card.style.left = peek.prev.left;
        card.style.top = peek.prev.top;
        card.style.width = peek.prev.width;
        card.style.height = peek.prev.height;
      }
    } else {
      peek.prev = {
        left: card.style.left,
        top: card.style.top,
        width: card.style.width,
        height: card.style.height
      };
      const w = clamp(Math.round(window.innerWidth * 0.42), 380, window.innerWidth - 320);
      card.classList.add('docked');
      peek.host.setAttribute('data-docked', '');
      peek.dockBtn.classList.add('on');
      card.style.width = w + 'px';
      card.style.height = window.innerHeight - 32 + 'px';
      card.style.left = window.innerWidth - w - 16 + 'px';
      card.style.top = '16px';
    }
    syncChrome();
    tile();
  }

  async function toggleRead(peek) {
    if (peek.reading) {
      peek.reading = false;
      peek.readBtn.classList.remove('on');
      peek.loader.classList.remove('hide');
      peek.fallback.classList.remove('show');
      if (peek.hostName) peek.t1.textContent = peek.hostName;
      try {
        peek.frame.removeAttribute('srcdoc');
        peek.frame.src = peek.url;
      } catch (e) {}
      return;
    }

    peek.readBtn.classList.add('on');
    peek.loader.classList.remove('hide');
    peek.loader.querySelector('.lt').textContent = '正在抽取正文…';
    peek.fallback.classList.remove('show');

    await sendBg({ type: 'peek:frame-rule' });
    const res = await sendBg({ type: 'peek:extract', url: peek.url, theme: peek.theme });
    if (peeks.indexOf(peek) === -1) return;

    if (!res || !res.ok) {
      peek.readBtn.classList.remove('on');
      showFallback(peek, (res && res.error ? res.error + '。' : '') + '可以切回原页面看看。');
      return;
    }

    peek.reading = true;
    try {
      peek.frame.setAttribute('srcdoc', res.html);
    } catch (e) {
      showFallback(peek, '正文渲染失败。');
      return;
    }
    if (res.title) peek.t1.textContent = res.title;
  }

  /* 阅读视图里的链接 → 再开一个 Peek */
  window.addEventListener('message', (ev) => {
    const data = ev.data;
    if (!data || !data.__peekNav) return;
    const owner = peeks.find((p) => {
      try {
        return p.frame.contentWindow === ev.source;
      } catch (e) {
        return false;
      }
    });
    if (!owner) return;
    const url = String(data.__peekNav);
    if (!/^https?:\/\//i.test(url)) return;
    openPeek(url, owner.card.getBoundingClientRect());
  });

  /* ---------------- 启动 ---------------- */

  function bind() {
    document.addEventListener('click', swallowClick, true);
    document.addEventListener('pointerdown', onOutPointerDown, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('auxclick', onAuxClick, true);
    document.addEventListener('dblclick', onDblClick, true);
    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mouseout', onMouseOut, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('contextmenu', onContextMenu, true);
    document.addEventListener('dragstart', onDragStart, true);
    document.addEventListener('dragover', onDragOver, true);
    document.addEventListener('drop', onDrop, true);
    document.addEventListener('dragend', onDragEnd, true);

    try {
      chrome.runtime.onMessage.addListener((msg) => {
        if (!msg || !msg.type) return;
        if (msg.type === 'peek:open' && msg.url) openPeek(msg.url, null);
        else if (msg.type === 'peek:favorites') openFavorites();
        else if (msg.type === 'peek:sync-rules') loadSettings().then(syncChrome);
      });
    } catch (e) {}
  }

  loadSettings().then(bind);
  watchSettings();
})();
