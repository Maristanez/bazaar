// Mounts the storefront chat in jsdom: the widget markup cut from layout/theme.liquid, chat-demo.js, then the named
// juniper-* feature files, in that order. The theme is outside the workspace, so jsdom is borrowed from apps/web.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const { JSDOM } = createRequire(`${repo}apps/web/package.json`)("jsdom");

export const ENDPOINT = "https://bazaar.test";

export type ChatReply = { reply: string; card?: unknown; negotiationId?: string; products?: unknown[] };

export type MountOptions = {
  features?: string[];
  url?: string;
  currentProduct?: Record<string, unknown> | null;
  products?: Record<string, unknown>[];
  page?: Record<string, unknown> | null;
  /** Runs before any script, to install fakes such as window.SpeechRecognition or sessionStorage values. */
  before?: (window: any) => void;
  /** Answers POST /api/chat. Other routes answer `{}` unless `routes` names them. */
  chat?: (payload: any) => ChatReply;
  routes?: Record<string, (body: any) => unknown>;
};

export function must<T>(value: T | undefined | null, what = "value"): T {
  if (value == null) throw new Error(`${what} is missing`);
  return value;
}

export function widgetMarkup(): string {
  const liquid = readFileSync(`${repo}apps/storefront/layout/theme.liquid`, "utf8");
  const start = liquid.indexOf('<div\n      class="ai-chat"');
  const end = liquid.indexOf('<script type="application/json" data-ai-chat-products>');
  return liquid.slice(start, end).replace("{{ settings.ai_chat_endpoint | escape }}", ENDPOINT);
}

export function mountWidget(options: MountOptions = {}) {
  const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
  const html = `<!doctype html><html><body>${widgetMarkup()}
    <script type="application/json" data-ai-chat-products>${json(options.products || [])}</script>
    ${options.currentProduct ? `<script type="application/json" data-ai-chat-current-product>${json(options.currentProduct)}</script>` : ""}
    ${options.page ? `<script type="application/json" data-ai-chat-page>${json(options.page)}</script>` : ""}
  </body></html>`;
  const dom = new JSDOM(html, { url: options.url || "https://trailhead.test/products/trail-runner-2", runScripts: "outside-only", pretendToBeVisual: true });
  const window = dom.window as any;
  const requests: { path: string; body: any }[] = [];
  window.fetch = async (input: string, init: { body?: unknown } = {}) => {
    const path = new URL(String(input), ENDPOINT).pathname;
    let body: any = init.body;
    try { body = typeof init.body === "string" ? JSON.parse(init.body) : init.body; } catch { /* a binary body stays as it is */ }
    requests.push({ path, body });
    const route = options.routes?.[path];
    const data = route ? route(body) : path === "/api/chat" ? (options.chat || (() => ({ reply: "Noted." })))(body) : {};
    return { ok: true, status: 200, json: async () => data, blob: async () => new window.Blob(["audio"]) };
  };
  window.HTMLFormElement.prototype.requestSubmit = function () { this.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); };
  window.HTMLElement.prototype.scrollIntoView = function () {};
  options.before?.(window);
  const load = (file: string) => window.eval(readFileSync(`${repo}apps/storefront/assets/${file}`, "utf8"));
  load("chat-demo.js");
  for (const feature of options.features || []) load(`juniper-${feature}.js`);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { window, document: window.document as Document, chat: window.BazaarChat, requests, settle };
}
