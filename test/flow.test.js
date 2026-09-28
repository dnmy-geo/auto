import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('账户、素材和待分发任务可完成本地流程', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'media-distribution-'));
  const port = 43000 + Math.floor(Math.random() * 1000);
  const server = spawn(process.execPath, ['src/server.js'], {
    cwd: path.resolve('.'), env: { ...process.env, DATA_DIR: dataDir, PORT: String(port) }, stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}`;
  const request = async (url, options) => {
    const response = await fetch(base + url, options);
    const body = await response.json();
    assert.ok(response.ok, JSON.stringify(body));
    return body;
  };
  const json = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try { await fetch(base + '/api/state'); ready = true; break; } catch { await new Promise(r => setTimeout(r, 100)); }
    }
    assert.ok(ready, '本地服务未启动');
    const account = await request('/api/accounts', json({ platform: 'douyin', name: '测试账户' }));
    const otherAccount = await request('/api/accounts', json({ platform: 'douyin', name: '第二账户' }));
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=', 'base64');
    const form = new FormData();
    form.append('images', new Blob([png], { type: 'image/png' }), 'sample.png');
    form.append('images', new Blob([png], { type: 'image/png' }), 'second.png');
    const images = await request('/api/uploads', { method: 'POST', body: form });
    assert.equal(images.length, 2);
    const post = await request('/api/posts', json({ platform: 'douyin', title: '测试标题', body: '测试正文', musicTitle: '测试曲名', images: images.map(image => image.path) }));
    assert.equal(post.images.length, 2);
    assert.equal(post.musicTitle, '测试曲名');
    const updatedPost = await request(`/api/posts/${post.id}/music`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ musicTitle: '更新后的曲名' }) });
    assert.equal(updatedPost.musicTitle, '更新后的曲名');
    const job = await request('/api/jobs', json({ postId: post.id, accountId: account.id, scheduledAt: '2099-01-01T00:00:00.000Z' }));
    assert.equal(job.status, 'pending');
    assert.equal(job.selection, 'specified');
    assert.equal(job.musicTitle, '更新后的曲名');
    const randomJob = await request('/api/jobs', json({ postId: post.id, scheduledAt: '2099-01-01T00:00:00.000Z' }));
    assert.equal(randomJob.selection, 'random');
    assert.ok([account.id, otherAccount.id].includes(randomJob.accountId));
    const editedPost = await request(`/api/posts/${post.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '修改后的标题', body: '修改后的正文', musicTitle: '新配乐', images: [images[1].path] }) });
    assert.equal(editedPost.title, '修改后的标题');
    assert.deepEqual(editedPost.images, [images[1].path]);
    assert.equal(job.postSnapshot.title, '测试标题');
    assert.equal(job.postSnapshot.images.length, 2);
    assert.equal((await fetch(base + '/' + images[0].path)).status, 200);
    const multiple = await fetch(base + '/api/jobs', json({ postId: post.id, accountIds: [account.id, otherAccount.id] }));
    assert.equal(multiple.status, 400);
    const linkedDelete = await fetch(base + `/api/posts/${post.id}`, { method: 'DELETE' });
    assert.equal(linkedDelete.status, 409);
    const sharedPost = await request('/api/posts', json({ platform: 'douyin', title: '共用图片', body: '测试正文', images: [images[0].path] }));
    await request(`/api/posts/${sharedPost.id}`, { method: 'DELETE' });
    assert.equal((await fetch(base + '/' + images[0].path)).status, 200);
    const disposableForm = new FormData();
    disposableForm.append('images', new Blob([png], { type: 'image/png' }), 'disposable.png');
    const [disposableImage] = await request('/api/uploads', { method: 'POST', body: disposableForm });
    const disposablePost = await request('/api/posts', json({ platform: 'douyin', title: '可删除素材', body: '测试正文', images: [disposableImage.path] }));
    const replacementForm = new FormData();
    replacementForm.append('images', new Blob([png], { type: 'image/png' }), 'replacement.png');
    const [replacementImage] = await request('/api/uploads', { method: 'POST', body: replacementForm });
    await request(`/api/posts/${disposablePost.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '已换图', body: '测试正文', musicTitle: '', images: [replacementImage.path] }) });
    assert.equal((await fetch(base + '/' + disposableImage.path)).status, 404);
    await request(`/api/posts/${disposablePost.id}`, { method: 'DELETE' });
    assert.equal((await fetch(base + '/' + replacementImage.path)).status, 404);
    const state = await request('/api/state');
    assert.equal(state.accounts.length, 2);
    assert.equal(state.posts.length, 1);
    assert.equal(state.jobs.length, 2);
    const cancelled = await request(`/api/jobs/${job.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }) });
    assert.equal(cancelled.status, 'cancelled');
  } finally {
    server.kill();
    await new Promise(resolve => server.once('exit', resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});
