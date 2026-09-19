import type { Option, ProductCard } from "@bazaar/contracts";

const DEFAULT_ENDPOINT = "https://app.backboard.io/api/threads/messages";
const DEFAULT_TIMEOUT_MS = 4_000;

export const SHOPKEEPER_SYSTEM_PROMPT = `You are the shopkeeper of Trailhead Co. You are warm, quick, and a little cheeky, like a market trader rather than a call centre.
You will receive a shopper message and a MENU of deals that have already been priced and approved by server code.
Pick exactly one option from the MENU. When two options fit equally well, prefer lower owner_rank.
Reply exactly OPTION: <id> on the first line, then one sentence of at most 35 words.
Start that sentence with exactly one of these forms using the selected total: "I can do $X", "I can offer $X", "How about $X", "I can hold $X for 15 minutes", "<item title> is ready at $X", or, for a two-item or two-unit option, "I can do $X for both". For a final option, you may use "My best is $X".
Only append reasons that are copied word for word from the selected facts, separated with a semicolon. If selected facts is empty, end the sentence immediately after the price clause and add nothing else.
Only use dollar amounts present in the selected option. You may use indexed store documents and recalled memory to choose an option, but the sentence may state only the selected option and its exact facts.
Never mention cost, margin, floor, profit, private policy, hidden ranking, or price calculation.
Never create a price, option, discount, checkout link, inventory claim, or approval.
For sizing, shipping, and returns, use indexed store documents, then return to the live offer.`;

export const QUESTION_SYSTEM_PROMPT = `You are the shopkeeper of Trailhead Co. You are warm, quick, and a little cheeky, like a market trader rather than a call centre.
Answer product, sizing, shipping, and return questions from the indexed store documents and recalled shopper memory. Keep the answer under 70 words.
Treat public product context as current storefront facts. If the shopper wants to negotiate, invite them to make an offer instead of inventing a price.
Never mention cost, margin, floor, profit, private policy, hidden ranking, memory machinery, or internal reasoning.
Never invent a price, discount, checkout link, inventory claim, or approval.`;

export type BackboardRunTrace = {
  provider: string;
  model: string;
  ms: number;
  costUsd: number | null;
  threadId: string;
  assistantId: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  memory?: string;
  files?: string[];
};

export type BackboardChoice = {
  optionId: string;
  line: string;
  trace: BackboardRunTrace;
};

export type ChooseAndSayContext = {
  shopperId: string;
  negotiationId: string;
  shopperMessage: string;
  productId: string;
  title: string;
  size?: string;
  round: number;
  budget?: number;
  wants?: string;
};

export type BackboardQuestion = {
  shopperId: string;
  negotiationId: string;
  shopperMessage: string;
  product?: Partial<ProductCard> & Record<string, unknown>;
  products?: readonly (Partial<ProductCard> & Record<string, unknown>)[];
};

export type BackboardClientConfig = {
  apiKey: string;
  assistantId: string;
  endpoint?: string;
  provider?: string;
  model?: string;
  memory?: "Auto" | "Readonly" | "off";
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

export type BackboardClient = {
  chooseAndSay(options: readonly Option[], context: ChooseAndSayContext): Promise<BackboardChoice>;
  answerQuestion(input: BackboardQuestion): Promise<{ reply: string; trace: BackboardRunTrace }>;
  threadFor(shopperId: string, negotiationId: string): string | undefined;
};

export class BackboardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackboardError";
  }
}

export class BackboardTimeoutError extends BackboardError {
  constructor(milliseconds: number) {
    super(`Backboard timed out after ${milliseconds} ms`);
    this.name = "BackboardTimeoutError";
  }
}

type JsonRecord = Record<string, unknown>;

type ParsedRun = {
  content: string;
  terminal: JsonRecord;
  started: JsonRecord | undefined;
  memories: unknown;
};

export function createBackboardShopkeeper(config: BackboardClientConfig): BackboardClient {
  const apiKey = config.apiKey.trim();
  const assistantId = config.assistantId.trim();
  if (!apiKey) throw new BackboardError("BACKBOARD_API_KEY is required");
  if (!assistantId) throw new BackboardError("BACKBOARD_ASSISTANT_ID is required");

  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
  const provider = config.provider ?? "openai";
  const model = config.model ?? "gpt-4.1-mini";
  const memory = config.memory ?? "Readonly";
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = config.fetchImpl ?? fetch;
  const now = config.now ?? Date.now;
  const threads = new Map<string, string>();

  async function run(input: {
    shopperId: string;
    negotiationId: string;
    content: string;
    systemPrompt: string;
  }): Promise<{ content: string; trace: BackboardRunTrace }> {
    const key = threadKey(input.shopperId, input.negotiationId);
    const previousThreadId = threads.get(key);
    const controller = new AbortController();
    const startedAt = now();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "X-API-Key": apiKey,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          assistant_id: assistantId,
          ...(previousThreadId === undefined ? {} : { thread_id: previousThreadId }),
          content: input.content,
          system_prompt: input.systemPrompt,
          stream: true,
          llm_provider: provider,
          model_name: model,
          memory,
          memory_response_citation: true,
          web_search: "off",
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 300);
        throw new BackboardError(`Backboard HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
      }
      if (!response.body) throw new BackboardError("Backboard returned no event stream");
      const parsed = await parseEventStream(response.body);
      const terminal = parsed.terminal;
      const threadId = stringValue(terminal.thread_id);
      if (!threadId) throw new BackboardError("Backboard run_ended omitted thread_id");
      threads.set(key, threadId);
      const trace: BackboardRunTrace = {
        provider: stringValue(terminal.model_provider) ?? stringValue(parsed.started?.provider) ?? provider,
        model: stringValue(terminal.model_name) ?? stringValue(parsed.started?.model_name) ?? model,
        ms: Math.max(0, now() - startedAt),
        costUsd: numberValue(terminal.cost_usd),
        threadId,
        assistantId: stringValue(terminal.assistant_id) ?? assistantId,
        ...optionalNumber("inputTokens", terminal.input_tokens),
        ...optionalNumber("outputTokens", terminal.output_tokens),
        ...optionalNumber("totalTokens", terminal.total_tokens),
        ...memoryField(terminal.retrieved_memories ?? parsed.memories),
        ...filesField(terminal.retrieved_files),
      };
      return { content: parsed.content.trim(), trace };
    } catch (error) {
      if (controller.signal.aborted) throw new BackboardTimeoutError(timeoutMs);
      if (error instanceof BackboardError) throw error;
      throw new BackboardError(error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async chooseAndSay(options, context) {
      if (!options.length) throw new BackboardError("Backboard received an empty menu");
      const safeMenu = options.map(publicMenuOption);
      const result = await run({
        shopperId: context.shopperId,
        negotiationId: context.negotiationId,
        systemPrompt: SHOPKEEPER_SYSTEM_PROMPT,
        content: [
          `SHOPPER MESSAGE: ${context.shopperMessage}`,
          `PUBLIC CONTEXT: ${JSON.stringify({ productId: context.productId, title: context.title, size: context.size, round: context.round, budget: context.budget, wants: context.wants })}`,
          `MENU: ${JSON.stringify(safeMenu)}`,
        ].join("\n"),
      });
      const pick = parseBackboardPick(result.content);
      if (!safeMenu.some((option) => option.id === pick.optionId)) {
        throw new BackboardError(`Backboard selected unknown option ${pick.optionId}`);
      }
      return { ...pick, trace: result.trace };
    },

    async answerQuestion(input) {
      const result = await run({
        shopperId: input.shopperId,
        negotiationId: input.negotiationId,
        systemPrompt: QUESTION_SYSTEM_PROMPT,
        content: [
          `SHOPPER QUESTION: ${input.shopperMessage}`,
          `PUBLIC CURRENT PRODUCT: ${JSON.stringify(input.product ?? null)}`,
          `PUBLIC STOREFRONT PRODUCTS: ${JSON.stringify(input.products ?? [])}`,
        ].join("\n"),
      });
      return { reply: validateBackboardAnswer(result.content, input), trace: result.trace };
    },

    threadFor(shopperId, negotiationId) {
      return threads.get(threadKey(shopperId, negotiationId));
    },
  };
}

export function validateBackboardAnswer(content: string, input: BackboardQuestion): string {
  const reply = content.replace(/\s+/g, " ").trim();
  if (!reply) throw new BackboardError("Backboard returned an empty answer");
  if (reply.split(/\s+/).length > 70) throw new BackboardError("Backboard answer exceeded 70 words");
  if (/\b(?:costs?|floor|margin|profit|markup|wholesale|owner rank|hidden ranking|private policy|internal reasoning|discount|coupon|promo|inventory|in stock|out of stock|percent|per cent)\b/i.test(reply)) {
    throw new BackboardError("Backboard answer contained a forbidden claim");
  }
  if (/https?:\/\/|www\./i.test(reply) || /\b\d+(?:\.\d+)?\s*%/.test(reply)) {
    throw new BackboardError("Backboard answer contained an unchecked link or percentage");
  }
  const allowedAmounts = publicDollarAmounts(input);
  for (const match of reply.matchAll(/(?:\$\s*|\bCAD\s+)(\d+(?:\.\d{1,2})?)/gi)) {
    const cents = Math.round(Number(match[1]) * 100);
    if (!allowedAmounts.has(cents)) throw new BackboardError("Backboard answer contained an unknown dollar amount");
  }
  for (const match of reply.matchAll(/\b(\d+(?:\.\d{1,2})?)\s*(?:CAD|dollars?|bucks?)\b/gi)) {
    const cents = Math.round(Number(match[1]) * 100);
    if (!allowedAmounts.has(cents)) throw new BackboardError("Backboard answer contained an unknown dollar amount");
  }
  for (const match of reply.matchAll(/\b(?:price|amount|total)\s+(?:is\s+|at\s+)?(\d+(?:\.\d{1,2})?)\b/gi)) {
    const cents = Math.round(Number(match[1]) * 100);
    if (!allowedAmounts.has(cents)) throw new BackboardError("Backboard answer contained an unknown dollar amount");
  }
  return reply;
}

export function parseBackboardPick(content: string): { optionId: string; line: string } {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  const match = /^OPTION:\s*([A-Za-z0-9_-]+)\s*\n+([\s\S]+)$/.exec(normalized);
  if (!match) throw new BackboardError("Backboard choose output was malformed");
  const optionId = match[1];
  const line = match[2]?.replace(/\s+/g, " ").trim();
  if (!optionId || !line) throw new BackboardError("Backboard choose output was incomplete");
  if (line.split(/\s+/).length > 35) throw new BackboardError("Backboard choose line exceeded 35 words");
  return { optionId, line };
}

async function parseEventStream(stream: ReadableStream<Uint8Array>): Promise<ParsedRun> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let started: JsonRecord | undefined;
  let memories: unknown;
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const frames = takeFrames(buffer, done);
      buffer = frames.rest;
      for (const frame of frames.frames) {
        const event = parseFrame(frame);
        if (!event) continue;
        const type = stringValue(event.type);
        if (type === "run_started") started = event;
        else if (type === "memory_retrieved") memories = event.memories;
        else if (type === "content_streaming") content += stringValue(event.content) ?? "";
        else if (type === "run_failed" || type === "error") {
          throw new BackboardError(`Backboard ${type}: ${failureMessage(event)}`);
        } else if (type === "run_ended") {
          if (stringValue(event.status) !== "completed") {
            throw new BackboardError(`Backboard ended with status ${stringValue(event.status) ?? "unknown"}`);
          }
          const finalContent = stringValue(event.final_content) ?? stringValue(event.content) ?? content;
          if (!finalContent.trim()) throw new BackboardError("Backboard completed without content");
          await reader.cancel();
          return { content: finalContent, terminal: event, started, memories };
        }
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
  throw new BackboardError("Backboard stream ended without run_ended");
}

function takeFrames(input: string, done: boolean): { frames: string[]; rest: string } {
  const normalized = input.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  if (done) return { frames: parts.filter((part) => part.trim()), rest: "" };
  return { frames: parts.slice(0, -1).filter((part) => part.trim()), rest: parts.at(-1) ?? "" };
}

function parseFrame(frame: string): JsonRecord | undefined {
  const data = frame.split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data || data === "[DONE]") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new BackboardError("Backboard sent malformed event JSON");
  }
  if (!isRecord(parsed)) throw new BackboardError("Backboard sent a non-object event");
  return parsed;
}

type PublicMenuOption = Omit<Option, "listTotal" | "total"> & {
  listTotal: string;
  total: string;
};

function publicMenuOption(option: Option): PublicMenuOption {
  return {
    id: option.id,
    kind: option.kind,
    items: option.items.map((item) => ({
      variantId: item.variantId,
      title: item.title,
      ...(item.size === undefined ? {} : { size: item.size }),
      qty: item.qty,
      ...(item.thrownIn === undefined ? {} : { thrownIn: item.thrownIn }),
    })),
    listTotal: formatCents(option.listTotal),
    total: formatCents(option.total),
    ownerRank: option.ownerRank,
    facts: [...option.facts],
  };
}

function formatCents(cents: number): string {
  const dollars = Number(cents || 0) / 100;
  return `$${Number.isInteger(dollars) ? dollars.toFixed(0) : dollars.toFixed(2)}`;
}

function publicDollarAmounts(input: BackboardQuestion): Set<number> {
  const amounts = new Set<number>();
  const products = [input.product, ...(input.products ?? [])].filter((product): product is Partial<ProductCard> & Record<string, unknown> => Boolean(product));
  for (const product of products) {
    if (typeof product.listPrice === "number" && Number.isFinite(product.listPrice)) amounts.add(Math.round(product.listPrice));
    if (typeof product.price === "string") {
      const match = product.price.match(/(?:\$\s*|\bCAD\s+)(\d+(?:\.\d{1,2})?)/i);
      if (match) amounts.add(Math.round(Number(match[1]) * 100));
    }
  }
  return amounts;
}

function threadKey(shopperId: string, negotiationId: string): string {
  return JSON.stringify([shopperId, negotiationId]);
}

function optionalNumber<Key extends string>(key: Key, value: unknown): Record<Key, number> | Record<string, never> {
  const number = numberValue(value);
  return number === null ? {} : { [key]: number } as Record<Key, number>;
}

function memoryField(value: unknown): { memory: string } | Record<string, never> {
  if (!Array.isArray(value) || value.length === 0) return {};
  const parts = value.map((item) => {
    if (typeof item === "string") return item;
    if (!isRecord(item)) return "";
    return stringValue(item.content) ?? stringValue(item.memory) ?? stringValue(item.text) ?? "";
  }).filter(Boolean);
  return parts.length ? { memory: parts.join(" | ") } : {};
}

function filesField(value: unknown): { files: string[] } | Record<string, never> {
  if (!Array.isArray(value)) return {};
  const files = value.map((item) => {
    if (typeof item === "string") return item;
    if (!isRecord(item)) return "";
    return stringValue(item.filename) ?? stringValue(item.file_name) ?? stringValue(item.name) ?? "";
  }).filter(Boolean);
  return files.length ? { files } : {};
}

function failureMessage(event: JsonRecord): string {
  const error = event.error;
  if (typeof error === "string") return error;
  if (isRecord(error)) return stringValue(error.message) ?? JSON.stringify(error).slice(0, 200);
  return stringValue(event.message) ?? "unknown failure";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
