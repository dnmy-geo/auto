import fs from 'node:fs/promises';
import path from 'node:path';

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error('用法：node scripts/import-post.mjs 图文内容.json');
  process.exit(1);
}

const fullPath = path.resolve(manifestPath);
const manifest = JSON.parse(await fs.readFile(fullPath, 'utf8'));
if (!Array.isArray(manifest.sourceImages) || !manifest.sourceImages.length) {
  throw new Error('sourceImages 需要至少一张图片。');
}
const base = process.env.DISTRIBUTOR_URL || 'http://127.0.0.1:4173';
const form = new FormData();
const types = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
for (const name of manifest.sourceImages) {
  const fullImagePath = path.resolve(path.dirname(fullPath), name);
  const type = types[path.extname(fullImagePath).toLowerCase()];
  if (!type) throw new Error(`不支持的图片格式：${name}`);
  form.append('images', new Blob([await fs.readFile(fullImagePath)], { type }), path.basename(fullImagePath));
}
const uploadResponse = await fetch(`${base}/api/uploads`, { method: 'POST', body: form });
const uploaded = await uploadResponse.json();
if (!uploadResponse.ok) throw new Error(uploaded.error || '图片上传失败。');

const postResponse = await fetch(`${base}/api/posts`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    platform: manifest.platform,
    title: manifest.title,
    body: manifest.body,
    musicTitle: manifest.musicTitle || '',
    images: uploaded.map(image => image.path)
  })
});
const post = await postResponse.json();
if (!postResponse.ok) throw new Error(post.error || '素材保存失败。');
console.log(JSON.stringify({ id: post.id, title: post.title, imageCount: post.images.length }, null, 2));
