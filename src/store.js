import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
const DB_FILE = path.join(DATA_DIR, 'store.json');
const initial = { accounts: [], posts: [], jobs: [] };
let state;
let writing = Promise.resolve();

export function id() { return crypto.randomUUID(); }
export function now() { return new Date().toISOString(); }
export async function initStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try { state = { ...initial, ...JSON.parse(await fs.readFile(DB_FILE, 'utf8')) }; }
  catch (error) { if (error.code !== 'ENOENT') throw error; state = structuredClone(initial); await save(); }
  for (const post of state.posts) post.platform ||= 'douyin';
  for (const job of state.jobs) {
    if (!job.postSnapshot) {
      const post = state.posts.find(p => p.id === job.postId);
      if (post) job.postSnapshot = structuredClone(post);
    }
    if (job.status === 'running') {
      job.status = 'needs_review';
      job.error = '服务运行中断，发布结果不确定；请到抖音核对后再处理。';
      job.updatedAt = now();
    }
  }
  await save();
}
export function read() { return structuredClone(state); }
export async function change(fn) {
  const result = fn(state);
  await save();
  return structuredClone(result);
}
function save() {
  writing = writing.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = DB_FILE + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
    await fs.rename(tmp, DB_FILE);
  });
  return writing;
}
