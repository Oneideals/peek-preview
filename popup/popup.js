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

  renderRules();
  renderFavCount();
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
  s = s.replace(/^[a-z]+:\/\//i, '').replace(/[/?#].*$/, '').replace(/^www\./, '');
  if (!/^[a-z0-9][a-z0-9.\-]*$/.test(s) || s.indexOf('.') === -1) return '';
  return s;
}

function bind() {
  $$('input[type="checkbox"][data-k]').forEach((el) => {
    el.addEventListener('change', () => save({ [el.dataset.k]: el.checked }));
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
          await chrome.tabs.sendMessage(tab.id, { type: 'peek:favorites' }).catch(() => {});
          window.close();
        }
      } catch (e) {}
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
})();
