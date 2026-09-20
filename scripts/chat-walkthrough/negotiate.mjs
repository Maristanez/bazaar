import { open } from './harness.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const [label, w, h, mobile] = process.argv.slice(2);
const out = `shots/${label}`;
mkdirSync(out, { recursive: true });
const log = [];
const { browser, page } = await open({ width: +w, height: +h, mobile: mobile === 'mobile', shopper: `pw-${label}-${Date.now()}` });
page.on('console', (m) => { if (m.type() === 'error') log.push({ consoleError: m.text() }); });

let n = 0;
const shot = (name) => page.screenshot({ path: `${out}/${String(++n).padStart(2, '0')}-${name}.png` });

await shot('page-closed');
await page.click('[data-ai-chat-toggle]');
await page.waitForTimeout(400);
await shot('chat-open');

async function say(text, name) {
  await page.fill('[data-ai-chat-input]', text);
  const t0 = Date.now();
  await page.press('[data-ai-chat-input]', 'Enter');
  await page.waitForTimeout(250);
  await shot(`${name}-thinking`);
  await page.waitForFunction(() => !document.querySelector('[data-ai-chat-form]').classList.contains('is-loading'), null, { timeout: 60000 });
  const ms = Date.now() - t0;
  await page.waitForTimeout(500);
  const state = await page.evaluate(() => {
    const msgs = [...document.querySelectorAll('.ai-chat__message--bot')];
    const cards = [...document.querySelectorAll('.ai-chat__offer-card')];
    const last = cards.at(-1);
    return {
      reply: msgs.at(-1)?.textContent,
      cards: cards.length,
      lastCard: last ? last.innerText : null,
      lastCardStatus: last?.getAttribute('data-offer-status'),
    };
  });
  log.push({ said: text, ms, ...state });
  await shot(name);
  const card = page.locator('.ai-chat__offer-card').last();
  if (await card.count()) await card.screenshot({ path: `${out}/${String(++n).padStart(2, '0')}-${name}-card.png` }).catch(() => {});
}

await say('Does this run true to size?', 'question');
await say("Could you do $120? I'm buying socks too.", 'offer1');
await say("How about $110? I'm a student on a tight budget.", 'offer2');
await say('$40. Final.', 'lowball');
await say('Ok what is the best you can do?', 'best');
await say('One more try: $100 and I will tell all my friends.', 'round5');

// Scroll the transcript back to the top to see superseded cards and overall rhythm.
await page.evaluate(() => { document.querySelector('[data-ai-chat-messages]').scrollTop = 0; });
await shot('transcript-top');
const metrics = await page.evaluate(() => {
  const r = (el) => el && (({ width, height, top, left }) => ({ width, height, top, left }))(el.getBoundingClientRect());
  return {
    panel: r(document.querySelector('#ai-chat-panel')),
    messages: r(document.querySelector('[data-ai-chat-messages]')),
    messagesScrollHeight: document.querySelector('[data-ai-chat-messages]').scrollHeight,
    input: r(document.querySelector('[data-ai-chat-input]')),
    viewport: { w: innerWidth, h: innerHeight },
  };
});
log.push({ metrics });
writeFileSync(`${out}/log.json`, JSON.stringify(log, null, 2));
console.log(JSON.stringify(log, null, 2));
await browser.close();
