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
      '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.2 4.6h9.6"/><path d="M6.4 4.6V3.4h3.2v1.2"/><path d="M4.6 4.6l.6 8h5.6l.6-8"/><path d="M6.8 7v3.6M9.2 7v3.6"/></svg>',
    search:
      '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2 14 14"/></svg>',
    translate:
      '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.2 4.4h7.2M5.8 2.6v1.8M3.2 4.4c.4 2.3 1.8 4.2 4 5.3M8.6 4.4c-.4 2.3-1.8 4.2-4 5.3"/><path d="M9 13.4l2.4-5.6 2.4 5.6M9.9 11.7h3"/></svg>',
    swapL:
      '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6.4 3.2 2.8 6.8l3.6 3.6"/><path d="M3 6.8h9.8"/></svg>',
    swapR:
      '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9.6 3.2l3.6 3.6-3.6 3.6"/><path d="M13 6.8H3.2"/></svg>',
    immersive:
      '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5.8 2.2H2.2v3.6M10.2 2.2h3.6v3.6M5.8 13.8H2.2v-3.6M10.2 13.8h3.6v-3.6"/></svg>',
    ai:
      '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M7.4 2.2l1.1 3 3 1.1-3 1.1-1.1 3-1.1-3-3-1.1 3-1.1z"/><path d="M12.2 9.8l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z"/></svg>',
    tag:
      '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.4 7V3.6a1.2 1.2 0 0 1 1.2-1.2H7l6.5 6.5a1.1 1.1 0 0 1 0 1.6l-2.7 2.7a1.1 1.1 0 0 1-1.6 0z"/><circle cx="5.6" cy="5.6" r="1.1"/></svg>',
    import:
      '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 10.6V3"/><path d="M5.1 5.9 8 8.8l2.9-2.9"/><path d="M2.8 11.2v1.5a1 1 0 0 0 1 1h8.4a1 1 0 0 0 1-1v-1.5"/></svg>',
    json:
      '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2.5H4.8A1.8 1.8 0 0 0 3 4.3v1.2c0 1-.6 1.7-1.5 1.7.9 0 1.5.7 1.5 1.7v1.2a1.8 1.8 0 0 0 1.8 1.8H6"/><path d="M10 2.5h1.2A1.8 1.8 0 0 1 13 4.3v1.2c0 1 .6 1.7 1.5 1.7-.9 0-1.5.7-1.5 1.7v1.2a1.8 1.8 0 0 1-1.8 1.8H10"/></svg>'
  };

  const STYLES = `
:host {
  all: initial;
  position: fixed;
  inset: 0;
  display: block;
  z-index: 2147483647;
  isolation: isolate;
  pointer-events: none;
  --pk-bg: #ffffff;
  --pk-bg-2: #f6f6f9;
  --pk-bar: rgba(255,255,255,.82);
  --pk-text: #17171c;
  --pk-muted: #7c7c89;
  --pk-faint: #a3a3ad;
  --pk-line: rgba(20,20,35,.08);
  --pk-line-strong: rgba(20,20,35,.14);
  --pk-hover: rgba(20,20,35,.055);
  --pk-accent: #6a58e8;
  --pk-accent-2: #b75cff;
  --pk-accent-soft: rgba(106,88,232,.10);
  --pk-ring: rgba(106,88,232,.42);
  --pk-shadow: 0 32px 90px rgba(12,12,22,.24), 0 2px 8px rgba(12,12,22,.08);
  --pk-dim: rgba(10,10,18,.24);
  --pk-radius: 18px;
  color-scheme: light;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
}
:host([data-theme="dark"]) {
  --pk-bg: #1d1d22;
  --pk-bg-2: #151519;
  --pk-bar: rgba(29,29,34,.82);
  --pk-text: #f4f4f7;
  --pk-muted: #9696a4;
  --pk-faint: #6f6f7c;
  --pk-line: rgba(255,255,255,.09);
  --pk-line-strong: rgba(255,255,255,.16);
  --pk-hover: rgba(255,255,255,.07);
  --pk-accent: #b8a9ff;
  --pk-accent-2: #d59cff;
  --pk-accent-soft: rgba(184,169,255,.14);
  --pk-ring: rgba(184,169,255,.45);
  --pk-shadow: 0 34px 100px rgba(0,0,0,.64), 0 2px 12px rgba(0,0,0,.42);
  --pk-dim: rgba(0,0,0,.46);
  color-scheme: dark;
}
:host([data-theme="sepia"]) {
  --pk-bg: #fbf4e6;
  --pk-bg-2: #f4ead8;
  --pk-bar: rgba(251,244,230,.82);
  --pk-text: #3b3125;
  --pk-muted: #8d7b64;
  --pk-faint: #ab987e;
  --pk-line: rgba(88,66,38,.16);
  --pk-line-strong: rgba(88,66,38,.22);
  --pk-hover: rgba(88,66,38,.075);
  --pk-accent: #9a6529;
  --pk-accent-2: #b77a38;
  --pk-accent-soft: rgba(154,101,41,.12);
  --pk-ring: rgba(154,101,41,.4);
  --pk-shadow: 0 30px 80px rgba(70,50,25,.24), 0 2px 8px rgba(70,50,25,.10);
  --pk-dim: rgba(66,48,24,.20);
  color-scheme: light;
}
/* 遮罩只负责变暗，不拦截事件 —— 事件交给下面的文档级监听，
 * 否则遮罩会连右键菜单一起吃掉，也没法在浮层打开时再点第二个链接。 */
.backdrop {
  position: fixed; inset: 0; z-index: -1; background: var(--pk-dim);
  pointer-events: none; opacity: 0; transition: opacity .22s ease;
}
:host([data-ready]) .backdrop { opacity: 1; }
:host([data-nodim]) .backdrop { background: transparent; }
:host([data-docked]) .backdrop { background: transparent; }
:host([data-blur]) .backdrop {
  -webkit-backdrop-filter: blur(12px) saturate(.82);
  backdrop-filter: blur(12px) saturate(.82);
}
.card {
  position: fixed; z-index: 1; display: flex; flex-direction: column;
  background: var(--pk-bg); border: 1px solid var(--pk-line);
  border-radius: var(--pk-radius); box-shadow: var(--pk-shadow); overflow: hidden;
  pointer-events: auto; opacity: 0; transform: translateY(6px) scale(.986);
  transition: opacity .18s ease, transform .22s cubic-bezier(.2,.8,.2,1), box-shadow .2s ease;
}
:host([data-ready]) .card { opacity: 1; transform: none; }
:host([data-multi]) .card.focused {
  border-color: var(--pk-ring);
  box-shadow: var(--pk-shadow), 0 0 0 1px var(--pk-ring);
}
.bar {
  display: flex; align-items: center; gap: 9px; flex: 0 0 auto;
  padding: 9px 9px 9px 11px; border-bottom: 1px solid var(--pk-line);
  background: var(--pk-bg); cursor: grab;
  user-select: none; -webkit-user-select: none;
}
.card.dragging .bar { cursor: grabbing; }
.fav-wrap {
  width: 22px; height: 22px; border-radius: 7px; flex: 0 0 auto;
  position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, var(--pk-accent), var(--pk-accent-2));
  border: 1px solid var(--pk-line);
}
.fav-fallback {
  font-size: 10.5px; font-weight: 650; line-height: 1; color: #fff;
  text-transform: uppercase; letter-spacing: 0;
}
.fav {
  position: absolute; inset: 0; width: 100%; height: 100%;
  border-radius: 6px; object-fit: contain; padding: 2px;
  background: var(--pk-bg-2);
}
.meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.t1 {
  font-size: 13px; font-weight: 650; line-height: 1.32; color: var(--pk-text);
  letter-spacing: -.01em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.t2 {
  font-size: 10.5px; line-height: 1.35; color: var(--pk-muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.acts {
  display: flex; align-items: center; gap: 1px; flex: 0 0 auto;
  padding: 2px; margin-left: 2px;
  border-radius: 10px; background: var(--pk-hover);
}
.btn {
  width: 25px; height: 25px; display: flex; align-items: center; justify-content: center;
  border: 0; background: transparent; color: var(--pk-text); opacity: .68;
  border-radius: 7px; padding: 0; cursor: pointer;
  transition: background .14s ease, color .14s ease, opacity .14s ease, box-shadow .14s ease;
}
.btn:hover {
  background: var(--pk-bg); color: var(--pk-text); opacity: 1;
  box-shadow: 0 1px 2px rgba(20,20,35,.08);
}
.btn.on { background: var(--pk-accent-soft); color: var(--pk-accent); opacity: 1; }
.btn[hidden] { display: none !important; }
.btn:disabled { opacity: .22; cursor: default; }
.btn:disabled:hover { background: transparent; color: var(--pk-text); opacity: .22; box-shadow: none; }
/* 交换按钮只在并排时出现；窄浮层里优先保留常用动作 */
.swap { display: none; }
:host([data-multi]) .swap { display: flex; }
:host([data-multi]) .btn[data-act="dock"],
:host([data-multi]) .btn[data-act="tab"] { display: none; }
.card:fullscreen {
  left: 0 !important; top: 0 !important;
  width: 100vw !important; height: 100vh !important;
  border-radius: 0; border: 0;
}
.card:fullscreen .bar { padding-right: 14px; }
.stage { position: relative; flex: 1; min-height: 0; background: var(--pk-bg-2); }
.frame { width: 100%; height: 100%; border: 0; display: block; background: #fff; }
.card.dragging .frame, .card.resizing .frame { pointer-events: none; }
.loader {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  gap: 9px; font-size: 11.5px; color: var(--pk-muted); background: var(--pk-bg-2);
  transition: opacity .22s ease;
}
.loader.hide { opacity: 0; pointer-events: none; }
.spin {
  width: 15px; height: 15px; border-radius: 50%;
  border: 2px solid var(--pk-line); border-top-color: var(--pk-accent); border-right-color: var(--pk-accent-2);
  animation: pk-spin .7s linear infinite;
}
@keyframes pk-spin { to { transform: rotate(360deg); } }
.fallback {
  position: absolute; inset: 0; display: none; flex-direction: column;
  align-items: center; justify-content: center; gap: 9px; padding: 32px;
  text-align: center; background:
    radial-gradient(80% 60% at 50% 0%, var(--pk-accent-soft), transparent 68%),
    var(--pk-bg-2);
}
.fallback.show { display: flex; }
.fb-t { font-size: 14px; font-weight: 650; letter-spacing: -.01em; color: var(--pk-text); }
.fb-d { font-size: 12px; line-height: 1.7; color: var(--pk-muted); max-width: 360px; }
.fb-row { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 3px; }
.fb-b {
  font-size: 11.5px; font-weight: 550; color: #fff; font-family: inherit;
  background: linear-gradient(135deg, var(--pk-accent), var(--pk-accent-2));
  border: 0; border-radius: 8px; padding: 8px 14px; cursor: pointer;
  box-shadow: 0 4px 14px var(--pk-accent-soft);
}
.fb-b:hover { filter: brightness(1.04); }
.fb-b.ghost {
  background: var(--pk-bg); color: var(--pk-accent);
  border: 1px solid var(--pk-line); box-shadow: none;
}
.fb-b.ghost:hover { background: var(--pk-hover); }
.fb-b[hidden] { display: none !important; }
.rz { position: absolute; z-index: 3; }
.rz-e { top: 0; right: 0; width: 6px; height: 100%; cursor: ew-resize; }
.rz-s { left: 0; bottom: 0; height: 6px; width: 100%; cursor: ns-resize; }
.rz-se { right: 0; bottom: 0; width: 16px; height: 16px; cursor: nwse-resize; }
.toast {
  display: flex; align-items: center; gap: 10px;
  font-size: 12.5px; line-height: 1.45; color: var(--pk-text);
  background: var(--pk-bar); border: 1px solid var(--pk-line);
  border-radius: 12px; padding: 10px 15px; box-shadow: var(--pk-shadow);
  -webkit-backdrop-filter: blur(22px) saturate(1.4);
  backdrop-filter: blur(22px) saturate(1.4);
  max-width: 76vw; pointer-events: auto;
  opacity: 0; transform: translateY(6px);
  transition: opacity .18s ease, transform .18s ease;
}
.toast > span { min-width: 0; text-align: center; }
.toast-act {
  flex: 0 0 auto; border: 0; border-radius: 7px; padding: 6px 11px;
  font-family: inherit; font-size: 11.5px; font-weight: 600;
  color: var(--pk-accent); background: var(--pk-accent-soft); cursor: pointer;
}
.toast-act:hover { filter: brightness(.96); }
:host([data-ready]) .toast { opacity: 1; transform: none; }

/* 划词工具条 */
.sel-bar {
  position: fixed; display: flex; align-items: center; gap: 2px;
  padding: 4px; pointer-events: auto;
  background: var(--pk-bar); border: 1px solid var(--pk-line);
  border-radius: 12px; box-shadow: var(--pk-shadow);
  -webkit-backdrop-filter: blur(22px) saturate(1.4);
  backdrop-filter: blur(22px) saturate(1.4);
  opacity: 0; transform: translateY(4px);
  transition: opacity .14s ease, transform .14s ease;
}
:host([data-ready]) .sel-bar { opacity: 1; transform: none; }
.sel-btn {
  display: flex; align-items: center; gap: 5px;
  height: 29px; padding: 0 10px; border: 0; border-radius: 8px;
  background: transparent; color: var(--pk-text);
  font-family: inherit; font-size: 12px; font-weight: 550;
  cursor: pointer; white-space: nowrap;
}
.sel-btn svg { color: var(--pk-muted); }
.sel-btn:hover { background: var(--pk-bg); box-shadow: 0 1px 2px rgba(20,20,35,.07); }
.sel-btn:hover svg { color: var(--pk-accent); }
.sel-sep { width: 1px; height: 15px; background: var(--pk-line); margin: 0 1px; }

/* 拖拽时跟着光标的小 pill */
.chip {
  font-size: 11.5px; font-weight: 550; color: var(--pk-text);
  background: var(--pk-bar); border: 1px solid var(--pk-line);
  border-radius: 10px; padding: 7px 12px; box-shadow: var(--pk-shadow);
  -webkit-backdrop-filter: blur(18px) saturate(1.4);
  backdrop-filter: blur(18px) saturate(1.4);
  white-space: nowrap; pointer-events: none; max-width: 70vw;
  overflow: hidden; text-overflow: ellipsis;
}

/* 图片查看器 */
.img-view {
  position: absolute; inset: 0; display: none; flex-direction: column;
  background: radial-gradient(90% 70% at 50% 0%, #191922, #0f0f13 70%);
}
.card.image .img-view { display: flex; }
.card.image .frame { display: none; }
.card.image .loader { background: #0f0f13; color: #9696a4; }
.img-wrap {
  flex: 1; min-height: 0; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  cursor: zoom-in; touch-action: none;
}
.img-wrap.zoomed { cursor: grab; }
.img-wrap.dragging { cursor: grabbing; }
.img-el {
  max-width: 100%; max-height: 100%; display: block;
  transform-origin: center center; user-select: none; -webkit-user-drag: none;
}
.img-wrap.zoomed .img-el { cursor: inherit; }
.img-bar {
  flex: 0 0 auto; display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 10px 14px; background: rgba(16,16,22,.82);
  border-top: 1px solid rgba(255,255,255,.1);
  -webkit-backdrop-filter: blur(18px) saturate(1.2);
  backdrop-filter: blur(18px) saturate(1.2);
}
.img-b {
  height: 28px; min-width: 28px; padding: 0 10px;
  font-family: inherit; font-size: 11.5px; color: #ececf2;
  background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.08);
  border-radius: 8px; cursor: pointer;
  transition: background .14s ease, border-color .14s ease;
}
.img-b:hover { background: rgba(255,255,255,.16); border-color: rgba(255,255,255,.14); }
.img-b[hidden] { display: none !important; }
.img-pct {
  min-width: 44px; text-align: center; font-size: 11.5px; color: #9a9aa8;
  font-variant-numeric: tabular-nums;
}
.img-sep { width: 1px; height: 16px; background: rgba(255,255,255,.14); margin: 0 2px; }

/* AI 问答面板 */
.ai-panel {
  position: absolute; inset: 0; z-index: 2; display: none;
  flex-direction: column; background: var(--pk-bg);
}
.ai-panel.show { display: flex; }
.ai-hd {
  flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between;
  gap: 10px; padding: 11px 12px 10px 18px; border-bottom: 1px solid var(--pk-line);
  background: var(--pk-bg);
}
.ai-title { display: flex; align-items: baseline; gap: 8px; font-size: 13px; font-weight: 650; letter-spacing: -.01em; color: var(--pk-text); }
.ai-sub { font-size: 10.5px; font-weight: 400; color: var(--pk-muted); }
.ai-log {
  flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column;
  gap: 10px; padding: 18px;
  background: radial-gradient(80% 50% at 100% 0%, var(--pk-accent-soft), transparent 65%);
}
.ai-msg {
  max-width: 88%; padding: 10px 13px; border-radius: 12px;
  font-size: 12.5px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere;
  color: var(--pk-text); background: var(--pk-bg-2);
  border: 1px solid var(--pk-line);
  align-self: flex-start;
}
.ai-msg.user {
  align-self: flex-end;
  background: linear-gradient(135deg, var(--pk-accent-soft), rgba(183,92,255,.08));
  border-color: var(--pk-accent-line, var(--pk-line));
  color: var(--pk-text);
}
.ai-msg.pending { color: var(--pk-muted); font-style: italic; }
.ai-msg.err { color: #b3261e; background: rgba(179,38,30,.08); border-color: rgba(179,38,30,.12); }
:host([data-theme="dark"]) .ai-msg.err { color: #ff9a8f; background: rgba(255,120,110,.1); }
.ai-compose {
  flex: 0 0 auto; display: flex; gap: 8px; padding: 12px 14px;
  border-top: 1px solid var(--pk-line); background: var(--pk-bg);
}
.ai-in {
  flex: 1; min-width: 0; height: 56px; resize: none;
  padding: 9px 11px; font-family: inherit; font-size: 12.5px; line-height: 1.55;
  color: var(--pk-text); background: var(--pk-bg-2);
  border: 1px solid var(--pk-line); border-radius: 10px; outline: none;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.ai-in:focus { border-color: var(--pk-accent); box-shadow: 0 0 0 3px var(--pk-accent-soft); }
.ai-send {
  flex: 0 0 auto; align-self: flex-end; height: 32px; padding: 0 15px;
  font-family: inherit; font-size: 11.5px; font-weight: 600;
  color: #fff; background: linear-gradient(135deg, var(--pk-accent), var(--pk-accent-2));
  border: 0; border-radius: 9px; cursor: pointer;
  box-shadow: 0 4px 14px var(--pk-accent-soft);
}
.ai-send:disabled { opacity: .5; cursor: default; }

/* 收藏面板 */
.fav-card { width: 460px; max-width: calc(100vw - 32px); height: auto; max-height: 74vh; }
.fav-chips {
  flex: 0 0 auto; display: flex; flex-wrap: wrap; gap: 6px;
  padding: 12px 14px 7px; border-bottom: 1px solid var(--pk-line);
}
.fav-chip {
  height: 24px; padding: 0 10px; border: 1px solid transparent; border-radius: 99px;
  font-family: inherit; font-size: 10.5px; color: var(--pk-muted);
  background: var(--pk-bg-2); cursor: pointer;
  transition: color .14s ease, background .14s ease, border-color .14s ease;
}
.fav-chip:hover { color: var(--pk-text); border-color: var(--pk-line); }
.fav-chip.on {
  color: var(--pk-accent); background: var(--pk-accent-soft);
  border-color: var(--pk-ring); font-weight: 600;
}
.fav-tagline { display: flex; gap: 5px; align-items: center; min-width: 0; }
.fav-tag {
  flex: 0 0 auto; font-size: 9.5px; color: var(--pk-accent);
  background: var(--pk-accent-soft); border-radius: 5px; padding: 1px 5px;
}
.fav-tagbtn {
  width: 26px; height: 26px; flex: 0 0 auto; display: flex; align-items: center; justify-content: center;
  border: 0; background: transparent; color: var(--pk-muted); border-radius: 7px;
  padding: 0; cursor: pointer; opacity: 0; transition: opacity .12s ease, background .12s ease;
}
.fav-item:hover .fav-tagbtn { opacity: 1; }
.fav-tagbtn:hover { background: var(--pk-hover); color: var(--pk-text); }
.fav-tag-in {
  flex: 1; min-width: 0; height: 24px; padding: 0 8px;
  font-family: inherit; font-size: 10.5px; color: var(--pk-text);
  background: var(--pk-bg); border: 1px solid var(--pk-accent); border-radius: 6px; outline: none;
  box-shadow: 0 0 0 3px var(--pk-accent-soft);
}
.fav-body { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.fav-list { overflow-y: auto; padding: 6px; }
.fav-item {
  display: flex; align-items: center; gap: 10px; padding: 9px 10px;
  border-radius: 10px; cursor: pointer;
}
.fav-item:hover { background: var(--pk-hover); }
.fav-ic {
  width: 18px; height: 18px; border-radius: 5px; flex: 0 0 auto; object-fit: contain;
  background: var(--pk-bg-2); padding: 2px;
}
.fav-tx { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.fav-t1 {
  font-size: 12.5px; font-weight: 550; color: var(--pk-text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.fav-t2 {
  display: flex; align-items: center; gap: 5px; min-width: 0;
  font-size: 10.2px; color: var(--pk-muted);
  white-space: nowrap; overflow: hidden;
}
.fav-host { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.fav-x {
  width: 26px; height: 26px; flex: 0 0 auto; display: flex; align-items: center; justify-content: center;
  border: 0; background: transparent; color: var(--pk-muted); border-radius: 7px;
  padding: 0; cursor: pointer; opacity: 0; transition: opacity .12s ease, background .12s ease;
}
.fav-item:hover .fav-x { opacity: 1; }
.fav-x:hover { background: var(--pk-hover); color: var(--pk-text); }
.fav-empty {
  padding: 42px 28px; text-align: center; font-size: 12px;
  line-height: 1.7; color: var(--pk-muted);
}
.fav-empty b { color: var(--pk-text); font-weight: 600; }
`;

  const TEMPLATE = `
<div class="card" role="dialog" aria-label="链接预览">
  <header class="bar">
    <span class="fav-wrap"><b class="fav-fallback"></b><img class="fav" alt="" referrerpolicy="no-referrer"></span>
    <div class="meta"><div class="t1"></div><div class="t2"></div></div>
    <div class="acts">
      <button class="btn swap" data-act="swap-l" title="与左侧浮层交换位置" aria-label="与左侧浮层交换位置">${ICON.swapL}</button>
      <button class="btn swap" data-act="swap-r" title="与右侧浮层交换位置" aria-label="与右侧浮层交换位置">${ICON.swapR}</button>
      <button class="btn" data-act="ai" title="AI 问答（基于本页正文）" aria-label="AI 问答" hidden>${ICON.ai}</button>
      <button class="btn" data-act="read" title="阅读视图：抽出正文重排 (Alt + R)" aria-label="阅读视图">${ICON.read}</button>
      <button class="btn" data-act="immersive" title="沉浸模式：浮层铺满屏幕" aria-label="沉浸模式">${ICON.immersive}</button>
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
        <button class="fb-b ghost" data-act="back" hidden>切回原页</button>
        <button class="fb-b" data-act="window">用独立小窗打开</button>
        <button class="fb-b ghost" data-act="tab">新标签页打开</button>
        <button class="fb-b ghost" data-act="always-window">始终用窗口</button>
        <button class="fb-b ghost" data-act="read">试试阅读视图</button>
      </div>
    </div>
    <div class="img-view">
      <div class="img-wrap"><img class="img-el" alt="" referrerpolicy="no-referrer"></div>
      <div class="img-bar">
        <button class="img-b" type="button" data-act="img-out" title="缩小" aria-label="缩小">−</button>
        <span class="img-pct">100%</span>
        <button class="img-b" type="button" data-act="img-in" title="放大" aria-label="放大">+</button>
        <span class="img-sep"></span>
        <button class="img-b" type="button" data-act="img-fit" title="恢复 100%">适应</button>
        <button class="img-b" type="button" data-act="img-gif" title="冻结 / 播放 GIF" hidden>暂停 GIF</button>
        <button class="img-b" type="button" data-act="img-original" title="在新标签页打开原图">原图</button>
      </div>
    </div>
    <div class="ai-panel" role="dialog" aria-label="AI 问答">
      <div class="ai-hd">
        <div class="ai-title">AI 问答<span class="ai-sub">基于当前页面正文</span></div>
        <button class="btn" data-act="ai-close" title="关闭 AI 问答" aria-label="关闭 AI 问答">${ICON.close}</button>
      </div>
      <div class="ai-log" data-role="ai-log"></div>
      <div class="ai-compose">
        <textarea class="ai-in" data-role="ai-in" rows="2" placeholder="就这个页面问点什么…"></textarea>
        <button class="ai-send" type="button" data-act="ai-send">发送</button>
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
      <button class="btn" data-fact="import" title="从 JSON 导入收藏" aria-label="导入收藏">${ICON.import}</button>
      <button class="btn" data-fact="export" title="导出为 Markdown" aria-label="导出 Markdown">${ICON.export}</button>
      <button class="btn" data-fact="export-json" title="导出为 JSON" aria-label="导出 JSON">${ICON.json}</button>
      <button class="btn" data-fact="close" title="关闭 (Esc)" aria-label="关闭">${ICON.close}</button>
    </div>
  </header>
  <div class="fav-chips" data-role="chips"></div>
  <div class="fav-body">
    <div class="fav-list" data-role="list"></div>
    <div class="fav-empty" data-role="empty" style="display:none">
      还没有收藏。<br>把链接<b>拖到页面空白处</b>，或 <b>Ctrl + 右键</b>点击链接即可收藏。
    </div>
  </div>
  <input type="file" accept="application/json,.json" data-role="file" hidden>
</div>`;

  const SELECTION_TEMPLATE = `
<div class="sel-bar" role="toolbar" aria-label="划词工具">
  <button class="sel-btn" type="button" data-sel="search" title="搜索选中的文字">${ICON.search}<span>搜索</span></button>
  <span class="sel-sep"></span>
  <button class="sel-btn" type="button" data-sel="translate" title="翻译选中的文字">${ICON.translate}<span>翻译</span></button>
</div>`;

  const SEARCH_URLS = {
    google: (q) => 'https://www.google.com/search?q=' + encodeURIComponent(q),
    bing: (q) => 'https://www.bing.com/search?q=' + encodeURIComponent(q),
    baidu: (q) => 'https://www.baidu.com/s?wd=' + encodeURIComponent(q),
    duckduckgo: (q) => 'https://duckduckgo.com/?q=' + encodeURIComponent(q)
  };

  const TRANSLATE_URLS = {
    google: (q, to) =>
      'https://translate.google.com/?sl=auto&tl=' + (to === 'zh' ? 'zh-CN' : to) + '&op=translate&text=' + encodeURIComponent(q),
    bing: (q, to) =>
      'https://www.bing.com/translator?text=' + encodeURIComponent(q) + '&from=auto&to=' + (to === 'zh' ? 'zh-Hans' : to),
    deepl: (q, to) => 'https://www.deepl.com/translator#auto/' + (to === 'zh' ? 'zh' : to) + '/' + encodeURIComponent(q)
  };

  const SEARCH_NAMES = { google: 'Google', bing: 'Bing', baidu: '百度', duckduckgo: 'DuckDuckGo' };
  const LANG_NAMES = { zh: '中文', en: '英文', ja: '日文', ko: '韩文' };
  const SELECTION_LIMIT = 800;
  const SITE_SIZE_LIMIT = 200;
  const AI_HISTORY_MESSAGES = 12; // 6 轮对话 = 12 条 user/assistant 消息

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
  let selHost = null;
  let selText = '';
  let selRect = null;

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
        refreshHosts();
        syncChrome();
      });
    } catch (e) {}
  }

  function watchSystemTheme() {
    try {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => {
        if (settings.theme !== 'auto') return;
        refreshHosts();
        syncChrome();
      };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    } catch (e) {}
  }

  function refreshHosts() {
    peeks.forEach((p) => {
      paintHost(p.host);
      p.theme = resolveTheme();
      applyReadingTheme(p);
    });
    if (favHost) paintHost(favHost);
    if (selHost) paintHost(selHost);
    if (toastHost) paintHost(toastHost);
    if (backdropHost) paintHost(backdropHost);
  }

  /* 阅读视图是 srcdoc 文档，不会继承页面 CSS；主题变化时用消息和
   * data-theme 同步，避免已经打开的文章停在旧配色。 */
  function applyReadingTheme(peek) {
    if (!peek || !peek.reading) return;
    const theme = resolveTheme();
    try {
      const win = peek.frame.contentWindow;
      if (win) win.postMessage({ __peekTheme: theme }, '*');
    } catch (e) {}
    try {
      const doc = peek.frame.contentDocument;
      if (doc && doc.documentElement) doc.documentElement.setAttribute('data-theme', theme);
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
   * 匹配优先级：精确主机名 > *.example.com 通配（最长后缀优先）> 父域规则。
   * 即 example.com 的规则也会作用于 a.example.com；只想管子域就写 *.example.com。 */
  const RULE_MODES = ['window', 'iframe', 'off'];

  function isRuleMode(v) {
    return RULE_MODES.indexOf(v) !== -1;
  }

  function cleanRuleKey(raw) {
    return String(raw || '').trim().toLowerCase().replace(/^www\./, '');
  }

  function isIpHost(host) {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.indexOf(':') !== -1;
  }

  function ruleFor(host) {
    const key = cleanRuleKey(host);
    const map = settings.siteRules;
    if (!key || !map || typeof map !== 'object') return null;

    if (isRuleMode(map[key])) return map[key];

    let wildcard = null;
    let wildcardLen = -1;
    for (const raw of Object.keys(map)) {
      const mode = map[raw];
      if (!isRuleMode(mode)) continue;
      const k = cleanRuleKey(raw);
      if (k.slice(0, 2) !== '*.') continue;
      const suffix = k.slice(2);
      if (!suffix || key === suffix) continue;
      if (key.length > suffix.length && key.slice(-suffix.length - 1) === '.' + suffix) {
        if (suffix.length > wildcardLen) {
          wildcard = mode;
          wildcardLen = suffix.length;
        }
      }
    }
    if (wildcard) return wildcard;

    if (!isIpHost(key)) {
      const labels = key.split('.');
      for (let i = 1; i < labels.length - 1; i++) {
        const parent = labels.slice(i).join('.');
        if (isRuleMode(map[parent])) return map[parent];
      }
    }
    return null;
  }

  function exactRule(host) {
    const map = settings.siteRules;
    const key = cleanRuleKey(host);
    return map && isRuleMode(map[key]) ? map[key] : null;
  }

  function setRule(host, mode) {
    const key = cleanRuleKey(host);
    if (!key) return;
    const next = Object.assign({}, settings.siteRules || {});
    if (isRuleMode(mode)) next[key] = mode;
    else delete next[key];
    settings.siteRules = next;
    try {
      chrome.storage.local.set({ siteRules: next });
    } catch (e) {}
  }

  function pageOff() {
    return ruleFor(hostKeyOf(location.href)) === 'off';
  }

  function targetOff(url) {
    return ruleFor(hostKeyOf(url)) === 'off';
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
  let backdropHost = null;

  function toast(text, ms, action) {
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
      host.style.setProperty('top', 'auto', 'important');
      host.style.setProperty('bottom', '26px', 'important');
      host.style.setProperty('height', 'auto', 'important');
      host.style.setProperty('display', 'flex', 'important');
      host.style.setProperty('align-items', 'center', 'important');
      host.style.setProperty('justify-content', 'center', 'important');
      paintHost(host);

      const box = document.createElement('div');
      box.className = 'toast';
      const label = document.createElement('span');
      label.textContent = text;
      box.appendChild(label);

      if (action && action.label) {
        const act = document.createElement('button');
        act.type = 'button';
        act.className = 'toast-act';
        act.textContent = action.label;
        act.addEventListener('click', () => {
          try {
            action.onClick();
          } catch (e) {}
          clearTimeout(toastTimer);
          try {
            host.remove();
          } catch (e) {}
          if (toastHost === host) toastHost = null;
        });
        box.appendChild(act);
      }

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
      }, ms || (action ? 5200 : 2800));
    } catch (e) {}
  }

  /* 浮层这条路走不通 —— 关掉它，换成真窗口，并记住这个站点。
   * 真窗口是第一方上下文：登录态、OAuth 跳转、页内查找全都正常。 */
  function degrade(peek, why) {
    const url = peek.url;
    const host = peek.hostKey;
    const rect = peek.card.getBoundingClientRect();
    const remember = settings.autoRoute !== false;
    const prev = exactRule(host);

    closePeek(peek);
    openInWindow(url, rect);
    if (remember && host) setRule(host, 'window');
    toast(
      host + ' ' + why + '，已改用独立小窗' + (remember ? '，下次直接开小窗' : ''),
      remember ? 6200 : 2800,
      remember && host ? { label: '撤销', onClick: () => setRule(host, prev) } : null
    );
  }

  /* ---------------- 触发判定 ---------------- */

  function isOurs(e) {
    if (!peeks.length) return false;
    const path = (e.composedPath && e.composedPath()) || [];
    return peeks.some((p) => path.indexOf(p.host) !== -1);
  }

  function inSelTools(e) {
    if (!selHost) return false;
    const path = (e.composedPath && e.composedPath()) || [];
    return path.indexOf(selHost) !== -1;
  }

  function inToast(e) {
    if (!toastHost) return false;
    const path = (e.composedPath && e.composedPath()) || [];
    return path.indexOf(toastHost) !== -1;
  }

  function inFloatUi(e) {
    return isOurs(e) || inFav(e) || inSelTools(e) || inToast(e);
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
    // 当前站点或目标站点被停用时，不 preventDefault，把点击原样交给浏览器
    if (pageOff() || targetOff(hit.url)) return;
    e.preventDefault();
    e.stopPropagation();
    openPeek(hit.url, hit.a.getBoundingClientRect());
  }

  function onAuxClick(e) {
    if (!settings.triggerMiddle || e.button !== 1) return;
    const hit = fire(e);
    if (!hit) return;
    if (pageOff() || targetOff(hit.url)) return;
    e.preventDefault();
    e.stopPropagation();
    openPeek(hit.url, hit.a.getBoundingClientRect());
  }

  function onDblClick(e) {
    if (!settings.triggerDouble) return;
    const hit = fire(e);
    if (!hit) return;
    if (pageOff() || targetOff(hit.url)) return;
    e.preventDefault();
    e.stopPropagation();
    const sel = window.getSelection();
    if (sel && sel.removeAllRanges) sel.removeAllRanges();
    openPeek(hit.url, hit.a.getBoundingClientRect());
  }

  function onMouseOver(e) {
    if (!settings.triggerHover || peeks.length || pageOff()) return;
    const hit = fire(e);
    if (!hit || targetOff(hit.url)) return;
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

  function pointTextAt(x, y) {
    let node = null;
    let offset = 0;
    try {
      if (document.caretRangeFromPoint) {
        const range = document.caretRangeFromPoint(x, y);
        if (range) {
          node = range.startContainer;
          offset = range.startOffset;
        }
      } else if (document.caretPositionFromPoint) {
        const pos = document.caretPositionFromPoint(x, y);
        if (pos) {
          node = pos.offsetNode;
          offset = pos.offset;
        }
      }
    } catch (e) {
      return false;
    }
    if (!node || node.nodeType !== 3) return false;
    const value = node.nodeValue || '';
    let i = Math.max(0, Math.min(offset, value.length));
    let ch = value.charAt(i) || value.charAt(i - 1);
    if (!/\S/.test(ch) && i > 0) {
      i -= 1;
      ch = value.charAt(i);
    }
    if (!/\S/.test(ch)) return false;
    // caretRangeFromPoint 会返回“最近”的文本，即使鼠标在空白边距上；
    // 再用字符的实际矩形确认落点确实压在这段文字上。
    try {
      const range = document.createRange();
      range.setStart(node, i);
      range.setEnd(node, Math.min(i + 1, value.length));
      const rect = range.getBoundingClientRect();
      if (!rect || x < rect.left - 1 || x > rect.right + 1 || y < rect.top - 1 || y > rect.bottom + 1) return false;
    } catch (e) {
      return false;
    }
    return true;
  }

  /* 落点是不是"页面空白处"。输入框、可编辑区、链接、按钮、另一段文字、
   * 标记了 data-peek-ignore 的容器都不接 —— 那些地方的原生拖拽行为必须保留。
   * 站点自己的拖放面板多数落在具体容器上，这条检查能挡掉大部分。 */
  function dropBlocked(node, e) {
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
      if (n.hasAttribute && (n.hasAttribute('data-peek-tools') || n.hasAttribute('data-peek-fav') || n.hasAttribute('data-peek-toast'))) return true;
      const tag = n.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (tag === 'A' || tag === 'BUTTON') return true;
      if (n.isContentEditable) return true;
    }
    return Boolean(e && pointTextAt(e.clientX, e.clientY));
  }

  function onDragStart(e) {
    if (pageOff()) return;
    if (!settings.triggerDrag && !settings.selectionDrag) return;

    if (settings.triggerDrag) {
      const a = findAnchor(e.target);
      if (a && !skipAnchor(a)) {
        const url = hrefOf(a);
        if (!url || targetOff(url)) return;
        hideSelectionTools();
        dragLink = { kind: 'link', url, host: hostKeyOf(url) };
        try {
          e.dataTransfer.setData('text/uri-list', url);
          e.dataTransfer.setData('text/plain', url);
          e.dataTransfer.effectAllowed = 'copy';
        } catch (err) {}
        return;
      }
    }

    if (!settings.selectionDrag) return;
    const ctx = selectionContext(e.target);
    if (!ctx) return;
    hideSelectionTools();
    dragLink = { kind: 'text', text: ctx.text, host: '' };
    try {
      e.dataTransfer.setData('text/plain', ctx.text);
      e.dataTransfer.effectAllowed = 'copy';
    } catch (err) {}
  }

  function shorten(text, max) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }

  function showDragChip(x, y) {
    if (!dragChip) {
      const { host, shadow } = mountFloat();
      const box = document.createElement('div');
      box.className = 'chip';
      shadow.appendChild(box);
      paintHost(host);
      host.style.setProperty('right', 'auto', 'important');
      host.style.setProperty('bottom', 'auto', 'important');
      document.documentElement.appendChild(host);
      dragChip = host;
      dragChipText = box;
      host.setAttribute('data-peek-chip', '');
    }
    dragChipText.textContent =
      dragLink && dragLink.kind === 'text'
        ? '松开搜索「' + shorten(dragLink.text, 18) + '」'
        : '松开预览 ' + (dragLink ? dragLink.host : '');
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
    if (inFloatUi(e) || dropBlocked(e.target, e)) {
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
    if (inFloatUi(e) || dropBlocked(e.target, e)) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = { left: e.clientX, top: e.clientY, bottom: e.clientY, width: 0 };
    if (link.kind === 'text') openPeek(searchUrlFor(link.text), rect);
    else openPeek(link.url, rect);
  }

  function onDragEnd() {
    dragLink = null;
    hideDragChip();
  }

  /* ---------------- 划词搜索 / 翻译 ---------------- */

  function searchUrlFor(text) {
    const build = SEARCH_URLS[settings.searchEngine] || SEARCH_URLS.google;
    return build(text);
  }

  function translateUrlFor(text) {
    const build = TRANSLATE_URLS[settings.translateEngine] || TRANSLATE_URLS.google;
    return build(text, settings.translateTo || 'zh');
  }

  function isEditableEl(el) {
    if (!el || !el.closest) return false;
    return Boolean(el.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"]'));
  }

  /* 取当前选区；node 传入时要求拖动起点落在选区内，避免误把页面
   * 上遗留的选区当成拖拽对象。 */
  function selectionContext(node) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    if (node) {
      try {
        if (!sel.containsNode(node, true)) return null;
      } catch (e) {
        return null;
      }
    }
    const text = sel.toString().replace(/\s+/g, ' ').trim();
    if (!text || text.length > SELECTION_LIMIT) return null;

    const anchor = sel.anchorNode;
    const el = anchor && anchor.nodeType === 1 ? anchor : anchor && anchor.parentElement;
    if (!el) return null;
    if (isEditableEl(el)) return null;
    if (el.closest && el.closest('[data-peek-root],[data-peek-tools],[data-peek-fav],[data-peek-toast],[data-peek-chip],[data-peek-ignore]')) return null;

    let range;
    try {
      range = sel.getRangeAt(0).cloneRange();
    } catch (e) {
      return null;
    }
    let rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) {
      const rects = range.getClientRects();
      rect = rects && rects.length ? rects[rects.length - 1] : null;
    }
    if (!rect) return null;

    return {
      text: text.slice(0, SELECTION_LIMIT),
      rect: {
        left: rect.left,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height
      }
    };
  }

  function hideSelectionTools() {
    if (selHost) {
      try {
        selHost.remove();
      } catch (e) {}
    }
    selHost = null;
    selText = '';
    selRect = null;
  }

  function showSelectionTools(ctx) {
    if (!settings.selectionTools || pageOff()) return;
    hideSelectionTools();

    let built;
    try {
      built = mountFloat();
    } catch (e) {
      return;
    }
    const { host, shadow } = built;
    host.setAttribute('data-peek-tools', '');
    paintHost(host);
    shadow.innerHTML = SELECTION_TEMPLATE;

    const bar = shadow.querySelector('.sel-bar');
    const searchBtn = shadow.querySelector('[data-sel="search"]');
    const translateBtn = shadow.querySelector('[data-sel="translate"]');

    const searchName = SEARCH_NAMES[settings.searchEngine] || SEARCH_NAMES.google;
    const langName = LANG_NAMES[settings.translateTo] || LANG_NAMES.zh;
    searchBtn.title = '用 ' + searchName + ' 搜索选中的文字';
    translateBtn.title = '翻译成' + langName;

    bar.addEventListener('mousedown', (e) => e.preventDefault());

    searchBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const text = selText;
      const rect = selRect;
      hideSelectionTools();
      if (text) openPeek(searchUrlFor(text), rect);
    });

    translateBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const text = selText;
      const rect = selRect;
      hideSelectionTools();
      if (text) openPeek(translateUrlFor(text), rect);
    });

    document.documentElement.appendChild(host);

    const w = bar.offsetWidth || 160;
    const h = bar.offsetHeight || 34;
    let left = clamp(ctx.rect.left + (ctx.rect.width || 0) / 2 - w / 2, 8, window.innerWidth - w - 8);
    let top = ctx.rect.top - h - 8;
    if (top < 8) top = ctx.rect.bottom + 8;
    top = clamp(top, 8, window.innerHeight - h - 8);
    bar.style.left = Math.round(left) + 'px';
    bar.style.top = Math.round(top) + 'px';

    selHost = host;
    selText = ctx.text;
    selRect = ctx.rect;

    requestAnimationFrame(() => {
      if (selHost === host) host.setAttribute('data-ready', '');
    });
  }

  function onSelectionMouseUp(e) {
    if (!settings.selectionTools || e.button !== 0 || pageOff()) return;
    if (inFloatUi(e) || dragLink) return;
    setTimeout(() => {
      if (dragLink) return;
      const ctx = selectionContext();
      if (ctx) showSelectionTools(ctx);
      else hideSelectionTools();
    }, 0);
  }

  /* ---------------- 收藏 / 稍后读 ---------------- */

  const FAV_LIMIT = 400;
  let favFilter = '';

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
    list.unshift({ url, title: title || hostKeyOf(url), host: hostKeyOf(url), at: Date.now(), tags: [] });
    favWrite(list);
    toast('已收藏 · 按 Alt + U 查看列表');
    return true;
  }

  function cleanTags(raw) {
    const arr = Array.isArray(raw) ? raw : String(raw || '').split(/[,，;；\s]+/);
    const out = [];
    for (const item of arr) {
      const tag = String(item || '')
        .replace(/^#/, '')
        .replace(/\s+/g, '')
        .trim();
      if (!tag || tag.length > 16) continue;
      if (!out.some((x) => x.toLowerCase() === tag.toLowerCase())) out.push(tag);
      if (out.length >= 3) break;
    }
    return out;
  }

  function favTagsOf(item) {
    return cleanTags(item && (item.tags != null ? item.tags : item.tag));
  }

  async function favSetTags(url, raw) {
    const tags = cleanTags(raw);
    const list = await favRead();
    const item = list.find((x) => x && x.url === url);
    if (!item) return;
    if (tags.length) item.tags = tags;
    else delete item.tags;
    favWrite(list);
  }

  function favItemOf(raw) {
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

  async function favImportFile(file, shadow) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast('导入失败：文件超过 2 MB');
      return;
    }
    let raw;
    try {
      raw = await file.text();
    } catch (e) {
      toast('导入失败：读不了这个文件');
      return;
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      toast('导入失败：不是有效的 JSON 文件');
      return;
    }
    const arr = Array.isArray(data)
      ? data
      : data && Array.isArray(data.favorites)
        ? data.favorites
        : data && Array.isArray(data.links)
          ? data.links
          : null;
    if (!arr) {
      toast('导入失败：文件里没有 favorites 数组');
      return;
    }

    const cur = await favRead();
    const seen = new Set(cur.map((x) => x && x.url));
    let added = 0;
    let skipped = 0;
    let invalid = 0;
    for (let i = arr.length - 1; i >= 0; i--) {
      const item = favItemOf(arr[i]);
      if (!item) {
        invalid++;
        continue;
      }
      if (seen.has(item.url) || cur.length >= FAV_LIMIT) {
        skipped++;
        continue;
      }
      seen.add(item.url);
      cur.unshift(item);
      added++;
    }
    favWrite(cur);
    favFilter = '';
    await renderFavList(shadow);

    const bits = [];
    if (added) bits.push('导入 ' + added + ' 条');
    if (skipped) bits.push('跳过 ' + skipped + ' 条重复或超额');
    if (invalid) bits.push('忽略 ' + invalid + ' 条无效');
    toast(bits.length ? bits.join('，') : '没有可导入的收藏');
  }

  function onContextMenu(e) {
    if (!(e.ctrlKey || e.metaKey) || pageOff()) return;
    const a = findAnchor(e.target);
    if (!a || skipAnchor(a)) return;
    const url = hrefOf(a);
    if (!url || targetOff(url)) return;
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
    const md = list
      .map((x) => {
        const tags = favTagsOf(x).map((t) => '#' + t).join(' ');
        return '- [' + (x.title || x.host || x.url) + '](' + x.url + ')' + (tags ? ' ' + tags : '');
      })
      .join('\n');
    try {
      await navigator.clipboard.writeText('# Peek 收藏\n\n' + md + '\n');
      toast('已复制 ' + list.length + ' 条到剪贴板');
    } catch (e) {
      toast('复制失败：浏览器拒绝了剪贴板访问');
    }
  }

  async function favExportJson() {
    const list = await favRead();
    if (!list.length) {
      toast('收藏夹是空的');
      return;
    }
    let version = '';
    try {
      version = chrome.runtime.getManifest().version;
    } catch (e) {}
    const payload = {
      app: 'peek',
      kind: 'favorites',
      version,
      exportedAt: new Date().toISOString(),
      favorites: list
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    a.href = url;
    a.download = 'peek-favorites-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('已导出 ' + list.length + ' 条收藏 JSON');
  }

  function beginTagEdit(shadow, item, t2) {
    if (!t2 || !t2.parentElement) return;
    const input = document.createElement('input');
    input.className = 'fav-tag-in';
    input.type = 'text';
    input.spellcheck = false;
    input.value = favTagsOf(item).join(' ');
    input.placeholder = '标签，空格分隔，最多 3 个';
    input.setAttribute('aria-label', '编辑标签');
    t2.replaceWith(input);
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const write = save ? favSetTags(item.url, input.value) : Promise.resolve();
      write.then(() => renderFavList(shadow));
    };
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') {
        ev.preventDefault();
        finish(true);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
    setTimeout(() => {
      try {
        input.focus();
        input.select();
      } catch (e) {}
    }, 0);
  }

  async function renderFavList(shadow) {
    const list = await favRead();
    const box = shadow.querySelector('[data-role="list"]');
    const empty = shadow.querySelector('[data-role="empty"]');
    const count = shadow.querySelector('[data-role="count"]');
    const chips = shadow.querySelector('[data-role="chips"]');
    if (!box) return;

    const tags = [];
    list.forEach((item) => {
      favTagsOf(item).forEach((t) => {
        if (tags.indexOf(t) === -1) tags.push(t);
      });
    });
    tags.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    if (favFilter && tags.indexOf(favFilter) === -1) favFilter = '';

    if (chips) {
      chips.textContent = '';
      chips.style.display = tags.length ? 'flex' : 'none';
      const addChip = (label, tag) => {
        const chip = document.createElement('button');
        chip.className = 'fav-chip' + (favFilter === tag ? ' on' : '');
        chip.type = 'button';
        chip.textContent = label;
        chip.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          favFilter = tag;
          renderFavList(shadow);
        });
        chips.appendChild(chip);
      };
      if (tags.length) {
        addChip('全部', '');
        tags.forEach((t) => addChip('#' + t, t));
      }
    }

    const shown = favFilter ? list.filter((x) => favTagsOf(x).indexOf(favFilter) !== -1) : list;
    box.textContent = '';
    count.textContent = !list.length
      ? ''
      : shown.length === list.length
        ? list.length + ' 个链接'
        : shown.length + ' / ' + list.length + ' 个链接';
    box.style.display = shown.length ? 'block' : 'none';
    empty.style.display = shown.length ? 'none' : 'block';
    if (!shown.length) {
      empty.textContent = favFilter
        ? '没有带「' + favFilter + '」标签的链接。'
        : '还没有收藏。把链接拖到页面空白处，或 Ctrl + 右键点击链接即可收藏。';
    }

    shown.forEach((item) => {
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
      const host = document.createElement('span');
      host.className = 'fav-host';
      host.textContent = item.host || '';
      t2.appendChild(host);
      favTagsOf(item).forEach((tag) => {
        const chip = document.createElement('span');
        chip.className = 'fav-tag';
        chip.textContent = '#' + tag;
        t2.appendChild(chip);
      });
      tx.appendChild(t1);
      tx.appendChild(t2);

      const tagBtn = document.createElement('button');
      tagBtn.className = 'fav-tagbtn';
      tagBtn.type = 'button';
      tagBtn.title = '编辑标签';
      tagBtn.setAttribute('aria-label', '编辑标签');
      tagBtn.innerHTML = ICON.tag;
      tagBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        beginTagEdit(shadow, item, t2);
      });

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
      row.appendChild(tagBtn);
      row.appendChild(x);
      row.addEventListener('click', (ev) => {
        if (ev.target && ev.target.closest && ev.target.closest('button,input')) return;
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
    paintHost(host);
    host.setAttribute('data-peek-fav', '');
    favFilter = '';
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
        else if (act === 'export-json') favExportJson();
        else if (act === 'import') {
          const file = shadow.querySelector('[data-role="file"]');
          if (file) file.click();
        } else if (act === 'save-current') {
          favToggle(location.href, (document.title || '').replace(/\s+/g, ' ').trim().slice(0, 90)).then(() =>
            renderFavList(shadow)
          );
        }
      },
      true
    );

    const fileInput = shadow.querySelector('[data-role="file"]');
    if (fileInput) {
      fileInput.addEventListener('change', () => {
        const file = fileInput.files && fileInput.files[0];
        fileInput.value = '';
        favImportFile(file, shadow);
      });
    }

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
    // 收藏面板 / 划词工具条：点在它们外面就收起来
    if (favHost && !inFav(e)) closeFavorites();
    if (selHost && !inSelTools(e)) hideSelectionTools();

    if (!peeks.length || e.button !== 0) return;
    if (!settings.closeOnOutside) return;
    if (inFloatUi(e)) return;

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

  function eventPath(e) {
    return (e.composedPath && e.composedPath()) || [];
  }

  function pathEditing(e) {
    return eventPath(e).some(
      (n) => n && n.nodeType === 1 && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.tagName === 'SELECT' || n.isContentEditable)
    );
  }

  function onKeyDown(e) {
    if (e.key === 'Escape' && favHost) {
      /* 正在行内编辑标签时，Esc 只退出编辑、保留面板 */
      if (eventPath(e).some((n) => n && n.classList && n.classList.contains('fav-tag-in'))) return;
      e.preventDefault();
      e.stopPropagation();
      closeFavorites();
      return;
    }

    if (e.key === 'Escape' && selHost) {
      e.preventDefault();
      e.stopPropagation();
      hideSelectionTools();
      return;
    }

    const aiOpen = peeks.find((p) => p.aiOpen);
    if (e.key === 'Escape' && aiOpen) {
      e.preventDefault();
      e.stopPropagation();
      toggleAi(aiOpen, false);
      return;
    }

    /* Alt + U 唤出收藏夹。用 e.code 而不是 e.key：
     * macOS 上按住 Option 会把 u 变成死键，e.key 会是 "Dead"。 */
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyU' && !e.repeat) {
      if (pathEditing(e)) return;
      e.preventDefault();
      e.stopPropagation();
      openFavorites();
      return;
    }

    if (!peeks.length) return;

    /* 全屏时 Esc 先交给浏览器退出全屏，不要顺手把浮层关掉 */
    if (e.key === 'Escape' && document.fullscreenElement) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      const target = focusedPeek();
      if (target) closePeek(target);
      return;
    }

    /* 焦点落在浮层里时，Tab / Shift+Tab 在并排的浮层之间切换 */
    if (e.key === 'Tab' && peeks.length > 1 && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const path = eventPath(e);
      const inside = peeks.some((p) => path.indexOf(p.host) !== -1);
      if (!inside || pathEditing(e)) return;
      e.preventDefault();
      e.stopPropagation();
      cycleFocus(e.shiftKey ? -1 : 1);
      return;
    }

    if (pathEditing(e)) return;

    /* Alt + ← / →：让浮层里的页面前进后退；Alt + R：切换阅读视图 */
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.repeat) {
      const target = focusedPeek();
      if (!target) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        frameCommand(target, e.key === 'ArrowLeft' ? 'back' : 'forward');
        return;
      }
      if (e.code === 'KeyR') {
        e.preventDefault();
        e.stopPropagation();
        toggleRead(target);
      }
    }
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

  /* 遮罩必须独立于每张浮层卡片：放进同一个 shadow root 时，
   * backdrop-filter 在部分 Chromium 合成路径下会盖到卡片的 HTML 内容上。 */
  function ensureBackdrop() {
    if (backdropHost) return backdropHost;
    const host = document.createElement('div');
    host.setAttribute('data-peek-backdrop', '');
    host.style.setProperty('all', 'initial', 'important');
    host.style.setProperty('position', 'fixed', 'important');
    host.style.setProperty('inset', '0', 'important');
    host.style.setProperty('display', 'block', 'important');
    host.style.setProperty('z-index', '2147483646', 'important');
    host.style.setProperty('pointer-events', 'none', 'important');
    host.style.setProperty('isolation', 'isolate', 'important');
    const shadow = host.attachShadow({ mode: 'open' });
    applyStyles(shadow);
    const screen = document.createElement('div');
    screen.className = 'backdrop';
    shadow.appendChild(screen);
    document.documentElement.appendChild(host);
    backdropHost = host;
    return host;
  }

  function removeBackdrop() {
    if (!backdropHost) return;
    try {
      backdropHost.remove();
    } catch (e) {}
    backdropHost = null;
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
    if (settings.theme === 'light' || settings.theme === 'dark' || settings.theme === 'sepia') return settings.theme;
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (e) {
      return 'light';
    }
  }

  function paintHost(host) {
    if (!host) return;
    host.setAttribute('data-theme', resolveTheme());
    if (settings.blur !== false) host.setAttribute('data-blur', '');
    else host.removeAttribute('data-blur');
  }

  /* 图片链接直接交给查看器，不走 iframe —— 浏览器给图片的默认背景和
   * 缩放控制都很差，而且 iframe 里的图片没法暂停 GIF。 */
  function imageKindOf(url) {
    try {
      const path = new URL(url).pathname.toLowerCase();
      if (/\.gif$/.test(path)) return 'gif';
      if (/\.(png|jpe?g|webp|avif|svg|bmp|ico)$/.test(path)) return 'image';
    } catch (e) {}
    return null;
  }

  function sizeFor(site) {
    const sizes = settings.siteSizes;
    const s = site && sizes && typeof sizes === 'object' ? sizes[site] : null;
    if (s && Number.isFinite(s.w) && Number.isFinite(s.h)) return { w: s.w, h: s.h };
    return { w: settings.width || 880, h: settings.height || 620 };
  }

  /* 缩放后的尺寸记在站点名下，换一个站点仍用全局默认值。 */
  function saveSiteSize(site, size) {
    if (!site) {
      try {
        chrome.storage.local.set({ width: size.width, height: size.height });
      } catch (e) {}
      return;
    }
    const next = Object.assign({}, settings.siteSizes || {});
    next[site] = { w: size.width, h: size.height, at: Date.now() };

    const keys = Object.keys(next);
    if (keys.length > SITE_SIZE_LIMIT) {
      keys
        .sort((a, b) => (next[a].at || 0) - (next[b].at || 0))
        .slice(0, keys.length - SITE_SIZE_LIMIT)
        .forEach((k) => delete next[k]);
    }

    settings.siteSizes = next;
    try {
      chrome.storage.local.set({ siteSizes: next });
    } catch (e) {}
  }

  function geometry(rect, size) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(size.w || 880, Math.max(360, vw - 40));
    const h = Math.min(size.h || 620, Math.max(280, vh - 40));

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
    const allDocked = peeks.length > 0 && peeks.every((p) => p.card.classList.contains('docked'));

    if (peeks.length) {
      const bh = ensureBackdrop();
      bh.setAttribute('data-theme', resolveTheme());
      if (!dim || allDocked) bh.setAttribute('data-nodim', '');
      else bh.removeAttribute('data-nodim');
      if (settings.blur !== false && !allDocked) bh.setAttribute('data-blur', '');
      else bh.removeAttribute('data-blur');
      bh.setAttribute('data-ready', '');
    } else {
      removeBackdrop();
    }

    peeks.forEach((p, i) => {
      if (p.card.classList.contains('docked')) p.host.setAttribute('data-docked', '');
      else p.host.removeAttribute('data-docked');
      if (multi) p.host.setAttribute('data-multi', '');
      else p.host.removeAttribute('data-multi');
      const aiBtn = p.shadow.querySelector('[data-act="ai"]');
      if (aiBtn) aiBtn.hidden = !settings.aiEnabled || p.image;
      const swapL = p.shadow.querySelector('[data-act="swap-l"]');
      const swapR = p.shadow.querySelector('[data-act="swap-r"]');
      if (swapL) swapL.disabled = !multi || i === 0;
      if (swapR) swapR.disabled = !multi || i === peeks.length - 1;
    });
  }

  function swapPeek(peek, dir) {
    const i = peeks.indexOf(peek);
    if (i === -1) return;
    const j = i + dir;
    if (j < 0 || j >= peeks.length) return;
    peeks[i] = peeks[j];
    peeks[j] = peek;
    setFocus(peek);
    syncChrome();
    tile();
  }

  function focusedPeek() {
    return peeks.find((p) => p.card.classList.contains('focused')) || peeks[peeks.length - 1] || null;
  }

  function cycleFocus(dir) {
    if (peeks.length < 2) return;
    const cur = focusedPeek();
    let i = peeks.indexOf(cur);
    if (i === -1) i = 0;
    const next = peeks[(i + dir + peeks.length) % peeks.length];
    setFocus(next);
    try {
      next.card.focus({ preventScroll: true });
    } catch (e) {}
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

    paintHost(host);

    const card = shadow.querySelector('.card');
    card.tabIndex = -1;
    const frame = shadow.querySelector('.frame');
    const bar = shadow.querySelector('.bar');
    const loader = shadow.querySelector('.loader');
    const fallback = shadow.querySelector('.fallback');
    const readBtn = shadow.querySelector('[data-act="read"]');
    const dockBtn = shadow.querySelector('[data-act="dock"]');

    const g = geometry(rect, sizeFor(site));
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
      const favFallback = shadow.querySelector('.fav-fallback');
      if (favFallback) favFallback.textContent = (hostname.charAt(0) || '•').toUpperCase();
      fav.src = chrome.runtime.getURL('/_favicon/?pageUrl=' + encodeURIComponent(url) + '&size=32');
      fav.addEventListener('error', () => {
        fav.style.display = 'none';
      });
    } catch (e) {}

    document.documentElement.appendChild(host);

    const imgKind = imageKindOf(url);
    const peek = {
      host, shadow, card, frame, bar, loader, fallback, readBtn, dockBtn, t1,
      url, theme, hostName: hostname, hostKey: site, timer: null, prev: null, reading: false,
      readFailed: false, image: Boolean(imgKind), imgKind, imageCtl: null, pageText: '',
      aiOpen: false, aiBusy: false, aiMessages: []
    };

    if (imgKind) {
      readBtn.hidden = true;
      card.classList.add('image');
    }

    peeks.push(peek);
    /* 卡片在 Shadow DOM 里全屏时，fullscreenchange 不一定冒泡到 document，
     * 直接在 shadow root 上听，保证浏览器原生 Esc 退出后状态能同步。 */
    shadow.addEventListener('fullscreenchange', syncImmersive);
    setFocus(peek);
    syncChrome();
    if (peeks.length > 1) {
      tile();
      try {
        card.focus({ preventScroll: true });
      } catch (e) {}
    }

    requestAnimationFrame(() => {
      if (peeks.indexOf(peek) !== -1) host.setAttribute('data-ready', '');
    });

    /* --- 交互 --- */

    card.addEventListener(
      'pointerdown',
      (e) => {
        setFocus(peek);
        const t = e.target;
        const editing = t && t.closest && t.closest('input,textarea,select,[contenteditable]');
        if (!editing) {
          try {
            card.focus({ preventScroll: true });
          } catch (err) {}
        }
      },
      true
    );

    shadow.addEventListener('click', (e) => {
      const el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      const act = el.getAttribute('data-act');

      if (act === 'close') closePeek(peek);
      else if (act === 'swap-l') swapPeek(peek, -1);
      else if (act === 'swap-r') swapPeek(peek, 1);
      else if (act === 'immersive') toggleImmersive(peek);
      else if (act === 'ai') toggleAi(peek);
      else if (act === 'ai-close') toggleAi(peek, false);
      else if (act === 'ai-send') askAi(peek);
      else if (act.indexOf('img-') === 0) imageAction(peek, act);
      else if (act === 'tab') {
        sendBg({ type: 'peek:open-tab', url });
        closePeek(peek);
      } else if (act === 'window') {
        const r = card.getBoundingClientRect();
        sendBg({ type: 'peek:open-window', url, rect: { left: r.left, top: r.top, bottom: r.bottom, width: r.width } });
        closePeek(peek);
      } else if (act === 'always-window') {
        const r = card.getBoundingClientRect();
        const prev = exactRule(peek.hostKey);
        setRule(peek.hostKey, 'window');
        sendBg({ type: 'peek:open-window', url, rect: { left: r.left, top: r.top, bottom: r.bottom, width: r.width } });
        closePeek(peek);
        toast(peek.hostKey + ' 以后都用独立小窗打开', 6200, {
          label: '撤销',
          onClick: () => setRule(peek.hostKey, prev)
        });
      } else if (act === 'dock') toggleDock(peek);
      else if (act === 'back') showOriginal(peek);
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
            const site = peek.hostKey;
            const size = draft;
            draft = null;
            clearTimeout(sizeSaveTimer);
            sizeSaveTimer = setTimeout(() => {
              saveSiteSize(site, size);
            }, 400);
          }
        };

        window.addEventListener('pointermove', move, true);
        window.addEventListener('pointerup', up, true);
        window.addEventListener('pointercancel', up, true);
      });
    });

    const aiIn = shadow.querySelector('[data-role="ai-in"]');
    if (aiIn) {
      aiIn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          askAi(peek);
        }
      });
    }

    if (imgKind) {
      setupImageViewer(peek, url, imgKind);
      return;
    }

    frame.addEventListener('load', () => {
      if (peeks.indexOf(peek) === -1) return;
      clearTimeout(peek.timer);
      loader.classList.add('hide');
      fallback.classList.remove('show');
      fallback.querySelector('.fb-t').textContent = '这个页面没能嵌进来';
      if (peek.reading) applyReadingTheme(peek);
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

  function showFallback(peek, text, title) {
    peek.loader.classList.add('hide');
    peek.fallback.querySelector('.fb-d').textContent = text;
    peek.fallback.querySelector('.fb-t').textContent = title || '这个页面没能嵌进来';
    const back = peek.fallback.querySelector('[data-act="back"]');
    if (back) back.hidden = !peek.readFailed;
    peek.fallback.classList.add('show');
  }

  function showOriginal(peek) {
    if (peek.image) return;
    peek.reading = false;
    peek.readFailed = false;
    peek.readBtn.classList.remove('on');
    peek.fallback.classList.remove('show');
    peek.loader.classList.remove('hide');
    peek.loader.querySelector('.lt').textContent = '正在加载 ' + (peek.hostName || '页面');
    try {
      peek.frame.removeAttribute('srcdoc');
      peek.frame.src = peek.url;
    } catch (e) {}
  }

  /* ---------------- 图片查看器 ---------------- */

  function setupImageViewer(peek, url, kind) {
    const shadow = peek.shadow;
    const img = shadow.querySelector('.img-el');
    const wrap = shadow.querySelector('.img-wrap');
    const pct = shadow.querySelector('.img-pct');
    const gifBtn = shadow.querySelector('[data-act="img-gif"]');
    const fbRead = peek.fallback.querySelector('[data-act="read"]');
    if (fbRead) fbRead.hidden = true;

    let media = img;
    let canvas = null;
    let scale = 1;
    let tx = 0;
    let ty = 0;

    const apply = () => {
      media.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
      pct.textContent = Math.round(scale * 100) + '%';
      wrap.classList.toggle('zoomed', scale > 1.001);
    };
    const zoomTo = (next) => {
      scale = clamp(next, 1, 8);
      if (scale <= 1.001) {
        scale = 1;
        tx = 0;
        ty = 0;
      }
      apply();
    };

    img.addEventListener('load', () => {
      if (peeks.indexOf(peek) === -1) return;
      peek.loader.classList.add('hide');
      peek.fallback.classList.remove('show');
      if (kind === 'gif') gifBtn.hidden = false;
    });
    img.addEventListener('error', () => {
      if (peeks.indexOf(peek) === -1) return;
      showFallback(peek, '图片没能加载，可能是原站点拒绝外链。可以点“新标签页打开”直接看原图。', '图片加载失败');
    });
    img.src = url;

    wrap.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        zoomTo(scale * (e.deltaY < 0 ? 1.12 : 0.89));
      },
      { passive: false }
    );

    wrap.addEventListener('dblclick', () => {
      zoomTo(scale > 1.001 ? 1 : 2);
    });

    let pan = null;
    wrap.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || scale <= 1.001) return;
      pan = { x: e.clientX, y: e.clientY, tx, ty };
      wrap.classList.add('dragging');
      wrap.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    wrap.addEventListener('pointermove', (e) => {
      if (!pan) return;
      tx = pan.tx + e.clientX - pan.x;
      ty = pan.ty + e.clientY - pan.y;
      apply();
    });
    const endPan = () => {
      pan = null;
      wrap.classList.remove('dragging');
    };
    wrap.addEventListener('pointerup', endPan);
    wrap.addEventListener('pointercancel', endPan);

    /* GIF 暂停没有 API，只能把当前帧画到 canvas 上盖住原图；
     * 恢复播放时重新给 src 加时间戳，让浏览器从头播。 */
    const freezeGif = () => {
      if (!img.complete || !img.naturalWidth) {
        toast('GIF 还没加载完，稍等一下');
        return;
      }
      try {
        canvas = document.createElement('canvas');
        canvas.className = 'img-el';
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        canvas.style.transform = media.style.transform;
        wrap.appendChild(canvas);
        img.style.display = 'none';
        media = canvas;
        apply();
        gifBtn.textContent = '播放 GIF';
      } catch (e) {
        toast('这个 GIF 没法冻结');
      }
    };
    const resumeGif = () => {
      if (canvas) {
        try {
          canvas.remove();
        } catch (e) {}
        canvas = null;
      }
      img.style.display = '';
      media = img;
      try {
        img.src = url + (url.indexOf('?') === -1 ? '?' : '&') + 'peekgif=' + Date.now();
      } catch (e) {}
      apply();
      gifBtn.textContent = '暂停 GIF';
    };

    peek.imageCtl = {
      zoomBy: (factor) => zoomTo(scale * factor),
      fit: () => zoomTo(1),
      toggleGif: () => (canvas ? resumeGif() : freezeGif())
    };
  }

  function imageAction(peek, act) {
    const ctl = peek.imageCtl;
    if (!ctl) return;
    if (act === 'img-in') ctl.zoomBy(1.25);
    else if (act === 'img-out') ctl.zoomBy(0.8);
    else if (act === 'img-fit') ctl.fit();
    else if (act === 'img-gif') ctl.toggleGif();
    else if (act === 'img-original') sendBg({ type: 'peek:open-tab', url: peek.url });
  }

  /* ---------------- 沉浸模式 ---------------- */

  /* 浮层卡片在 Shadow DOM 里，外层 document.fullscreenElement 会被重定向到宿主元素，
   * 所以判断“谁在全屏”要问 shadow root。 */
  function inFullscreen(peek) {
    try {
      if (peek.shadow.fullscreenElement) return true;
    } catch (e) {}
    return document.fullscreenElement === peek.host;
  }

  function toggleImmersive(peek) {
    const card = peek.card;
    if (inFullscreen(peek)) {
      try {
        document.exitFullscreen();
      } catch (e) {}
      return;
    }
    const request = card.requestFullscreen || card.webkitRequestFullscreen;
    if (!request) {
      toast('当前浏览器不支持页面内全屏');
      return;
    }
    try {
      const out = request.call(card);
      if (out && out.catch) out.catch(() => toast('全屏被浏览器拒绝了'));
    } catch (e) {
      toast('全屏被浏览器拒绝了');
    }
  }

  function syncImmersive() {
    peeks.forEach((p) => {
      const on = inFullscreen(p);
      p.card.classList.toggle('immersive', on);
      if (on) p.host.setAttribute('data-immersive', '');
      else p.host.removeAttribute('data-immersive');
      const btn = p.shadow.querySelector('[data-act="immersive"]');
      if (btn) {
        btn.classList.toggle('on', on);
        btn.title = on ? '退出沉浸模式' : '沉浸模式：浮层铺满屏幕';
      }
    });
  }

  /* ---------------- AI 问答 ---------------- */

  function aiConfigured() {
    return Boolean(settings.aiEnabled && String(settings.aiEndpoint || '').trim() && String(settings.aiModel || '').trim());
  }

  function aiLog(peek, text, cls) {
    const log = peek.shadow.querySelector('[data-role="ai-log"]');
    if (!log) return null;
    const row = document.createElement('div');
    row.className = 'ai-msg' + (cls ? ' ' + cls : '');
    row.textContent = text;
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
    return row;
  }

  function aiSetBusy(peek, busy) {
    peek.aiBusy = busy;
    const btn = peek.shadow.querySelector('[data-act="ai-send"]');
    if (btn) btn.disabled = busy;
  }

  function toggleAi(peek, force) {
    if (peek.image) {
      toast('图片预览没有正文，AI 问答不可用');
      return;
    }
    const panel = peek.shadow.querySelector('.ai-panel');
    if (!panel) return;
    const open = force === false ? false : !peek.aiOpen;
    peek.aiOpen = open;
    panel.classList.toggle('show', open);
    const btn = peek.shadow.querySelector('[data-act="ai"]');
    if (btn) btn.classList.toggle('on', open);
    if (!open) return;
    if (!peek.aiMessages.length && !peek.aiHinted) {
      peek.aiHinted = true;
      if (!aiConfigured()) {
        aiLog(peek, '还没配置 AI 接口。打开扩展设置 → AI 问答，填写接口地址和模型名后再来。', 'err');
      } else {
        aiLog(peek, '可以就这个页面提问了。点“发送”时才会读取正文并发送到你配置的接口。');
      }
    }
    setTimeout(() => {
      const input = peek.shadow.querySelector('[data-role="ai-in"]');
      if (input) input.focus();
    }, 30);
  }

  async function askAi(peek) {
    if (!peek.aiOpen || peek.aiBusy) return;
    const input = peek.shadow.querySelector('[data-role="ai-in"]');
    if (!input) return;
    const question = input.value.replace(/\s+/g, ' ').trim().slice(0, 4000);
    if (!question) {
      input.focus();
      return;
    }
    if (!aiConfigured()) {
      aiLog(peek, '还没配置 AI 接口。打开扩展设置 → AI 问答填写接口、模型和 Key。', 'err');
      return;
    }
    input.value = '';
    aiLog(peek, question, 'user');
    const pending = aiLog(peek, '正在读取页面正文…', 'pending');
    aiSetBusy(peek, true);

    let text = peek.pageText;
    if (!text) {
      const res = await sendBg({ type: 'peek:extract', url: peek.url, theme: peek.theme });
      if (peeks.indexOf(peek) === -1) return;
      if (res && res.ok) {
        text = String(res.text || '').slice(0, 16000);
        peek.pageText = text;
      } else {
        text = '';
      }
    }
    if (peeks.indexOf(peek) === -1) return;
    if (pending) pending.textContent = '思考中…';

    const history = peek.aiMessages.slice(-AI_HISTORY_MESSAGES).map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
    const out = await sendBg({
      type: 'peek:ai',
      question,
      pageUrl: peek.url,
      pageTitle: (peek.t1.textContent || '').slice(0, 200),
      pageText: text || '',
      history
    });
    if (peeks.indexOf(peek) === -1) return;
    aiSetBusy(peek, false);

    const target = pending;
    if (!target) return;
    if (!out || !out.ok) {
      target.className = 'ai-msg err';
      target.textContent =
        '回答失败：' +
        ((out && out.error) || '接口没有响应') +
        '\n检查设置里的接口地址、模型和 Key；接口需要返回 OpenAI 兼容的 JSON。';
      return;
    }
    const answer = String(out.text || '').trim() || '（接口返回了空内容）';
    target.className = 'ai-msg';
    target.textContent = answer;
    peek.aiMessages.push({ role: 'user', content: question }, { role: 'assistant', content: answer.slice(0, 8000) });
    if (peek.aiMessages.length > 20) peek.aiMessages = peek.aiMessages.slice(-20);
    const log = peek.shadow.querySelector('[data-role="ai-log"]');
    if (log) log.scrollTop = log.scrollHeight;
  }

  function frameCommand(peek, cmd) {
    try {
      const win = peek.frame.contentWindow;
      if (win) win.postMessage({ __peekCmd: cmd }, '*');
    } catch (e) {}
  }

  function closePeek(peek) {
    const i = peeks.indexOf(peek);
    if (i === -1) return;
    peeks.splice(i, 1);
    clearTimeout(peek.timer);
    if (inFullscreen(peek)) {
      try {
        document.exitFullscreen();
      } catch (e) {}
    }

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
    if (peek.image) return;
    if (peek.aiOpen) toggleAi(peek, false);
    if (peek.reading) {
      peek.reading = false;
      peek.readFailed = false;
      peek.readBtn.classList.remove('on');
      peek.loader.classList.remove('hide');
      peek.loader.querySelector('.lt').textContent = '正在加载 ' + (peek.hostName || '页面');
      peek.fallback.classList.remove('show');
      if (peek.hostName) peek.t1.textContent = peek.hostName;
      try {
        peek.frame.removeAttribute('srcdoc');
        peek.frame.src = peek.url;
      } catch (e) {}
      return;
    }

    peek.readBtn.classList.add('on');
    peek.readFailed = false;
    peek.loader.classList.remove('hide');
    peek.loader.querySelector('.lt').textContent = '正在抽取正文…';
    peek.fallback.classList.remove('show');

    await sendBg({ type: 'peek:frame-rule' });
    const res = await sendBg({ type: 'peek:extract', url: peek.url, theme: peek.theme });
    if (peeks.indexOf(peek) === -1) return;

    if (!res || !res.ok) {
      peek.readBtn.classList.remove('on');
      peek.readFailed = true;
      showFallback(
        peek,
        (res && res.error ? res.error + '。' : '') + '阅读视图只适合文章页。可以换独立小窗或新标签页看完整页面。',
        '正文抽取失败'
      );
      return;
    }

    peek.reading = true;
    peek.readFailed = false;
    if (res.text) peek.pageText = String(res.text).slice(0, 16000);
    try {
      peek.frame.setAttribute('srcdoc', res.html);
    } catch (e) {
      peek.readBtn.classList.remove('on');
      peek.readFailed = true;
      showFallback(peek, '正文渲染失败，换独立小窗试试。', '正文渲染失败');
      return;
    }
    requestAnimationFrame(() => applyReadingTheme(peek));
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
    document.addEventListener('mouseup', onSelectionMouseUp, true);
    document.addEventListener('fullscreenchange', syncImmersive);
    window.addEventListener('scroll', hideSelectionTools, true);
    window.addEventListener('resize', hideSelectionTools);

    /* 预览 iframe 里也跑着这份脚本；父级用 postMessage 让它前进 / 后退，
     * 跨域时拿不到 contentWindow.history，只能这样绕。 */
    if (window.top !== window) {
      window.addEventListener('message', (ev) => {
        const d = ev.data;
        if (!d || !d.__peekCmd) return;
        try {
          if (d.__peekCmd === 'back') history.back();
          else if (d.__peekCmd === 'forward') history.forward();
        } catch (e) {}
      });
    }

    try {
      chrome.runtime.onMessage.addListener((msg) => {
        if (!msg || !msg.type) return;
        if (msg.type === 'peek:open' && msg.url) openPeek(msg.url, null);
        else if (msg.type === 'peek:favorites') openFavorites();
        else if (msg.type === 'peek:sync-rules') loadSettings().then(syncChrome);
        else if (msg.type === 'peek:notice' && msg.text) {
          const undo = msg.undo || null;
          toast(msg.text, undo ? 6200 : 2800, undo ? {
            label: '撤销',
            onClick: () => setRule(undo.host, undo.prev)
          } : null);
        }
      });
    } catch (e) {}
  }

  loadSettings().then(bind);
  watchSettings();
  watchSystemTheme();
})();
