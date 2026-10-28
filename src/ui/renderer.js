// 渲染层：对接 window.api（preload.cjs），复刻 vivo 笔记三栏交互。
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const state = { notes: [], current: null, book: '-2', q: '' };

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  const yest = new Date(now - 86400000);
  if (d.toDateString() === yest.toDateString()) return '昨天';
  return `${d.getMonth()+1}月${d.getDate()}日`;
}
function plain(html) { const t = document.createElement('div'); t.innerHTML = html || ''; return (t.textContent || '').trim(); }
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.classList.remove('show'); setTimeout(() => { t.hidden = true; }, 250); }, 1800);
}

async function refresh() {
  state.notes = await window.api.listNotes({ limit: 200 });
  const q = state.q.toLowerCase();
  let list = state.notes;
  if (state.book === 'encrypt') list = list.filter(n => n.encryptType === 1);
  else if (state.book === 'recycle') list = [];
  else list = list.filter(n => n.encryptType !== 1);
  if (q) list = list.filter(n => ((n.title||'')+(plain(n.content)||'')).toLowerCase().includes(q));

  $('#cnt-all').textContent = state.notes.length || '';
  const el = $('#list'); el.innerHTML = '';
  for (const n of list) {
    const item = document.createElement('div');
    item.className = 'note-item' + (state.current === n.guid ? ' active' : '');
    const desc = plain(n.content) || '暂无正文';
    item.innerHTML =
      `<div class="prefix">${n.stickTop ? '<span class="top-flag"></span>' : ''}</div>
       <div class="cnt">
         <div class="tt">${esc(n.title || '无标题')}</div>
         <div class="desc">${esc(desc)}</div>
         <div class="doc"><span class="desc">${n.dirty ? '<span class="dirty">● 待同步</span>' : ''}</span>
           <span class="date-info">${fmtTime(n.updateTime || n.createTime)}</span></div>
       </div>
       <div class="suffix"></div>`;
    item.onclick = () => open(n.guid);
    el.appendChild(item);
  }
  if (list.length === 0) {
    el.innerHTML = '<div style="padding:40px 12px;text-align:center;color:var(--text-8);font-size:13px">暂无笔记</div>';
  }
}

// ---- TinyMCE 桥接：有编辑器用编辑器，没有回退 textarea ----
function getEditorContent() {
  if (window.tinymce && window.__editorReady && tinymce.activeEditor) {
    return tinymce.activeEditor.getContent();
  }
  return $('#content') ? $('#content').value : '';
}
function setEditorContent(html) {
  if (window.tinymce && window.__editorReady && tinymce.activeEditor) {
    tinymce.activeEditor.setContent(html || '');
  } else if ($('#content')) {
    $('#content').value = html || '';
  }
}

async function open(guid) {
  state.current = guid;
  const n = await window.api.getNote(guid);
  $('#title').value = n?.title || '';
  setEditorContent(n?.content || '');
  $('#meta-time').textContent = n ? `更新于 ${new Date(n.updateTime || n.createTime || Date.now()).toLocaleString()}` : '';
  $('#meta-dirty').textContent = n?.dirty ? '● 有未同步更改' : '';
  $('#empty-editor').style.display = 'none';
  $('#editor-body').style.display = '';
  $('#toolbar').style.display = '';
  refresh();
}

// ---- 顶栏 / 侧栏事件 ----
$('#btn-new').onclick = () => {
  state.current = null;
  $('#title').value = '';
  setEditorContent('');
  $('#meta-time').textContent = ''; $('#meta-dirty').textContent = '';
  $('#empty-editor').style.display = 'none';
  $('#editor-body').style.display = '';
  $('#toolbar').style.display = '';
  $('#title').focus();
};

$('#btn-save').onclick = async () => {
  const guid = state.current || ('n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  await window.api.saveNote({
    guid, title: $('#title').value || '无标题', content: getEditorContent(),
    deleted: 1, createTime: state.current ? undefined : Date.now(),
  });
  state.current = guid;
  $('#save-state').textContent = '已保存 · 待同步';
  $('#meta-dirty').textContent = '● 有未同步更改';
  toast('已保存到本地');
  refresh();
};

$('#btn-sync').onclick = async () => {
  $('#btn-sync').disabled = true;
  $('#btn-sync').textContent = '⟳ 同步中…';
  const r = await window.api.syncNow();
  $('#btn-sync').disabled = false;
  $('#btn-sync').textContent = '⟳ 同步';
  if (r.ok) toast(`同步完成（${r.direction === 'pull' ? '拉取' : r.skipped ? '无变更' : '推送'}）`);
  else toast(`同步失败：${r.error || 'code ' + r.code}`);
  refresh();
};

$('#btn-login').onclick = async () => {
  toast('正在打开 vivo 账号登录…');
  const r = await window.api.login();
  if (r.ok) {
    $('#who').textContent = (r.openId || '').slice(0, 12);
    $('#avatar').textContent = '✓';
    toast('登录成功');
  } else {
    toast('登录未完成');
  }
};

$('#q').addEventListener('input', (e) => { state.q = e.target.value.trim(); refresh(); });

$$('#book-list .sidebar-item').forEach(el => {
  el.onclick = () => {
    $$('#book-list .sidebar-item').forEach(x => x.classList.remove('active'));
    el.classList.add('active');
    state.book = el.dataset.book;
    $('#crumb').textContent = el.querySelector('.text').textContent;
    refresh();
  };
});

// 自动保存（失焦时）
$('#content').addEventListener('blur', () => { if (state.current && $('#content').value !== undefined) { /* 静默保存 */ } });

(async function init() {
  const logged = await window.api.isLogin();
  if (logged) { $('#who').textContent = '已登录'; $('#avatar').textContent = '✓'; }
  refresh();
})();
