import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { DATA_DIR } from '../store.js';

const HOME = 'https://creator.douyin.com/creator-micro/content/upload';
const sessions = new Map();
export function loginOpenIds() { return [...sessions.keys()]; }
const profilePath = id => path.join(DATA_DIR, 'profiles', id);

async function contextFor(accountId) {
  await fs.mkdir(profilePath(accountId), { recursive: true });
  return chromium.launchPersistentContext(profilePath(accountId), {
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled']
  });
}
export async function openLogin(accountId) {
  if (sessions.has(accountId)) return;
  const context = await contextFor(accountId);
  sessions.set(accountId, context);
  context.on('close', () => sessions.delete(accountId));
  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(HOME, { waitUntil: 'domcontentloaded' });
  } catch (error) {
    await context.close().catch(() => {});
    sessions.delete(accountId);
    throw error;
  }
}
export async function closeLogin(accountId) {
  const context = sessions.get(accountId);
  if (context) await context.close();
  sessions.delete(accountId);
}

async function fillVisible(page, candidates, value) {
  for (const locator of candidates) {
    const el = page.locator(locator).first();
    if (await el.isVisible().catch(() => false)) { await el.fill(value); return true; }
  }
  return false;
}
async function selectMusic(page, title) {
  if (!title) return;
  await page.getByText('选择音乐', { exact: true }).last().click();
  const search = page.locator('input[placeholder="搜索音乐"]');
  await search.waitFor({ state: 'visible', timeout: 15000 });
  await search.fill(title);
  await search.press('Enter');
  const song = page.getByText(title, { exact: true }).first();
  try { await song.waitFor({ state: 'visible', timeout: 20000 }); }
  catch { throw new Error(`曲库中未找到配乐“${title}”，请修改素材中的配乐名称。`); }
  const card = song.locator('xpath=../../../../..');
  await song.hover();
  const use = card.getByText('使用', { exact: true });
  await use.click();
  await search.waitFor({ state: 'hidden', timeout: 10000 });
  await page.getByText(title, { exact: true }).first().waitFor({ state: 'visible', timeout: 10000 });
}
export async function publishDouyin({ account, post, job }) {
  if (sessions.has(account.id)) throw new Error('该账户的登录窗口尚未关闭，请先完成登录。');
  const context = await contextFor(account.id);
  const page = context.pages()[0] || await context.newPage();
  const shotDir = path.join(DATA_DIR, 'screenshots');
  await fs.mkdir(shotDir, { recursive: true });
  let clickedPublish = false;
  try {
    await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(1500);
    if (/login|passport/.test(page.url()) || await page.getByText('扫码登录').first().isVisible().catch(() => false)) {
      throw new Error('登录状态已失效。请打开账户登录窗口重新登录。');
    }
    const imageTab = page.getByText('发布图文', { exact: true }).first();
    try { await imageTab.waitFor({ state: 'visible', timeout: 25000 }); }
    catch { throw new Error('未找到“发布图文”入口，请检查登录状态或页面是否改版。'); }
    await imageTab.click();
    const fileInput = page.locator('input[type="file"][accept*="image"]').first();
    await fileInput.waitFor({ state: 'attached', timeout: 15000 });
    await fileInput.setInputFiles(post.images.map(x => path.join(DATA_DIR, x)));
    await page.locator('input[placeholder="添加作品标题"]').waitFor({ state: 'visible', timeout: 60000 });
    const titleOk = await fillVisible(page, [
      'input[placeholder="添加作品标题"]',
      'input[placeholder*="标题"]',
      'textarea[placeholder*="标题"]',
      'input[maxlength="20"]'
    ], post.title);
    const bodyOk = await fillVisible(page, [
      '[data-slate-editor="true"][contenteditable="true"]',
      'textarea[placeholder*="描述"]',
      'textarea[placeholder*="作品"]',
      '[contenteditable="true"]'
    ], post.body);
    if (!titleOk || !bodyOk) throw new Error('未找到标题或正文输入框，页面可能已改版。');
    await page.getByText(new RegExp(`已添加\\s*${post.images.length}\\s*张图片`)).first().waitFor({ state: 'visible', timeout: 60000 });
    await selectMusic(page, job.musicTitle);
    const checking = page.getByText(/检测中\s*\d*%?/).first();
    await checking.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
    if (await checking.isVisible().catch(() => false)) {
      try { await checking.waitFor({ state: 'hidden', timeout: 120000 }); }
      catch { throw new Error('抖音的快速检测仍在进行，请稍后重新排队。'); }
    }
    const preview = path.join(shotDir, `${job.id}-before.png`);
    await page.screenshot({ path: preview, fullPage: true });
    const button = page.getByRole('button', { name: '发布', exact: true }).first();
    if (!await button.isVisible().catch(() => false)) throw new Error('未找到发布按钮。');
    await button.waitFor({ state: 'visible', timeout: 30000 });
    await button.scrollIntoViewIfNeeded();
    clickedPublish = true;
    await button.click();
    const success = page.getByText(/发布成功|作品发布成功|发布完成/).first();
    try { await success.waitFor({ state: 'visible', timeout: 25000 }); }
    catch {
      const after = path.join(shotDir, `${job.id}-after.png`);
      await page.screenshot({ path: after, fullPage: true });
      return { status: 'needs_review', screenshot: path.relative(DATA_DIR, after).split(path.sep).join('/'), error: '已点击发布，但未看到明确成功提示。请在抖音核对，避免重复发布。' };
    }
    return { status: 'published', screenshot: path.relative(DATA_DIR, preview).split(path.sep).join('/'), error: null };
  } catch (error) {
    const screenshot = path.join(shotDir, `${job.id}-error.png`);
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
    return { status: clickedPublish ? 'needs_review' : 'failed', screenshot: path.relative(DATA_DIR, screenshot).split(path.sep).join('/'), error: clickedPublish ? `发布结果不确定，请到抖音核对：${error.message}` : error.message };
  } finally { await context.close(); }
}
