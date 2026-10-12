import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const record = process.argv.includes('--record');
await mkdir('output/playwright', { recursive: true });
await mkdir('docs', { recursive: true });
const server = spawn(process.execPath, ['scripts/serve.mjs'], {
  env: { ...process.env, PORT: '0' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
const url = await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.once('exit', (code) => reject(new Error(`Server exited ${code}`)));
  server.stdout.once('data', (data) => resolve(data.toString().trim()));
});
let browser;
const results = [],
  errors = [];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function status(page, text) {
  await page.waitForFunction(
    (expected) => document.querySelector('[data-testid="photo-status"]')?.textContent === expected,
    text,
  );
}
async function number(page, id, count) {
  await page.waitForFunction(
    ({ id, count }) =>
      document.querySelector(`[data-testid="${id}"]`)?.textContent === String(count),
    { id, count },
  );
}
const activeId = (page) => page.getByTestId('active-photo').getAttribute('id');
async function opened(context) {
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await page.getByTestId('toggle-failures').waitFor();
  return page;
}
async function choose(page, name) {
  await page.getByTestId('toggle-failures').click();
  await page.getByTestId(`scenario-${name}`).click();
}
async function details(page) {
  if (!(await page.getByTestId('switch-account').count()))
    await page.getByTestId('toggle-details').click();
}
async function switchAccount(page) {
  await details(page);
  await page.getByTestId('switch-account').click();
}
async function verify(page) {
  await details(page);
  await page.getByTestId('save-photo').click();
}
async function capture(page) {
  if (!(await page.getByTestId('sample-photo').count()))
    await page.getByTestId('new-photo').click();
  await page.getByTestId('sample-photo').click();
  await status(page, 'Local only');
  assert.equal(await page.getByLabel('Photo preview').count(), 1);
  await page.waitForFunction(() => {
    const image = document.querySelector('img');
    return image?.complete && image.naturalWidth > 0;
  });
  const id = await activeId(page);
  assert.match(id, /^[a-f0-9-]{36}$/);
  return id;
}
async function scenario(name, viewport) {
  const context = await browser.newContext({ viewport }),
    page = await opened(context);
  assert.equal(
    await page.getByTestId('scenario-offline').count(),
    0,
    'Failure controls start collapsed',
  );
  assert.equal(await page.getByTestId('switch-account').count(), 0, 'Diagnostics start collapsed');
  await choose(page, name);
  const id = await capture(page);
  await page.getByTestId('save-photo').click();
  if (name !== 'normal') {
    await status(page, 'Save unconfirmed');
    await number(page, 'object-count', name === 'offline' || name === 'upload-rejected' ? 0 : 1);
    await number(page, 'row-count', name === 'row-response-lost' ? 1 : 0);
    await page.reload();
    await status(page, 'Save unconfirmed');
    assert.equal(await activeId(page), id);
    await page.getByTestId('save-photo').click();
  }
  await status(page, 'Cloud confirmed');
  await number(page, 'object-count', 1);
  await number(page, 'row-count', 1);
  assert.equal(await activeId(page), id);
  await verify(page);
  await page.getByRole('button', { name: 'Verify again', exact: true }).waitFor();
  await number(page, 'object-count', 1);
  await number(page, 'row-count', 1);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    'No horizontal overflow',
  );
  await page.screenshot({
    path: `output/playwright/${name}-${viewport.width}.png`,
    fullPage: true,
  });
  await context.close();
  results.push(
    `${name} at ${viewport.width}px: reload and one-action retry keep one image and one record`,
  );
}
function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-y', ...args], { stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)),
    );
  });
}
try {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
  if (record) {
    const context = await browser.newContext({
        viewport: { width: 720, height: 960 },
        recordVideo: { dir: 'output/playwright', size: { width: 720, height: 960 } },
      }),
      page = await opened(context),
      video = page.video();
    await pause(1600);
    await page.getByTestId('start-demo').click();
    await status(page, 'Local only');
    const id = await activeId(page);
    await pause(1800);
    await page.getByTestId('save-photo').click();
    await status(page, 'Save unconfirmed');
    await number(page, 'object-count', 1);
    await number(page, 'row-count', 0);
    await page.screenshot({ path: 'docs/demo-poster.png', fullPage: true });
    await pause(4000);
    await page.reload();
    await status(page, 'Save unconfirmed');
    assert.equal(await activeId(page), id);
    await pause(1600);
    await page.getByTestId('save-photo').click();
    await status(page, 'Cloud confirmed');
    await number(page, 'object-count', 1);
    await number(page, 'row-count', 1);
    assert.equal(await activeId(page), id);
    await pause(4000);
    await context.close();
    await ffmpeg([
      '-i',
      await video.path(),
      '-an',
      '-c:v',
      'libx264',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      'docs/demo.mp4',
    ]);
    await ffmpeg([
      '-i',
      'docs/demo.mp4',
      '-vf',
      'fps=6,scale=540:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse',
      '-loop',
      '0',
      'docs/demo.gif',
    ]);
    assert.deepEqual(errors, []);
    console.log('Recorded docs/demo.mp4, demo.gif, and demo-poster.png from the recovery flow.');
  } else {
    for (const name of [
      'normal',
      'upload-rejected',
      'upload-response-lost',
      'row-rejected',
      'row-response-lost',
      'offline',
    ])
      await scenario(name, { width: 1280, height: 1080 });
    await scenario('upload-response-lost', { width: 390, height: 844 });
    await scenario('upload-response-lost', { width: 320, height: 740 });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } }),
      page = await opened(context);
    await capture(page);
    await page.getByTestId('save-photo').click();
    await status(page, 'Cloud confirmed');
    await switchAccount(page);
    await page.getByTestId('no-capture').waitFor();
    await details(page);
    await number(page, 'object-count', 0);
    await switchAccount(page);
    await status(page, 'Cloud confirmed');
    await choose(page, 'offline');
    await verify(page);
    await status(page, 'Verification unconfirmed');
    await page.getByTestId('save-photo').click();
    await status(page, 'Cloud confirmed');
    await choose(page, 'offline');
    await details(page);
    await page.getByTestId('remove-photo').click();
    await status(page, 'Removed locally');
    await page.reload();
    await status(page, 'Removed locally');
    await page.getByTestId('remove-photo').click();
    await status(page, 'Removal confirmed');
    assert.equal(await page.getByTestId('save-photo').count(), 0);
    assert.equal(await page.getByLabel('Photo preview').count(), 0);
    await page.reload();
    await status(page, 'Removal confirmed');
    await context.close();
    results.push(
      'Account switching, failed verification, and offline removal survive real reloads',
    );
    const more = await browser.newContext({ viewport: { width: 390, height: 844 } }),
      multiple = await opened(more);
    await choose(multiple, 'row-rejected');
    const first = await capture(multiple);
    await multiple.getByTestId('save-photo').click();
    await status(multiple, 'Save unconfirmed');
    await choose(multiple, 'normal');
    const second = await capture(multiple);
    assert.notEqual(first, second);
    assert.match(
      await multiple.getByTestId('receipt-image').innerText(),
      /Not sent/,
      'An older cloud object must not mark this new capture verified',
    );
    assert.match(await multiple.getByTestId('receipt-record').innerText(), /Not saved/);
    await multiple.getByTestId('toggle-photos').click();
    await multiple.getByTestId(`capture-${first}`).click();
    await status(multiple, 'Save unconfirmed');
    assert.equal(await activeId(multiple), first);
    await multiple.getByTestId('save-photo').click();
    await status(multiple, 'Cloud confirmed');
    await multiple.reload();
    await status(multiple, 'Local only');
    await multiple.getByTestId('toggle-photos').click();
    await multiple.getByTestId(`capture-${first}`).click();
    await status(multiple, 'Cloud confirmed');
    await more.close();
    results.push('Older pending captures stay accessible after adding a photo and reloading');
    const quick = await browser.newContext({ viewport: { width: 390, height: 844 } }),
      quickPage = await opened(quick);
    await quickPage.getByTestId('start-demo').click();
    await status(quickPage, 'Local only');
    const quickId = await activeId(quickPage);
    await quickPage.getByTestId('save-photo').click();
    await status(quickPage, 'Save unconfirmed');
    await number(quickPage, 'object-count', 1);
    await number(quickPage, 'row-count', 0);
    assert.match(await quickPage.getByTestId('receipt-device').innerText(), /Kept/);
    assert.match(
      await quickPage.getByTestId('receipt-image').innerText(),
      /Unconfirmed/,
      'A lost acknowledgement must not be shown as a verified image',
    );
    assert.match(await quickPage.getByTestId('receipt-record').innerText(), /Unconfirmed/);
    await quickPage.screenshot({
      path: 'output/playwright/recovery-interrupted-390.png',
      fullPage: true,
    });
    await quickPage.reload();
    await status(quickPage, 'Save unconfirmed');
    assert.equal(await activeId(quickPage), quickId);
    assert.match(await quickPage.getByTestId('receipt-image').innerText(), /Unconfirmed/);
    await quickPage.getByTestId('save-photo').click();
    await status(quickPage, 'Cloud confirmed');
    await number(quickPage, 'object-count', 1);
    await number(quickPage, 'row-count', 1);
    assert.equal(await activeId(quickPage), quickId);
    assert.match(await quickPage.getByTestId('receipt-image').innerText(), /Verified/);
    assert.match(await quickPage.getByTestId('receipt-record').innerText(), /Verified/);
    assert.equal(
      await quickPage.getByRole('button', { name: 'Add another photo', exact: true }).count(),
      1,
    );
    assert.equal(
      await quickPage.getByRole('button', { name: 'Verify again', exact: true }).count(),
      0,
    );
    await quickPage.screenshot({
      path: 'output/playwright/recovery-confirmed-390.png',
      fullPage: true,
    });
    await quick.close();
    results.push('Visible recovery demo, honest receipt states, reload, and completion action');
    const missing = await browser.newContext({ viewport: { width: 320, height: 740 } }),
      missingPage = await opened(missing);
    const missingId = await capture(missingPage);
    // Remove only this synthetic test capture to exercise actual IndexedDB loss.
    await missingPage.evaluate(
      (id) =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open('photo-recovery-files', 1);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result,
              tx = db.transaction('files', 'readwrite');
            tx.objectStore('files').delete(`local-photo://capture-${id}`);
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onabort = () => {
              db.close();
              reject(tx.error);
            };
          };
        }),
      missingId,
    );
    await missingPage.reload();
    await missingPage.getByText('Preview unavailable', { exact: true }).waitFor();
    await missingPage
      .getByRole('heading', { name: 'Local photo unavailable.', exact: true })
      .waitFor();
    assert.match(
      await missingPage.getByTestId('receipt-device').innerText(),
      /Unavailable/,
      'The receipt must not claim a missing local file is kept',
    );
    await missingPage.getByTestId('save-photo').click();
    await status(missingPage, 'Save unconfirmed');
    await missingPage
      .getByRole('heading', { name: 'Original unavailable.', exact: true })
      .waitFor();
    await number(missingPage, 'object-count', 0);
    await number(missingPage, 'row-count', 0);
    await missingPage.screenshot({
      path: 'output/playwright/missing-original-320.png',
      fullPage: true,
    });
    await missing.close();
    results.push('Missing local JPEG is shown as unavailable and never confirmed or uploaded');
    assert.deepEqual(errors, [], 'No uncaught browser exceptions');
    await writeFile(
      'output/playwright/web-results.json',
      JSON.stringify({ results, errors }, null, 2),
    );
    results.forEach((result) => console.log(`PASS ${result}`));
    console.log(`${results.length}/${results.length} browser scenarios passed.`);
  }
} finally {
  await browser?.close();
  server.kill();
}
