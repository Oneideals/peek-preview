/* Peek — offscreen document
 * 只做一件事：抓下一篇文章，用 Readability 抽出正文，产出安全的 HTML。
 * 放在 offscreen 里是因为 MV3 的 service worker 没有 DOMParser。
 */

function pageCss(theme) {
  const dark = theme === 'dark';
  const codeBg = dark ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.04)';
  const codeInline = dark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.05)';
  return [
    ':root{color-scheme:' + (dark ? 'dark' : 'light') +
      ';--t:' + (dark ? '#e9e9ef' : '#1a1a1f') +
      ';--m:' + (dark ? '#8b8b96' : '#78787f') +
      ';--l:' + (dark ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.09)') +
      ';--a:' + (dark ? '#a99cff' : '#5b4fd6') +
      ';--bg:' + (dark ? '#191a1d' : '#ffffff') + '}',
    '*{box-sizing:border-box}',
    'html,body{margin:0;background:var(--bg)}',
    'body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Songti SC","Noto Serif SC",Georgia,serif;color:var(--t);-webkit-font-smoothing:antialiased;line-height:1.75}',
    '.pk{max-width:38em;margin:0 auto;padding:36px 44px 80px}',
    'h1{font-size:26px;line-height:1.35;font-weight:600;margin:0 0 10px;letter-spacing:-.2px}',
    '.pk-byline{font-size:12.5px;color:var(--m);margin:0 0 22px}',
    '.pk-content{font-size:15.5px}',
    '.pk-content p{margin:0 0 17px}',
    '.pk-content img{max-width:100%;height:auto;border-radius:8px;margin:0 0 17px;display:block}',
    '.pk-content figure{margin:0 0 17px}',
    '.pk-content figcaption{font-size:12.5px;color:var(--m);text-align:center;margin-top:8px}',
    '.pk-content a{color:var(--a);text-decoration:none;border-bottom:1px solid var(--l)}',
    '.pk-content h2,.pk-content h3,.pk-content h4{font-size:19px;font-weight:600;margin:30px 0 12px;line-height:1.4}',
    '.pk-content pre,.pk-content code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}',
    '.pk-content pre{background:' + codeBg + ';padding:13px 15px;border-radius:8px;overflow:auto;line-height:1.6}',
    '.pk-content code{padding:1px 5px;border-radius:4px;background:' + codeInline + '}',
    '.pk-content blockquote{margin:0 0 17px;padding:2px 0 2px 16px;border-left:3px solid var(--a);color:var(--m)}',
    '.pk-content ul,.pk-content ol{padding-left:22px}',
    '.pk-content li{margin:0 0 8px}',
    '.pk-content table{width:100%;border-collapse:collapse;font-size:14px;margin:0 0 17px}',
    '.pk-content th,.pk-content td{border:1px solid var(--l);padding:8px 10px;text-align:left}',
    'hr{border:0;border-top:1px solid var(--l);margin:28px 0}',
    '.pk-nav{position:fixed;top:10px;right:12px;font:500 11px/1 -apple-system,sans-serif;color:var(--m);background:' + codeBg +
      ';padding:5px 9px;border-radius:6px;opacity:.85}'
  ].join('\n');
}

function navScript() {
  return [
    '<script>',
    'document.addEventListener("click",function(e){',
    'var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;',
    'if(!a)return;',
    'var h=a.getAttribute("href")||"";',
    'if(h.charAt(0)==="#"||/^(mailto|tel|javascript):/i.test(h))return;',
    'e.preventDefault();',
    'try{parent.postMessage({__peekNav:a.href},"*")}catch(err){}',
    '},true);',
    '</' + 'script>'
  ].join('\n');
}

function sanitize(root) {
  const drop = root.querySelectorAll('script,noscript,style,link,iframe,object,embed,form,input,button,select,textarea');
  drop.forEach((el) => el.remove());

  walk(root, (el) => {
    Array.from(el.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = (attr.value || '').replace(/\s/g, '').toLowerCase();
      if (name.indexOf('on') === 0) el.removeAttribute(attr.name);
      else if ((name === 'href' || name === 'src' || name === 'srcset') && value.indexOf('javascript:') === 0) {
        el.removeAttribute(attr.name);
      }
    });
    if (el.tagName === 'IMG') {
      el.removeAttribute('srcset');
      el.setAttribute('loading', 'lazy');
      el.setAttribute('referrerpolicy', 'no-referrer');
    }
  });

  return root.innerHTML;
}

function walk(el, fn) {
  if (!el || el.nodeType !== 1) return;
  fn(el);
  el = el.firstElementChild;
  while (el) {
    walk(el, fn);
    el = el.nextElementSibling;
  }
}

async function extract(url, theme) {
  const res = await fetch(url, { credentials: 'include', redirect: 'follow' });
  if (!res.ok) throw new Error('页面返回 ' + res.status);

  const type = res.headers.get('content-type') || '';
  if (!/text\/html|application\/xhtml/i.test(type)) {
    throw new Error('不是网页内容（' + (type.split(';')[0] || '未知类型') + '）');
  }

  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // 让相对路径按原站点解析
  const base = doc.createElement('base');
  base.setAttribute('href', url);
  doc.head.insertBefore(base, doc.head.firstChild);

  let result;
  try {
    result = new Readability(doc, { charThreshold: 250 }).parse();
  } catch (e) {
    throw new Error('解析失败：' + (e && e.message ? e.message : e));
  }
  if (!result || !result.content) throw new Error('这个页面没抽出可用正文，可能不是文章页');

  const holder = document.implementation.createHTMLDocument('peek');
  holder.body.innerHTML = result.content;
  const body = sanitize(holder.body);

  const byline = [result.byline, (result.siteName || '').trim()].filter(Boolean).join(' · ');

  const page = [
    '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>' + escapeText(result.title || '') + '</title>',
    '<style>' + pageCss(theme) + '</style></head><body>',
    '<article class="pk">',
    result.title ? '<h1>' + escapeText(result.title) + '</h1>' : '',
    byline ? '<p class="pk-byline">' + escapeText(byline) + '</p>' : '',
    '<div class="pk-content">' + body + '</div>',
    '</article>',
    '<div class="pk-nav">阅读视图 · 正文已重排</div>',
    navScript(),
    '</body></html>'
  ].join('');

  return { html: page, title: result.title, length: (result.textContent || '').length };
}

function escapeText(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type !== 'peek:extract') return;
  extract(msg.url, msg.theme)
    .then((out) => reply({ ok: true, ...out }))
    .catch((err) => reply({ ok: false, error: String((err && err.message) || err) }));
  return true;
});
