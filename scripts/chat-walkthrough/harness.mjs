// Design walkthrough harness (not a test). Opens the live Trailhead product page with the LOCAL theme chat swapped in:
// local theme.liquid widget markup, local critical.css, local chat-demo.js,
// endpoint pointed at this repo's server on :3217.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
export const STORE = 'https://b8wzw0-h3.myshopify.com';
export const ENDPOINT = `http://localhost:${process.env.WALKTHROUGH_PORT || 3217}`;

function localWidget() {
  const liquid = readFileSync(`${REPO}/apps/storefront/layout/theme.liquid`, 'utf8');
  const start = liquid.indexOf('<div\n      class="ai-chat"');
  const end = liquid.indexOf('<script type="application/json" data-ai-chat-products>');
  return liquid.slice(start, end)
    .replace('{{ settings.ai_chat_endpoint | escape }}', ENDPOINT)
    .replace("{{ settings.ai_chat_label | default: 'AI chat' }}", 'AI chat');
}

export async function open({ width, height, mobile = false, shopper, path = '/products/trail-runner-2' }) {
  const browser = await chromium.launch({ args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests'] });
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    isMobile: mobile,
    hasTouch: mobile,
  });
  const page = await context.newPage();
  const widget = localWidget();
  await page.route(`${STORE}/**`, async (route) => {
    const req = route.request();
    if (req.resourceType() !== 'document') return route.fallback();
    const res = await route.fetch();
    let html = await res.text();
    const s = html.indexOf('data-ai-chat-endpoint');
    const divStart = html.lastIndexOf('<div', s);
    const e = html.indexOf('<script type="application/json" data-ai-chat-products>');
    if (s > -1 && e > -1) html = html.slice(0, divStart) + widget + html.slice(e);
    await route.fulfill({ response: res, body: html });
  });
  await page.route('**/assets/chat-demo.js*', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: readFileSync(`${REPO}/apps/storefront/assets/chat-demo.js`) }));
  await page.route('**/assets/critical.css*', (route) =>
    route.fulfill({ contentType: 'text/css', body: readFileSync(`${REPO}/apps/storefront/assets/critical.css`) }));
  // The theme's fonts are relative urls beside critical.css; until the theme is pushed the live store does not have them.
  await page.route(/\/assets\/(satoshi-variable\.woff2|fredoka-\d+\.ttf)/, (route) => {
    const file = new URL(route.request().url()).pathname.split('/').pop();
    route.fulfill({ contentType: file.endsWith('.woff2') ? 'font/woff2' : 'font/ttf', body: readFileSync(`${REPO}/apps/storefront/assets/${file}`) });
  });
  await page.goto(`${STORE}${path}?shopper=${shopper}`, { waitUntil: 'load' });
  await page.waitForSelector('[data-ai-chat-toggle]');
  return { browser, page };
}
