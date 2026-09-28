import express from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import { DATA_DIR, initStore, read, change, id, now } from './store.js';
import { openLogin, closeLogin, publishDouyin, loginOpenIds } from './publishers/douyin.js';

await initStore();
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.resolve('public')));
app.use('/screenshots', express.static(path.join(DATA_DIR, 'screenshots')));
app.use('/uploads', express.static(path.join(DATA_DIR, 'uploads')));
const uploadDir = path.join(DATA_DIR, 'uploads');
await fs.mkdir(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => cb(null, `${id()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: 12 },
  fileFilter: (_req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype))
});
const bad = (res, message, code = 400) => res.status(code).json({ error: message });
const platforms = [{ id: 'douyin', name: '抖音', supported: true, mode: '图文' }];
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
async function validatePost({ platform, title, body, musicTitle, images }, res) {
  if (!platforms.some(p => p.id === platform && p.supported)) return bad(res, '请选择已支持的媒体平台。');
  if (!title || !body || images.length < 1 || images.length > 12) return bad(res, '请输入标题、正文，并上传 1 至 12 张图片。');
  if (platform === 'douyin' && (title.length > 20 || body.length > 1000)) return bad(res, '抖音图文标题最多 20 字，正文最多 1000 字。');
  if (musicTitle.length > 100) return bad(res, '配乐名称最多 100 字。');
  if (!images.every(x => typeof x === 'string' && /^uploads\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/.test(x))) return bad(res, '图片路径无效。');
  for (const image of images) {
    try { await fs.access(path.join(DATA_DIR, image)); }
    catch { return bad(res, `图片不存在：${image}`); }
  }
  return null;
}
async function removeUnusedImages(images) {
  const snapshot = read();
  const used = new Set([
    ...snapshot.posts.flatMap(p => p.images),
    ...snapshot.jobs.flatMap(j => j.postSnapshot?.images || [])
  ]);
  await Promise.all(images.filter(image => !used.has(image)).map(image =>
    fs.unlink(path.join(DATA_DIR, image)).catch(error => {
      if (error.code !== 'ENOENT') console.error('删除素材图片失败：', error);
    })
  ));
}

app.get('/api/state', (_req, res) => res.json({ ...read(), loginOpenIds: loginOpenIds() }));
app.get('/api/platforms', (_req, res) => res.json(platforms));
app.post('/api/accounts', wrap(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const platform = String(req.body.platform || '').trim();
  if (!name || !platform) return bad(res, '请填写媒体和账户名称。');
  if (!platforms.some(p => p.id === platform && p.supported)) return bad(res, '该媒体尚未接入。');
  const account = { id: id(), platform, name, createdAt: now() };
  await change(s => s.accounts.push(account));
  res.status(201).json(account);
}));
app.delete('/api/accounts/:id', wrap(async (req, res) => {
  const s = read();
  if (s.jobs.some(j => j.accountId === req.params.id && ['pending', 'running'].includes(j.status))) return bad(res, '请先处理该账户的待分发任务。');
  await closeLogin(req.params.id);
  await change(s => { s.accounts = s.accounts.filter(a => a.id !== req.params.id); });
  res.json({ ok: true });
}));
app.post('/api/accounts/:id/login', wrap(async (req, res) => {
  const account = read().accounts.find(a => a.id === req.params.id);
  if (!account) return bad(res, '账户不存在。', 404);
  if (account.platform !== 'douyin') return bad(res, '该媒体尚未接入浏览器发布器。');
  await openLogin(account.id);
  res.json({ ok: true });
}));
app.post('/api/accounts/:id/login-done', wrap(async (req, res) => {
  await closeLogin(req.params.id);
  res.json({ ok: true });
}));
app.post('/api/uploads', upload.array('images', 12), wrap(async (req, res) => {
  if (!req.files?.length) return bad(res, '请选择 JPG、PNG 或 WebP 图片。');
  res.status(201).json(req.files.map(file => ({ path: `uploads/${file.filename}`, name: file.originalname })));
}));
app.post('/api/posts', wrap(async (req, res) => {
  const platform = String(req.body.platform || '').trim();
  const title = String(req.body.title || '').trim();
  const body = String(req.body.body || '').trim();
  const musicTitle = String(req.body.musicTitle || '').trim();
  const images = Array.isArray(req.body.images) ? req.body.images : [];
  if (await validatePost({ platform, title, body, musicTitle, images }, res)) return;
  const post = { id: id(), platform, title, body, musicTitle, images, createdAt: now() };
  await change(s => s.posts.push(post));
  res.status(201).json(post);
}));
app.patch('/api/posts/:id', wrap(async (req, res) => {
  const original = read().posts.find(p => p.id === req.params.id);
  if (!original) return bad(res, '素材不存在。', 404);
  const title = String(req.body.title || '').trim();
  const body = String(req.body.body || '').trim();
  const musicTitle = String(req.body.musicTitle || '').trim();
  const images = Array.isArray(req.body.images) ? req.body.images : [];
  if (await validatePost({ platform: original.platform, title, body, musicTitle, images }, res)) return;
  const post = await change(s => {
    const p = s.posts.find(x => x.id === req.params.id);
    Object.assign(p, { title, body, musicTitle, images, updatedAt: now() });
    return p;
  });
  await removeUnusedImages(original.images.filter(image => !images.includes(image)));
  res.json(post);
}));
app.patch('/api/posts/:id/music', wrap(async (req, res) => {
  const musicTitle = String(req.body.musicTitle || '').trim();
  if (musicTitle.length > 100) return bad(res, '配乐名称最多 100 字。');
  const snapshot = read();
  if (!snapshot.posts.some(p => p.id === req.params.id)) return bad(res, '素材不存在。', 404);
  if (snapshot.jobs.some(j => j.postId === req.params.id && j.status === 'running')) return bad(res, '发布中的素材暂不能修改配乐。');
  const post = await change(s => {
    const p = s.posts.find(x => x.id === req.params.id);
    p.musicTitle = musicTitle;
    return p;
  });
  res.json(post);
}));
app.delete('/api/posts/:id', wrap(async (req, res) => {
  const snapshot = read();
  const post = snapshot.posts.find(p => p.id === req.params.id);
  if (!post) return bad(res, '素材不存在。', 404);
  if (snapshot.jobs.some(j => j.postId === post.id)) return bad(res, '该素材已有分发任务，需保留以便查看任务和发布记录。', 409);
  await change(s => { s.posts = s.posts.filter(p => p.id !== post.id); });
  await removeUnusedImages(post.images);
  res.json({ ok: true });
}));
app.post('/api/jobs', wrap(async (req, res) => {
  const s = read();
  const post = s.posts.find(p => p.id === req.body.postId);
  if (!post) return bad(res, '素材不存在。');
  const legacyIds = Array.isArray(req.body.accountIds) ? [...new Set(req.body.accountIds)] : [];
  if (legacyIds.length > 1) return bad(res, '一条任务只能指定一个账户。');
  const accountId = req.body.accountId || legacyIds[0] || null;
  const eligible = s.accounts.filter(a => a.platform === post.platform);
  if (!eligible.length) return bad(res, '该媒体还没有账户，请先添加账户。');
  const account = accountId ? s.accounts.find(a => a.id === accountId) : eligible[randomInt(eligible.length)];
  if (!account) return bad(res, '账户不存在。');
  if (account.platform !== post.platform) return bad(res, '账户平台必须与内容平台一致。');
  if (post.platform !== 'douyin') return bad(res, '当前仅支持抖音图文发布。');
  const when = req.body.scheduledAt ? new Date(req.body.scheduledAt) : new Date();
  if (Number.isNaN(when.getTime())) return bad(res, '计划时间无效。');
  const scheduledAt = when.toISOString();
  const job = { id: id(), postId: post.id, postSnapshot: structuredClone(post), accountId: account.id, musicTitle: post.musicTitle || '', selection: accountId ? 'specified' : 'random', status: 'pending', scheduledAt, createdAt: now(), updatedAt: now(), attempts: 0, error: null, screenshot: null };
  await change(s => s.jobs.push(job));
  res.status(201).json(job);
}));
app.patch('/api/jobs/:id', wrap(async (req, res) => {
  const current = read().jobs.find(j => j.id === req.params.id);
  if (!current) return bad(res, '任务不存在。', 404);
  if (current.status === 'running') return bad(res, '运行中的任务不能修改。');
  const status = req.body.status;
  if (!['pending', 'cancelled', 'published'].includes(status)) return bad(res, '不支持该状态。');
  if (status === 'pending' && current.status === 'needs_review') return bad(res, '请先在抖音确认是否发布；确认未发布后可从失败任务重新排队。');
  const job = await change(s => {
    const j = s.jobs.find(x => x.id === req.params.id);
    j.status = status; j.updatedAt = now();
    if (status === 'pending') { j.error = null; j.screenshot = null; }
    return j;
  });
  res.json(job);
}));

const activeAccounts = new Set();
async function runQueue() {
  const s = read();
  for (const queued of s.jobs.filter(j => j.status === 'pending' && j.scheduledAt <= now())) {
    if (activeAccounts.has(queued.accountId)) continue;
    const account = s.accounts.find(a => a.id === queued.accountId);
    const post = queued.postSnapshot || s.posts.find(p => p.id === queued.postId);
    if (!account || !post) continue;
    activeAccounts.add(account.id);
    await change(db => {
      const j = db.jobs.find(x => x.id === queued.id);
      j.status = 'running'; j.attempts += 1; j.updatedAt = now();
    });
    publishDouyin({ account, post, job: queued }).then(async result => {
      await change(db => Object.assign(db.jobs.find(j => j.id === queued.id), result, { updatedAt: now() }));
    }).catch(async error => {
      await change(db => Object.assign(db.jobs.find(j => j.id === queued.id), { status: 'needs_review', error: error.message, updatedAt: now() }));
    }).finally(() => activeAccounts.delete(account.id));
  }
}
app.post('/api/queue/run', wrap(async (_req, res) => { await runQueue(); res.json({ ok: true }); }));
app.use((error, _req, res, _next) => res.status(400).json({ error: error.message || '请求失败。' }));
setInterval(() => runQueue().catch(console.error), 5000).unref();
const port = Number(process.env.PORT || 4173);
app.listen(port, '127.0.0.1', () => console.log(`媒体分发台：http://127.0.0.1:${port}`));
