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
  const wasOpen = await page.getByTestId('close-panel').count();
  await details(page);
  await page.waitForFunction(
    ({ id, count }) =>
      document.querySelector(`[data-testid="${id}"]`)?.textContent === String(count),
    { id, count },
  );
  if (!wasOpen) await closePanel(page);
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
  await closePanel(page);
  await page.getByTestId('toggle-failures').click();
  await page.getByTestId(`scenario-${name}`).click();
  await page.getByTestId('close-panel').waitFor({ state: 'hidden' });
}
async function details(page) {
  if (!(await page.getByTestId('switch-account').count()))
    await page
      .getByTestId(
        (await page.getByTestId('toggle-details').count()) ? 'toggle-details' : 'toggle-failures',
      )
      .click();
}
async function closePanel(page) {
  if (await page.getByTestId('close-panel').count()) await page.getByTestId('close-panel').click();
  await page.getByTestId('close-panel').waitFor({ state: 'hidden' });
}
async function save(page) {
  await page
    .getByTestId(
      (await page.getByTestId('close-panel').count()) ? 'details-save-photo' : 'save-photo',
    )
    .click();
}
async function receipt(page, id) {
  await details(page);
  const value = await page.getByTestId(id).innerText();
  await closePanel(page);
  return value;
}
async function switchAccount(page) {
  await details(page);
  await page.getByTestId('switch-account').click();
}
async function verify(page) {
  await details(page);
  await save(page);
  await status(page, 'Saved');
  await closePanel(page);
}
async function capture(page) {
  await closePanel(page);
  const previous = (await page.getByTestId('active-photo').count())
    ? await activeId(page)
    : undefined;
  if (!(await page.getByTestId('sample-photo').count()))
    await page.getByTestId('new-photo').click();
  await page.getByTestId('sample-photo').click();
  await page.getByTestId('close-panel').waitFor({ state: 'hidden' });
  await page.waitForFunction((previous) => {
    const id = document.querySelector('[data-testid="active-photo"]')?.id;
    return !!id && id !== previous;
  }, previous);
  await status(page, 'Ready to save');
  await page.getByLabel('Photo thumbnail').first().waitFor();
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
  await status(page, 'Saved');
  await number(page, 'object-count', 1);
  await number(page, 'row-count', 1);
  assert.equal(await activeId(page), id);
  await verify(page);
  await details(page);
  await page.getByRole('button', { name: 'Verify again', exact: true }).waitFor();
  await closePanel(page);
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
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        recordVideo: { dir: 'output/playwright', size: { width: 390, height: 844 } },
      }),
      page = await opened(context),
      video = page.video();
    await pause(1200);
    await page.getByTestId('start-demo').click();
    await status(page, 'Ready to save');
    const id = await activeId(page);
    await pause(1500);
    await page.getByTestId('save-photo').click();
    await status(page, 'Save unconfirmed');
    await page.screenshot({ path: 'docs/demo-poster.png', fullPage: true });
    await pause(1600);
    await details(page);
    await number(page, 'object-count', 1);
    await number(page, 'row-count', 0);
    assert.equal(await page.getByTestId('capture-id').innerText(), id);
    await pause(1700);
    await closePanel(page);
    await page.reload();
    await status(page, 'Save unconfirmed');
    assert.equal(await activeId(page), id);
    await pause(1200);
    await page.getByTestId('save-photo').click();
    await status(page, 'Saved');
    assert.equal(await activeId(page), id);
    await pause(1800);
    await details(page);
    await number(page, 'object-count', 1);
    await number(page, 'row-count', 1);
    assert.equal(await page.getByTestId('capture-id').innerText(), id);
    await pause(1700);
    await closePanel(page);
    await pause(1500);
    await context.close();
    await ffmpeg([
      '-i',
      await video.path(),
      '-an',
      '-c:v',
      'libx264',
      '-vf',
      'scale=780:1688:flags=lanczos',
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
      'fps=6,scale=390:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse',
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
    await status(page, 'Saved');
    await switchAccount(page);
    await page.getByTestId('no-capture').waitFor();
    await details(page);
    await number(page, 'object-count', 0);
    await switchAccount(page);
    await status(page, 'Saved');
    await choose(page, 'offline');
    await details(page);
    await save(page);
    await status(page, 'Verification unconfirmed');
    await closePanel(page);
    await save(page);
    await status(page, 'Saved');
    await choose(page, 'offline');
    await details(page);
    await page.getByTestId('details-remove-photo').click();
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
      await receipt(multiple, 'receipt-image'),
      /Not sent/,
      'An older cloud object must not mark this new capture verified',
    );
    assert.match(await receipt(multiple, 'receipt-record'), /Not saved/);
    await multiple.getByTestId(`capture-${first}`).click();
    await status(multiple, 'Save unconfirmed');
    assert.equal(await activeId(multiple), first);
    await save(multiple);
    await status(multiple, 'Saved');
    await closePanel(multiple);
    await multiple.reload();
    await status(multiple, 'Ready to save');
    await multiple.getByTestId(`capture-${first}`).click();
    await status(multiple, 'Saved');
    await more.close();
    results.push('Older pending captures stay accessible after adding a photo and reloading');
    const quick = await browser.newContext({ viewport: { width: 390, height: 844 } }),
      quickPage = await opened(quick);
    await quickPage.getByTestId('start-demo').click();
    await status(quickPage, 'Ready to save');
    const quickId = await activeId(quickPage);
    await quickPage.getByTestId('save-photo').click();
    await status(quickPage, 'Save unconfirmed');
    await number(quickPage, 'object-count', 1);
    await number(quickPage, 'row-count', 0);
    assert.match(await receipt(quickPage, 'receipt-device'), /Kept/);
    assert.match(
      await receipt(quickPage, 'receipt-image'),
      /Unconfirmed/,
      'A lost acknowledgement must not be shown as a verified image',
    );
    assert.match(await receipt(quickPage, 'receipt-record'), /Unconfirmed/);
    await quickPage.screenshot({
      path: 'output/playwright/recovery-interrupted-390.png',
      fullPage: true,
    });
    await quickPage.reload();
    await status(quickPage, 'Save unconfirmed');
    assert.equal(await activeId(quickPage), quickId);
    assert.match(await receipt(quickPage, 'receipt-image'), /Unconfirmed/);
    await quickPage.getByTestId('save-photo').click();
    await status(quickPage, 'Saved');
    await number(quickPage, 'object-count', 1);
    await number(quickPage, 'row-count', 1);
    assert.equal(await activeId(quickPage), quickId);
    assert.match(await receipt(quickPage, 'receipt-image'), /Verified/);
    assert.match(await receipt(quickPage, 'receipt-record'), /Verified/);
    assert.equal(
      await quickPage.getByRole('button', { name: 'Add photo', exact: true }).count(),
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
    await missingPage
      .getByText('Local original unavailable. Check Details.', { exact: true })
      .waitFor();
    assert.match(
      await receipt(missingPage, 'receipt-device'),
      /Unavailable/,
      'The receipt must not claim a missing local file is kept',
    );
    await missingPage.getByTestId('save-photo').click();
    await status(missingPage, 'Save unconfirmed');
    await missingPage
      .getByText('Local original unavailable. Check Details.', { exact: true })
      .waitFor();
    await number(missingPage, 'object-count', 0);
    await number(missingPage, 'row-count', 0);
    await missingPage.screenshot({
      path: 'output/playwright/missing-original-320.png',
      fullPage: true,
    });
    await missing.close();
    results.push('Missing local JPEG is shown as unavailable and never confirmed or uploaded');
    const partial = await browser.newContext({ viewport: { width: 390, height: 844 } }),
      partialPage = await opened(partial);
    await choose(partialPage, 'upload-response-lost');
    const partialId = await capture(partialPage);
    await save(partialPage);
    await status(partialPage, 'Save unconfirmed');
    await number(partialPage, 'object-count', 1);
    await number(partialPage, 'row-count', 0);
    await partialPage.evaluate(
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
      partialId,
    );
    await partialPage.reload();
    await partialPage
      .getByText('Local original unavailable. Check Details.', { exact: true })
      .waitFor();
    await details(partialPage);
    assert.match(await partialPage.getByTestId('receipt-device').innerText(), /Unavailable/);
    assert.equal(
      await partialPage.getByText(/Your original photo is still on this device/).count(),
      0,
      'A historical error must not claim an evicted original is still kept',
    );
    await partialPage.screenshot({ path: 'output/design-qa/missing-after-upload.png' });
    await save(partialPage);
    await status(partialPage, 'Saved');
    assert.equal(await activeId(partialPage), partialId);
    assert.match(await partialPage.getByTestId('receipt-device').innerText(), /Unavailable/);
    assert.match(await partialPage.getByTestId('receipt-image').innerText(), /Verified/);
    await number(partialPage, 'object-count', 1);
    await number(partialPage, 'row-count', 1);
    await partial.close();
    results.push(
      'An evicted original is reported honestly, while its already-uploaded image finishes without duplication',
    );
    // Hold the next real ImageLoader request, rather than adding a fake busy state or
    // a delay to the app. Releasing it continues the existing verification operation.
    const visual = await browser.newContext({ viewport: { width: 390, height: 844 } }),
      visualPage = await opened(visual);
    await mkdir('output/design-qa', { recursive: true });
    await visualPage.screenshot({ path: 'output/design-qa/empty-final.png' });
    await capture(visualPage);
    await save(visualPage);
    await status(visualPage, 'Saved');
    await capture(visualPage);
    const last = await capture(visualPage);
    await choose(visualPage, 'upload-response-lost');
    await save(visualPage);
    await status(visualPage, 'Save unconfirmed');
    await visualPage.screenshot({ path: 'output/design-qa/pending-final.png' });
    await visualPage.evaluate(() => {
      const BrowserImage = window.Image;
      window.Image = class extends BrowserImage {
        get src() {
          return super.src;
        }
        set src(uri) {
          if (window.__qaHoldNextImage && uri.startsWith('blob:')) {
            window.__qaHoldNextImage = false;
            window.__qaReleaseImage = () => {
              super.src = uri;
            };
          } else super.src = uri;
        }
      };
      window.__qaHoldNextImage = true;
    });
    await save(visualPage);
    await status(visualPage, 'Checking cloud…');
    await visualPage.waitForFunction(() => typeof window.__qaReleaseImage === 'function');
    assert.equal(await visualPage.getByTestId('new-photo').isEnabled(), false);
    assert.equal(await visualPage.getByTestId('toggle-failures').isEnabled(), false);
    assert.equal(await visualPage.getByTestId('save-photo').isEnabled(), false);
    await visualPage.screenshot({ path: 'output/design-qa/retrying-final.png' });
    await details(visualPage);
    assert.equal(await visualPage.getByTestId('details-save-photo').isEnabled(), false);
    assert.equal(await visualPage.getByTestId('details-remove-photo').isEnabled(), false);
    assert.equal(await visualPage.getByTestId('capture-id').innerText(), last);
    await closePanel(visualPage);
    await visualPage.evaluate(() => window.__qaReleaseImage());
    await status(visualPage, 'Saved');
    assert.equal(await activeId(visualPage), last);
    await number(visualPage, 'object-count', 2);
    await number(visualPage, 'row-count', 2);
    await visualPage.screenshot({ path: 'output/design-qa/saved-final.png' });
    await visual.close();
    results.push(
      'A held real verification disables mutations, keeps Details readable, and finishes the same capture',
    );
    const keyboard = await browser.newContext({ viewport: { width: 320, height: 740 } }),
      keyboardPage = await opened(keyboard);
    await keyboardPage.getByTestId('new-photo').focus();
    await keyboardPage.keyboard.press('Enter');
    await keyboardPage.getByTestId('close-panel').waitFor();
    assert.equal(
      await keyboardPage.getByRole('button', { name: 'Add photo', exact: true }).count(),
      0,
      'The sheet hides the outbox from assistive technology',
    );
    await keyboardPage.getByTestId('sample-photo').focus();
    assert.equal(
      await keyboardPage
        .getByTestId('sample-photo')
        .evaluate((el) => getComputedStyle(el).borderTopColor),
      'rgb(0, 107, 230)',
    );
    await keyboardPage.keyboard.press('Enter');
    await status(keyboardPage, 'Ready to save');
    await keyboardPage.getByTestId('toggle-failures').focus();
    await keyboardPage.keyboard.press('Enter');
    assert.equal(
      await keyboardPage.getByTestId('scenario-normal').getAttribute('aria-checked'),
      'true',
    );
    await keyboardPage.getByTestId('scenario-upload-response-lost').focus();
    await keyboardPage.keyboard.press('Enter');
    await keyboardPage.getByTestId('close-panel').waitFor({ state: 'hidden' });
    await keyboardPage.getByTestId('save-photo').focus();
    await keyboardPage.keyboard.press('Enter');
    await status(keyboardPage, 'Save unconfirmed');
    await keyboardPage.getByTestId('save-photo').focus();
    await keyboardPage.keyboard.press('Enter');
    await status(keyboardPage, 'Saved');
    assert.equal(
      await keyboardPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await keyboard.close();
    results.push(
      'Keyboard source selection, failure selection, retry, visible focus, and accessible sheet isolation at 320px',
    );
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
