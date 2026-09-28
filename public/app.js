let state = { accounts: [], posts: [], jobs: [] };
let activePostId = null;
let editingPostId = null;
let selectedImages = [];
let queueFilter = 'all';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const date = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
const platformName = value => value === 'douyin' ? '抖音' : value || '—';
const toast = message => { const el = $('toast'); el.textContent = message; el.style.display = 'block'; clearTimeout(toast.timer); toast.timer = setTimeout(() => el.style.display = 'none', 4000); };
async function api(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '操作失败');
  return data;
}
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function refresh() { state = await api('/api/state'); render(); }
function render() {
  const next = !state.accounts.length
    ? { title: '先添加一个抖音账户', text: '每个账户都有独立的浏览器登录资料。添加后打开登录窗口，扫码完成登录。', action: '添加账户', target: 'account' }
    : !state.posts.length
      ? { title: '准备第一条图文素材', text: '填写标题和正文，图片可以分批添加；一条素材只对应一个平台。', action: '创建图文', target: 'post' }
      : !state.jobs.length
        ? { title: '把素材加入分发队列', text: '每条任务使用一个账户。可以指定账户，也可以让系统随机选择。', action: '选择素材', target: 'posts' }
        : state.jobs.some(j => j.status === 'needs_review')
          ? { title: '有任务需要核对', text: '发布结果尚不明确。请先查看任务截图，并在抖音确认是否发布。', action: '查看任务', target: 'queue' }
          : { title: '分发流程已就绪', text: '到期任务会自动执行。你可以继续准备图文，或查看当前发布进度。', action: '查看任务', target: 'queue' };
  $('guideTitle').textContent = next.title;
  $('guideText').textContent = next.text;
  $('guideAction').textContent = next.action + ' →';
  $('guideAction').dataset.target = next.target;
  $('stepAccount').classList.toggle('done', state.accounts.length > 0);
  $('stepPost').classList.toggle('done', state.posts.length > 0);
  $('stepJob').classList.toggle('done', state.jobs.length > 0);
  $('accountCount').textContent = state.accounts.length;
  $('postCount').textContent = state.posts.length;
  $('pendingCount').textContent = state.jobs.filter(j => ['pending', 'running'].includes(j.status)).length;
  $('publishedCount').textContent = state.jobs.filter(j => j.status === 'published').length;
  $('accountList').innerHTML = state.accounts.length ? state.accounts.map(a => {
    const loginOpen = state.loginOpenIds?.includes(a.id);
    return `<article class="card account-card"><div class="card-top"><span class="platform-icon">${a.platform === 'douyin' ? '抖' : '媒'}</span><div><strong>${esc(a.name)}</strong><div class="muted">${esc(a.platform === 'douyin' ? '抖音 · 图文' : a.platform)}</div></div></div><div class="account-note">${loginOpen ? '<span class="pulse-dot"></span>登录窗口已打开，请完成登录' : '独立浏览器资料保存在本机'}</div><div class="card-actions"><button class="${loginOpen ? 'primary' : 'secondary'}" data-action="${loginOpen ? 'login-done' : 'login'}" data-id="${a.id}">${loginOpen ? '我已完成登录' : '打开 / 重新登录'}</button><button class="secondary danger" data-action="delete-account" data-id="${a.id}">移除</button></div></article>`;
  }).join('') : '<div class="empty"><strong>还没有媒体账户</strong><p>先添加一个抖音账户，再在弹出的浏览器中扫码登录。</p><button class="primary" data-action="new-account">添加账户</button></div>';
  $('postList').innerHTML = state.posts.length ? [...state.posts].reverse().map(p => {
    const jobCount = state.jobs.filter(j => j.postId === p.id).length;
    return `<article class="card post-card"><img class="post-image" src="/${esc(p.images[0])}" alt="素材封面"><div class="post-meta"><span class="post-platform">${esc(platformName(p.platform || 'douyin'))} · 图文</span><span>${p.images.length} 张图片</span></div><strong title="${esc(p.title)}">${esc(p.title)}</strong><p>${esc(p.body)}</p><div class="post-detail">♫ ${esc(p.musicTitle || '未设置配乐')}${jobCount ? ` <span>· ${jobCount} 条任务</span>` : ''}</div><div class="post-actions"><button class="primary" data-action="distribute" data-id="${p.id}">加入待分发 →</button><div><button class="secondary" data-action="edit-post" data-id="${p.id}">编辑</button><button class="secondary danger" data-action="delete-post" data-id="${p.id}" aria-label="删除素材 ${esc(p.title)}">删除</button></div></div></article>`;
  }).join('') : '<div class="empty"><strong>还没有图文素材</strong><p>一条素材可包含多张图片；创建后再设置发布账户和时间。</p><button class="primary" data-action="new-post">创建图文</button></div>';
  const labels = { pending: '待分发', running: '发布中', published: '已发布', failed: '失败', needs_review: '需核对', cancelled: '已取消' };
  const visibleJobs = [...state.jobs].reverse().filter(j => queueFilter === 'all' || (queueFilter === 'pending' && ['pending', 'running'].includes(j.status)) || (queueFilter === 'attention' && ['failed', 'needs_review'].includes(j.status)) || j.status === queueFilter);
  $('queueCount').textContent = `显示 ${visibleJobs.length} / ${state.jobs.length} 条`;
  $('jobList').innerHTML = visibleJobs.length ? visibleJobs.map(j => {
    const post = j.postSnapshot || state.posts.find(p => p.id === j.postId), account = state.accounts.find(a => a.id === j.accountId);
    const actions = [];
    if (j.status === 'pending') actions.push(`<button class="secondary" data-action="cancel" data-id="${j.id}">取消</button>`);
    if (['failed', 'cancelled'].includes(j.status)) actions.push(`<button class="secondary" data-action="retry" data-id="${j.id}">重新排队</button>`);
    if (j.status === 'needs_review') actions.push(`<button class="secondary" data-action="mark-published" data-id="${j.id}">确认已发布</button><button class="secondary" data-action="cancel" data-id="${j.id}">确认未发布</button>`);
    if (j.screenshot) actions.push(`<a class="secondary" style="padding:7px 10px;border-radius:9px;font-size:12px" href="/screenshots/${esc(j.screenshot.replace(/\\/g, '/').replace(/^screenshots\//, ''))}" target="_blank">截图</a>`);
    return `<tr><td data-label="内容">${esc(post?.title || '素材已移除')}${j.error ? `<span class="job-error">${esc(j.error)}</span>` : ''}</td><td data-label="账户">${esc(platformName(account?.platform))} / ${esc(account?.name || '—')}${j.selection === 'random' ? '<span class="muted"> · 随机选中</span>' : ''}<span class="muted" style="display:block">♫ ${esc(j.musicTitle || '未设置配乐')}</span></td><td data-label="计划时间">${date(j.scheduledAt)}</td><td data-label="状态"><span class="status ${esc(j.status)}">${labels[j.status] || esc(j.status)}</span></td><td data-label="操作"><div class="job-actions">${actions.join('')}</div></td></tr>`;
  }).join('') : `<tr><td colspan="5" class="queue-empty">${state.jobs.length ? '这个筛选条件下暂无任务。' : '还没有分发任务。先创建图文素材，再为它建立任务。'}</td></tr>`;
}
function open(id) { $(id).showModal(); }
function clearImages() {
  selectedImages.forEach(item => { if (item.file) URL.revokeObjectURL(item.url); });
  selectedImages = [];
  renderImages();
}
function renderImages() {
  $('imageCount').textContent = `已选 ${selectedImages.length} / 12 张`;
  $('chooseImagesText').textContent = selectedImages.length >= 12 ? '已达到 12 张上限' : selectedImages.length ? '继续添加图片' : '选择图片';
  $('chooseImages').disabled = selectedImages.length >= 12;
  $('clearImages').hidden = selectedImages.length === 0;
  $('imagePreview').innerHTML = selectedImages.map((item, index) => `<div class="image-tile"><img src="${item.url}" alt="第 ${index + 1} 张图片"><span>${index + 1}</span><button type="button" data-remove-image="${index}" aria-label="移除第 ${index + 1} 张图片">×</button></div>`).join('');
}
document.querySelectorAll('dialog .close, dialog .cancel').forEach(el => el.addEventListener('click', () => el.closest('dialog').close()));
function openPostEditor(post = null) {
  const form = $('postForm');
  form.reset();
  clearImages();
  editingPostId = post?.id || null;
  $('postDialogEyebrow').textContent = post ? 'EDIT CONTENT' : 'NEW CONTENT';
  $('postDialogTitle').textContent = post ? '编辑图文素材' : '创建图文素材';
  $('savePost').textContent = post ? '保存修改' : '保存素材';
  $('postEditNote').hidden = !post;
  if (post) {
    form.elements.platform.value = post.platform || 'douyin';
    form.elements.title.value = post.title;
    form.elements.body.value = post.body;
    form.elements.musicTitle.value = post.musicTitle || '';
    selectedImages = post.images.map(path => ({ path, url: '/' + path }));
    renderImages();
  }
  open('postDialog');
}
$('postDialog').addEventListener('close', () => { clearImages(); $('postForm').reset(); editingPostId = null; });
$('newAccount').onclick = () => open('accountDialog');
$('newPost').onclick = $('newPost2').onclick = () => openPostEditor();
$('guideAction').onclick = () => {
  const target = $('guideAction').dataset.target;
  if (target === 'account') open('accountDialog');
  else if (target === 'post') openPostEditor();
  else document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
document.querySelectorAll('.filter-group button').forEach(button => button.addEventListener('click', () => {
  queueFilter = button.dataset.filter;
  document.querySelectorAll('.filter-group button').forEach(el => el.classList.toggle('active', el === button));
  render();
}));
document.querySelectorAll('.sidebar nav a').forEach(link => link.addEventListener('click', () => {
  document.querySelectorAll('.sidebar nav a').forEach(el => el.classList.toggle('active', el === link));
}));
$('refresh').onclick = () => refresh().catch(e => toast(e.message));
$('runQueue').onclick = async () => { const button = $('runQueue'); button.disabled = true; try { await api('/api/queue/run', { method: 'POST' }); await refresh(); toast('已检查到期任务。'); } catch (e) { toast(e.message); } finally { button.disabled = false; } };
$('accountForm').onsubmit = async e => {
  e.preventDefault();
  try { await api('/api/accounts', json('POST', Object.fromEntries(new FormData(e.target)))); e.target.reset(); $('accountDialog').close(); await refresh(); toast('账户已添加，请打开登录窗口。'); }
  catch (error) { toast(error.message); }
};
function addImages(files) {
  const incoming = [...files];
  const available = 12 - selectedImages.length;
  if (incoming.length > available) toast(`最多 12 张，还可添加 ${available} 张。`);
  incoming.slice(0, available).forEach(file => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) return toast(`${file.name} 格式不支持或超过 20MB。`);
    selectedImages.push({ file, url: URL.createObjectURL(file) });
  });
  renderImages();
}
$('chooseImages').onclick = () => $('imageInput').click();
$('imageInput').onchange = e => { addImages(e.target.files); e.target.value = ''; };
$('chooseImages').ondragover = e => { e.preventDefault(); e.currentTarget.classList.add('dragging'); };
$('chooseImages').ondragleave = e => { e.currentTarget.classList.remove('dragging'); };
$('chooseImages').ondrop = e => { e.preventDefault(); e.currentTarget.classList.remove('dragging'); addImages(e.dataTransfer.files); };
$('clearImages').onclick = clearImages;
$('imagePreview').addEventListener('click', e => {
  const button = e.target.closest('[data-remove-image]');
  if (!button) return;
  const [item] = selectedImages.splice(Number(button.dataset.removeImage), 1);
  if (item.file) URL.revokeObjectURL(item.url);
  renderImages();
});
$('postForm').onsubmit = async e => {
  e.preventDefault(); const form = e.target; const button = form.querySelector('button.primary'); button.disabled = true;
  try {
    if (!selectedImages.length) throw new Error('请至少添加一张图片。');
    const files = selectedImages.filter(item => item.file);
    let uploaded = [];
    if (files.length) {
      const data = new FormData(); files.forEach(item => data.append('images', item.file));
      uploaded = await api('/api/uploads', { method: 'POST', body: data });
    }
    let index = 0;
    const images = selectedImages.map(item => item.path || uploaded[index++].path);
    const payload = { platform: form.elements.platform.value, title: form.elements.title.value, body: form.elements.body.value, musicTitle: form.elements.musicTitle.value, images };
    const wasEditing = Boolean(editingPostId);
    await api(wasEditing ? `/api/posts/${editingPostId}` : '/api/posts', json(wasEditing ? 'PATCH' : 'POST', payload));
    $('postDialog').close(); await refresh(); toast(wasEditing ? '图文素材已更新。' : '图文素材已保存。');
  } catch (error) { toast(error.message); } finally { button.disabled = false; }
};
$('distributeForm').onsubmit = async e => {
  e.preventDefault(); const form = e.target;
  const accountId = form.querySelector('input[name="accountId"]:checked')?.value || null;
  try {
    const local = form.elements.scheduledAt.value;
    await api('/api/jobs', json('POST', { postId: activePostId, accountId, scheduledAt: local ? new Date(local).toISOString() : null }));
    $('distributeDialog').close(); await refresh(); toast(accountId ? '已加入待分发列表。' : '已随机选择一个账户并加入队列。');
  } catch (error) { toast(error.message); }
};
document.body.addEventListener('click', async e => {
  const button = e.target.closest('[data-action]'); if (!button) return;
  const { action, id } = button.dataset;
  try {
    if (action === 'new-account') { open('accountDialog'); return; }
    if (action === 'new-post') { openPostEditor(); return; }
    if (action === 'edit-post') {
      const post = state.posts.find(p => p.id === id);
      if (!post) throw new Error('素材不存在，请刷新后重试。');
      openPostEditor(post); return;
    }
    if (action === 'distribute') {
      activePostId = id;
      const post = state.posts.find(p => p.id === id);
      const platform = post?.platform || 'douyin';
      $('selectedPost').textContent = `${platformName(platform)} · ${post?.title || ''}`;
      const accounts = state.accounts.filter(a => a.platform === platform);
      $('accountChoices').innerHTML = accounts.length ? `<label><input type="radio" name="accountId" value="" checked>随机选择一个账户</label>${accounts.map(a => `<label><input type="radio" name="accountId" value="${a.id}">${esc(a.name)} <span class="muted">· ${esc(platformName(platform))}</span></label>`).join('')}` : '<div class="empty">该平台还没有账户，请先添加账户。</div>';
      $('distributeForm').reset(); open('distributeDialog'); return;
    }
    if (action === 'delete-account' && !confirm('确定移除这个账户？本地登录资料仍保留。')) return;
    if (action === 'delete-post') {
      const post = state.posts.find(p => p.id === id);
      if (!post) throw new Error('素材不存在，请刷新后重试。');
      if (!confirm(`确定删除图文素材“${post.title}”及其未被其他素材使用的图片？此操作无法撤销。`)) return;
      button.disabled = true;
      try {
        await api(`/api/posts/${id}`, { method: 'DELETE' });
        await refresh();
        toast('图文素材已删除。');
      } finally { button.disabled = false; }
      return;
    }
    if (action === 'login') { await api(`/api/accounts/${id}/login`, { method: 'POST' }); toast('请在弹出的浏览器中登录，完成后点击“完成登录”。'); }
    if (action === 'login-done') { await api(`/api/accounts/${id}/login-done`, { method: 'POST' }); toast('登录窗口已关闭，登录资料已保存。'); }
    if (action === 'delete-account') await api(`/api/accounts/${id}`, { method: 'DELETE' });
    if (action === 'cancel' || action === 'retry' || action === 'mark-published') await api(`/api/jobs/${id}`, json('PATCH', { status: action === 'cancel' ? 'cancelled' : action === 'retry' ? 'pending' : 'published' }));
    await refresh();
  } catch (error) { toast(error.message); }
});
refresh().catch(e => toast(e.message));
setInterval(() => refresh().catch(() => {}), 5000);
