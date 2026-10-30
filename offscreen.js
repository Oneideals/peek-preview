/* Peek — offscreen document
 * 只做一件事：抓下一篇文章，用 Readability 抽出正文，产出安全的 HTML。
 * 放在 offscreen 里是因为 MV3 的 service worker 没有 DOMParser。
 */

function pageCss() {
  return [
    ':root{color-scheme:light;--t:#1b1b20;--m:#73737f;--l:rgba(20,20,35,.09);--a:#6a58e8;--bg:#ffffff;--bg-2:#f7f7fa;--bar:rgba(255,255,255,.82);--soft:rgba(106,88,232,.09);--code-bg:rgba(20,20,35,.035);--code-inline:rgba(20,20,35,.05)}',
    'html[data-theme="dark"]{color-scheme:dark;--t:#ededf2;--m:#9696a4;--l:rgba(255,255,255,.1);--a:#b8a9ff;--bg:#17171b;--bg-2:#1d1d22;--bar:rgba(23,23,27,.82);--soft:rgba(184,169,255,.10);--code-bg:rgba(255,255,255,.05);--code-inline:rgba(255,255,255,.065)}',
    'html[data-theme="sepia"]{color-scheme:light;--t:#3b3125;--m:#8d7b64;--l:rgba(88,66,38,.16);--a:#9a6529;--bg:#fbf4e6;--bg-2:#f6eddf;--bar:rgba(251,244,230,.84);--soft:rgba(154,101,41,.09);--code-bg:rgba(88,66,38,.065);--code-inline:rgba(88,66,38,.085)}',
    '*{box-sizing:border-box}',
    'html{scroll-behavior:smooth}',
    'html,body{margin:0;background:var(--bg)}',
    'body{font-family:"Iowan Old Style","Palatino Linotype","Book Antiqua","Songti SC","Noto Serif SC",Georgia,serif;color:var(--t);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;line-height:1.85;background:radial-gradient(80% 46% at 50% 0%,var(--soft),transparent 72%),var(--bg)}',
    '::selection{background:var(--soft);color:var(--t)}',
    '.pk{max-width:39em;margin:0 auto;padding:52px clamp(26px,6vw,60px) 88px}',
    'h1{font-size:clamp(29px,4.2vw,38px);line-height:1.2;font-weight:650;margin:0 0 18px;letter-spacing:-.035em;text-wrap:balance}',
    '.pk-byline{display:flex;align-items:center;gap:9px;font-size:11.5px;letter-spacing:.02em;color:var(--m);margin:0 0 34px}',
    '.pk-byline:before{content:"";width:18px;height:1px;background:var(--a);opacity:.55}',
    '.pk-content{font-size:17px;line-height:1.86;letter-spacing:.002em}',
    '.pk-content p{margin:0 0 1.30em;text-wrap:pretty}',
    '.pk-content img{max-width:100%;height:auto;border-radius:12px;margin:4px 0 1.4em;display:block;box-shadow:0 12px 34px rgba(20,20,35,.08)}',
    '.pk-content figure{margin:0 0 1.5em}',
    '.pk-content figcaption{font-size:12px;color:var(--m);text-align:center;margin-top:10px;letter-spacing:.01em}',
    '.pk-content a{color:var(--a);text-decoration:none;border-bottom:1px solid var(--l);transition:border-color .15s ease,color .15s ease}',
    '.pk-content a:hover{border-color:var(--a)}',
    '.pk-content h2,.pk-content h3,.pk-content h4{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC",sans-serif;font-weight:650;letter-spacing:-.02em;line-height:1.35;margin:2.2em 0 .7em}',
    '.pk-content h2{font-size:23px}',
    '.pk-content h3{font-size:19px}',
    '.pk-content h4{font-size:17px}',
    '.pk-content pre,.pk-content code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}',
    '.pk-content pre{background:var(--code-bg);border:1px solid var(--l);padding:16px 18px;border-radius:12px;overflow:auto;line-height:1.65;white-space:pre;tab-size:2}',
    '.pk-content pre code{padding:0;background:none;font-size:inherit;white-space:inherit}',
    '.pk-content code{padding:2px 6px;border-radius:5px;background:var(--code-inline);overflow-wrap:anywhere}',
    '.pk-content blockquote{margin:0 0 1.5em;padding:16px 20px;border-left:2px solid var(--a);border-radius:0 12px 12px 0;background:var(--soft);color:var(--m);font-size:16px}',
    '.pk-content blockquote p:last-child{margin-bottom:0}',
    '.pk-content ul,.pk-content ol{padding-left:1.35em;margin:0 0 1.3em}',
    '.pk-content li{margin:0 0 .55em}',
    '.pk-table{overflow-x:auto;margin:0 0 1.5em;border:1px solid var(--l);border-radius:12px}',
    '.pk-content table{width:100%;min-width:420px;border-collapse:collapse;font-size:13px;margin:0}',
    '.pk-content th,.pk-content td{border-bottom:1px solid var(--l);border-right:1px solid var(--l);padding:10px 12px;text-align:left;vertical-align:top}',
    '.pk-content tr:last-child td{border-bottom:0}',
    '.pk-content th:last-child,.pk-content td:last-child{border-right:0}',
    '.pk-content th{background:var(--code-bg);font-weight:650;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC",sans-serif;font-size:11px;letter-spacing:.03em;text-transform:uppercase;color:var(--m)}',
    '.pk-content sup{font-size:11px;line-height:0;vertical-align:super}',
    '.pk-content sup a{text-decoration:none;border:0;padding:0 1px}',
    '.pk-content .footnotes,.pk-content [role="doc-endnotes"]{font-size:12.5px;color:var(--m);border-top:1px solid var(--l);margin-top:36px;padding-top:16px}',
    '.pk-content kbd{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;padding:2px 6px;border:1px solid var(--l);border-bottom-width:2px;border-radius:5px;background:var(--code-bg)}',
    '.pk-content hr{border:0;border-top:1px solid var(--l);margin:2em 0}',
    'hr{border:0;border-top:1px solid var(--l);margin:30px 0}',
    '.pk-nav{position:fixed;top:14px;right:14px;font:500 10.5px/1 -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;color:var(--m);background:var(--bar);border:1px solid var(--l);box-shadow:0 6px 18px rgba(20,20,35,.06);padding:7px 10px;border-radius:8px;opacity:.9;-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px)}'
  ].join('\n');
}

function navScript() {
  return [
    '<script>',
    'document.addEventListener("click",function(e){',
    'var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;',
    'if(!a)return;',
    'var h=a.getAttribute("href")||"";',
    'if(h.charAt(0)==="#"){',
    'e.preventDefault();',
    'try{var id=decodeURIComponent(h.slice(1));var t=id&&document.getElementById(id);if(t)t.scrollIntoView({block:"start"});}catch(err){}',
    'return;',
    '}',
    'if(/^(mailto|tel|javascript):/i.test(h))return;',
    'e.preventDefault();',
    'try{parent.postMessage({__peekNav:a.href},"*")}catch(err){}',
    '},true);',
    'window.addEventListener("message",function(e){',
    'var d=e.data;if(!d)return;',
    'if(d.__peekTheme){document.documentElement.setAttribute("data-theme",String(d.__peekTheme));return;}',
    'if(!d.__peekCmd)return;',
    'try{if(d.__peekCmd==="back")history.back();else if(d.__peekCmd==="forward")history.forward();}catch(err){}',
    '});',
    '</' + 'script>'
  ].join('\n');
}

/* Readability 会按 <base> 把相对链接解析成绝对地址，页内锚点也不例外，
 * 结果点脚注就会跳出阅读视图。把指向本页的锚点还原成 #id。 */
function internalizeHashLinks(root, url) {
  let base;
  try {
    base = new URL(url);
  } catch (e) {
    return;
  }
  root.querySelectorAll('a[href]').forEach((a) => {
    const raw = a.getAttribute('href') || '';
    if (raw.charAt(0) === '#') return;
    let target;
    try {
      target = new URL(raw, url);
    } catch (e) {
      return;
    }
    if (!target.hash || target.origin !== base.origin) return;
    if (target.pathname !== base.pathname || target.search !== base.search) return;
    a.setAttribute('href', target.hash);
  });
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

  // 宽表格放进可横向滚动的容器，别把阅读视图撑破
  Array.from(root.querySelectorAll('table')).forEach((table) => {
    if (table.parentElement && table.parentElement.classList.contains('pk-table')) return;
    const wrap = root.ownerDocument.createElement('div');
    wrap.className = 'pk-table';
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
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
  internalizeHashLinks(holder.body, url);
  const hasH1 = Boolean(holder.body.querySelector('h1'));
  const body = sanitize(holder.body);

  const byline = [result.byline, (result.siteName || '').trim()].filter(Boolean).join(' · ');
  const themeAttr = theme === 'dark' || theme === 'sepia' ? theme : 'light';

  const page = [
    '<!DOCTYPE html><html lang="zh-CN" data-theme="' + themeAttr + '"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>' + escapeText(result.title || '') + '</title>',
    '<style>' + pageCss() + '</style></head><body>',
    '<article class="pk">',
    result.title && !hasH1 ? '<h1>' + escapeText(result.title) + '</h1>' : '',
    byline ? '<p class="pk-byline">' + escapeText(byline) + '</p>' : '',
    '<div class="pk-content">' + body + '</div>',
    '</article>',
    '<div class="pk-nav">阅读视图 · 正文已重排</div>',
    navScript(),
    '</body></html>'
  ].join('');

  return {
    html: page,
    title: result.title,
    length: (result.textContent || '').length,
    text: String(result.textContent || '').slice(0, 60000)
  };
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
