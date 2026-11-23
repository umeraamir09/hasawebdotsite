import { z } from "zod";
import {
  type PortfolioModel,
  PREVIEW_MAX_BYTES,
  parsePortfolioModel,
} from "./model";
import { yieldPreviewTask } from "./preview-task";

export const PREVIEW_CHUNK_BYTES = 65_536;
const channelSchema = z.string().min(1).max(128);
const sequenceSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const selectionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("profile") }),
  z.strictObject({
    kind: z.literal("component"),
    id: z.string().min(1).max(128),
  }),
]);
export type PreviewSelection = z.infer<typeof selectionSchema>;
export type PreviewIdentity = { ownerId: string; portfolioId: string };
const actionSchema = z.enum(["up", "down", "remove"]);
// A section action chosen on the preview canvas. The parent checks the ID
// against its draft before acting.
export type PreviewAction = z.infer<typeof actionSchema>;
const schemeSchema = z.enum(["light", "dark"]);
export type PreviewScheme = z.infer<typeof schemeSchema>;
// The editor's canvas outline. The receiver creates it and calls it with the
// selection and after each displayed model; Review never selects, so it never
// shows.
export type PreviewOverlay = {
  // `actions` is false while the editor shows them in its mobile dock.
  select(selection: PreviewSelection, actions: boolean): void;
  refresh(): void;
  dispose(): void;
};
export type PreviewOverlayFactory = (port: {
  root: HTMLElement;
  act(action: PreviewAction, id: string): void;
}) => PreviewOverlay;
const common = { protocol: z.literal(1), channel: channelSchema };
const wireSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...common, kind: z.literal("hello") }),
  z.strictObject({ ...common, kind: z.literal("unavailable") }),
  z.strictObject({
    ...common,
    kind: z.literal("ready"),
    ownerId: z.string(),
    portfolioId: z.string(),
  }),
  z.strictObject({
    ...common,
    kind: z.literal("begin"),
    sequence: sequenceSchema,
    bytes: z.number().int().positive().max(PREVIEW_MAX_BYTES),
  }),
  z.strictObject({
    ...common,
    kind: z.literal("chunk"),
    sequence: sequenceSchema,
    offset: z.number().int().nonnegative(),
    data: z
      .instanceof(ArrayBuffer)
      .refine(
        (data) => data.byteLength > 0 && data.byteLength <= PREVIEW_CHUNK_BYTES,
      ),
  }),
  z.strictObject({
    ...common,
    kind: z.literal("finish"),
    sequence: sequenceSchema,
  }),
  z.strictObject({
    ...common,
    kind: z.literal("cancel"),
    sequence: sequenceSchema,
  }),
  z.strictObject({
    ...common,
    kind: z.literal("ack"),
    sequence: sequenceSchema,
    offset: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ...common,
    kind: z.literal("applied"),
    sequence: sequenceSchema,
  }),
  z.strictObject({
    ...common,
    kind: z.literal("rejected"),
    sequence: sequenceSchema,
  }),
  z.strictObject({
    ...common,
    kind: z.literal("select"),
    selection: selectionSchema,
    actions: z.boolean().optional(),
  }),
  z.strictObject({
    ...common,
    kind: z.literal("action"),
    action: actionSchema,
    id: z.string().min(1).max(128),
  }),
  z.strictObject({ ...common, kind: z.literal("scheme"), mode: schemeSchema }),
]);
type Wire = z.infer<typeof wireSchema>;
export type PreviewState =
  | { kind: "connecting"; requested: number; displayed: number | null }
  | {
      kind: "preparing" | "displayed" | "rejected";
      requested: number;
      displayed: number | null;
    }
  | { kind: "closed"; requested: number; displayed: number | null };

export async function encodePreview(
  model: PortfolioModel,
  signal: AbortSignal,
): Promise<Uint8Array[]> {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let buffer = new Uint8Array(PREVIEW_CHUNK_BYTES);
  let offset = 0;
  let total = 0;
  let work = 0;
  let bytesSinceYield = 0;
  async function append(text: string) {
    const bytes = encoder.encode(text);
    total += bytes.byteLength;
    if (total > PREVIEW_MAX_BYTES) throw new Error("Preview envelope exceeded");
    let at = 0;
    while (at < bytes.byteLength) {
      const length = Math.min(
        bytes.byteLength - at,
        buffer.byteLength - offset,
      );
      buffer.set(bytes.subarray(at, at + length), offset);
      offset += length;
      at += length;
      if (offset === buffer.byteLength) {
        chunks.push(buffer);
        buffer = new Uint8Array(PREVIEW_CHUNK_BYTES);
        offset = 0;
      }
    }
    bytesSinceYield += bytes.byteLength;
    if (++work >= 256 || bytesSinceYield >= 32_768) {
      await yieldPreviewTask();
      signal.throwIfAborted();
      work = 0;
      bytesSinceYield = 0;
    }
  }
  async function string(value: string) {
    await append('"');
    for (let at = 0; at < value.length; ) {
      let end = Math.min(at + 4096, value.length);
      const last = value.charCodeAt(end - 1);
      if (
        end < value.length &&
        (last === 13 || (last >= 0xd800 && last <= 0xdbff))
      )
        end--;
      const part = value
        .slice(at, end)
        .replace(/\r\n?/g, "\n")
        .replaceAll("\u0000", "\uFFFD");
      const normalized = new TextDecoder("utf-8", { ignoreBOM: true }).decode(
        encoder.encode(part),
      );
      await append(JSON.stringify(normalized).slice(1, -1));
      at = end;
    }
    await append('"');
  }
  async function visit(value: unknown): Promise<void> {
    signal.throwIfAborted();
    if (typeof value === "string") return string(value);
    if (Array.isArray(value)) {
      await append("[");
      for (let i = 0; i < value.length; i++) {
        if (i) await append(",");
        await visit(value[i]);
      }
      await append("]");
    } else if (value !== null && typeof value === "object") {
      await append("{");
      let first = true;
      for (const [key, item] of Object.entries(value)) {
        if (!first) await append(",");
        first = false;
        await string(key);
        await append(":");
        await visit(item);
      }
      await append("}");
    } else if (
      value === null ||
      typeof value === "boolean" ||
      typeof value === "number"
    )
      await append(JSON.stringify(value));
    else throw new Error("Invalid display value");
  }
  await visit(model);
  if (offset) chunks.push(buffer.slice(0, offset));
  return chunks;
}
function configuration(origin: string, channel: string) {
  if (
    origin === "null" ||
    new URL(origin).origin !== origin ||
    !/^https?:/.test(origin) ||
    !channelSchema.safeParse(channel).success
  )
    throw new Error("Invalid preview bridge configuration");
}
function selected(model: PortfolioModel, selection: PreviewSelection) {
  return (
    selection.kind === "profile" ||
    model.components.some((component) => component.id === selection.id)
  );
}
export function attachPreviewReceiver(options: {
  target: { update(input: unknown): boolean };
  root: HTMLElement;
  parentWindow: Window;
  parentOrigin: string;
  channel: string;
  identity: PreviewIdentity;
  overlay?: PreviewOverlayFactory | undefined;
}) {
  const { parentWindow, parentOrigin, channel } = options;
  configuration(parentOrigin, channel);
  let highest = -1;
  let displayed: PortfolioModel | null = null;
  let assembly: { sequence: number; bytes: Uint8Array; offset: number } | null =
    null;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const send = (message: Wire) =>
    parentWindow.postMessage(message, parentOrigin);
  const clear = () => {
    assembly = null;
    clearTimeout(timeout);
  };
  const reject = (sequence: number) => {
    clear();
    send({ protocol: 1, channel, kind: "rejected", sequence });
  };
  const ready = () =>
    send({ protocol: 1, channel, kind: "ready", ...options.identity });
  const receive = (event: MessageEvent<unknown>) => {
    if (event.source !== parentWindow || event.origin !== parentOrigin) return;
    const parsed = wireSchema.safeParse(event.data);
    if (!parsed.success || parsed.data.channel !== channel) return;
    const message = parsed.data;
    if (message.kind === "hello") {
      ready();
      return;
    }
    if (message.kind === "begin") {
      if (message.sequence <= highest) return;
      highest = message.sequence;
      clear();
      assembly = {
        sequence: message.sequence,
        bytes: new Uint8Array(message.bytes),
        offset: 0,
      };
      timeout = setTimeout(() => reject(message.sequence), 15000);
      send({
        protocol: 1,
        channel,
        kind: "ack",
        sequence: message.sequence,
        offset: 0,
      });
    } else if (message.kind === "cancel") {
      if (assembly?.sequence === message.sequence) clear();
    } else if (message.kind === "chunk") {
      if (!assembly || assembly.sequence !== message.sequence) return;
      if (
        message.offset !== assembly.offset ||
        assembly.offset + message.data.byteLength > assembly.bytes.byteLength
      ) {
        reject(message.sequence);
        return;
      }
      assembly.bytes.set(new Uint8Array(message.data), assembly.offset);
      assembly.offset += message.data.byteLength;
      send({
        protocol: 1,
        channel,
        kind: "ack",
        sequence: message.sequence,
        offset: assembly.offset,
      });
    } else if (message.kind === "finish") {
      if (!assembly || assembly.sequence !== message.sequence) return;
      if (assembly.offset !== assembly.bytes.byteLength) {
        reject(message.sequence);
        return;
      }
      try {
        const input: unknown = JSON.parse(
          new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
            assembly.bytes,
          ),
        );
        const parsedModel = parsePortfolioModel(input);
        if (!parsedModel || !options.target.update(parsedModel)) {
          reject(message.sequence);
          return;
        }
        displayed = parsedModel;
        for (const section of options.root.querySelectorAll<HTMLElement>(
          "[data-component-id], [data-component=profile]",
        ))
          section.tabIndex = 0;
        overlay?.refresh();
        reportScheme();
        clear();
        send({
          protocol: 1,
          channel,
          kind: "applied",
          sequence: message.sequence,
        });
      } catch {
        reject(message.sequence);
      }
    } else if (
      message.kind === "select" &&
      displayed &&
      selected(displayed, message.selection)
    )
      markSelection(message.selection, message.actions ?? true);
    else if (message.kind === "scheme") {
      const toggle = options.root.querySelector<HTMLButtonElement>(
        "[data-theme-toggle]",
      );
      if (document.documentElement.dataset.colorMode !== message.mode)
        toggle?.click();
    }
  };
  // The parent's scheme toggle mirrors the preview, including the visitor
  // toggle inside it.
  let reported: string | undefined;
  function reportScheme() {
    const mode = schemeSchema.safeParse(
      document.documentElement.dataset.colorMode,
    );
    if (!mode.success || mode.data === reported) return;
    reported = mode.data;
    send({ protocol: 1, channel, kind: "scheme", mode: mode.data });
  }
  const schemeObserver = new MutationObserver(reportScheme);
  schemeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-color-mode"],
  });
  let actions = true;
  function markSelection(selection: PreviewSelection, showActions = actions) {
    actions = showActions;
    for (const element of options.root.querySelectorAll<HTMLElement>(
      "[data-component], [data-component-id]",
    )) {
      const active =
        selection.kind === "profile"
          ? element.dataset.component === "profile"
          : element.dataset.componentId === selection.id;
      element.toggleAttribute("data-editor-selected", active);
    }
    overlay?.select(selection, actions);
  }
  const overlay = options.overlay?.({
    root: options.root,
    act(action, id) {
      if (displayed?.components.some((component) => component.id === id))
        send({ protocol: 1, channel, kind: "action", action, id });
    },
  });
  const choose = (event: Event) => {
    if (event instanceof KeyboardEvent && !["Enter", " "].includes(event.key))
      return;
    if (!(event.target instanceof Element) || !displayed) return;
    if (event.target.closest("a, button, input, textarea, select, form"))
      return;
    const element = event.target.closest<HTMLElement>(
      "[data-component-id], [data-component=profile]",
    );
    if (!element) return;
    const selection: PreviewSelection = element.dataset.componentId
      ? { kind: "component", id: element.dataset.componentId }
      : { kind: "profile" };
    if (!selected(displayed, selection)) return;
    if (event instanceof KeyboardEvent) event.preventDefault();
    markSelection(selection);
    send({ protocol: 1, channel, kind: "select", selection });
  };
  window.addEventListener("message", receive);
  options.root.addEventListener("click", choose);
  options.root.addEventListener("keydown", choose);
  ready();
  return () => {
    clear();
    displayed = null;
    overlay?.dispose();
    schemeObserver.disconnect();
    window.removeEventListener("message", receive);
    options.root.removeEventListener("click", choose);
    options.root.removeEventListener("keydown", choose);
  };
}

export function connectPreviewBridge(options: {
  iframe: HTMLIFrameElement;
  origin: string;
  channel: string;
  identity: PreviewIdentity;
  onState(state: PreviewState): void;
  onSelect(selection: PreviewSelection): void;
  onAction?(action: PreviewAction, id: string): void;
  onScheme?(mode: PreviewScheme): void;
}) {
  configuration(options.origin, options.channel);
  const { iframe, origin, channel } = options;
  let sequence = 0;
  let displayed: number | null = null;
  let ready = false;
  let closed = false;
  let connecting: ReturnType<typeof setTimeout> | undefined;
  let abort = new AbortController();
  let preparation: ((signal: AbortSignal) => Promise<PortfolioModel>) | null =
    null;
  let pending: {
    sequence: number;
    offset: number | "applied";
    resolve(): void;
    reject(): void;
  } | null = null;
  const send = (message: Wire, transfer: Transferable[] = []) =>
    iframe.contentWindow?.postMessage(message, origin, transfer);
  const state = (kind: PreviewState["kind"]) =>
    options.onState({ kind, requested: sequence, displayed });
  function settle(ok: boolean) {
    const current = pending;
    pending = null;
    if (current) {
      if (ok) current.resolve();
      else current.reject();
    }
  }
  async function exchange(
    message: Wire,
    offset: number | "applied",
    signal: AbortSignal,
    transfer: Transferable[] = [],
  ) {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const finish = (ok: boolean) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        if (ok) resolve();
        else reject(new Error("Preview update rejected"));
      };
      const cancel = () => settle(false);
      const timer = setTimeout(cancel, 15000);
      signal.addEventListener("abort", cancel, { once: true });
      pending = {
        sequence,
        offset,
        resolve: () => finish(true),
        reject: () => finish(false),
      };
      send(message, transfer);
    });
  }
  async function render(
    requested: number,
    prepare: (signal: AbortSignal) => Promise<PortfolioModel>,
    signal: AbortSignal,
  ) {
    try {
      const model = await prepare(signal);
      signal.throwIfAborted();
      const chunks = await encodePreview(model, signal);
      signal.throwIfAborted();
      const bytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
      await exchange(
        { protocol: 1, channel, kind: "begin", sequence: requested, bytes },
        0,
        signal,
      );
      let offset = 0;
      for (const chunk of chunks) {
        const buffer = new ArrayBuffer(chunk.byteLength);
        new Uint8Array(buffer).set(chunk);
        const next = offset + buffer.byteLength;
        await exchange(
          {
            protocol: 1,
            channel,
            kind: "chunk",
            sequence: requested,
            offset,
            data: buffer,
          },
          next,
          signal,
          [buffer],
        );
        offset = next;
      }
      await exchange(
        { protocol: 1, channel, kind: "finish", sequence: requested },
        "applied",
        signal,
      );
      if (!closed && requested === sequence) {
        displayed = requested;
        state("displayed");
      }
    } catch {
      if (!closed && requested === sequence && !signal.aborted)
        state("rejected");
    }
  }
  const receive = (event: MessageEvent<unknown>) => {
    if (
      event.source !== iframe.contentWindow ||
      event.origin !== origin ||
      closed
    )
      return;
    const parsed = wireSchema.safeParse(event.data);
    if (!parsed.success || parsed.data.channel !== channel) return;
    const message = parsed.data;
    if (message.kind === "unavailable") {
      clearTimeout(connecting);
      ready = false;
      abort.abort();
      displayed = null;
      state("rejected");
      return;
    }
    if (message.kind === "ready") {
      clearTimeout(connecting);
      if (
        message.ownerId !== options.identity.ownerId ||
        message.portfolioId !== options.identity.portfolioId
      ) {
        ready = false;
        abort.abort();
        state("rejected");
        return;
      }
      if (!ready) {
        ready = true;
        if (preparation) void render(sequence, preparation, abort.signal);
      }
    } else if (message.kind === "select") options.onSelect(message.selection);
    else if (message.kind === "action")
      options.onAction?.(message.action, message.id);
    else if (message.kind === "scheme") options.onScheme?.(message.mode);
    else if ("sequence" in message && message.sequence === pending?.sequence) {
      if (message.kind === "rejected") settle(false);
      else if (message.kind === "applied" && pending.offset === "applied")
        settle(true);
      else if (message.kind === "ack" && message.offset === pending.offset)
        settle(true);
    }
  };
  const hello = () => {
    abort.abort();
    send({ protocol: 1, channel, kind: "cancel", sequence });
    abort = new AbortController();
    sequence++;
    displayed = null;
    ready = false;
    state("connecting");
    clearTimeout(connecting);
    connecting = setTimeout(() => {
      if (!ready && !closed) state("rejected");
    }, 15000);
    send({ protocol: 1, channel, kind: "hello" });
  };
  const resume = (event: PageTransitionEvent) => {
    if (event.persisted) hello();
  };
  window.addEventListener("pageshow", resume);
  window.addEventListener("message", receive);
  iframe.addEventListener("load", hello);
  hello();
  return {
    request(prepare: (signal: AbortSignal) => Promise<PortfolioModel>) {
      if (closed) return;
      abort.abort();
      send({ protocol: 1, channel, kind: "cancel", sequence });
      abort = new AbortController();
      sequence++;
      preparation = prepare;
      state(ready ? "preparing" : "connecting");
      if (ready) void render(sequence, prepare, abort.signal);
    },
    select(selection: PreviewSelection, actions = true) {
      if (!closed)
        send({ protocol: 1, channel, kind: "select", selection, actions });
    },
    scheme(mode: PreviewScheme) {
      if (!closed) send({ protocol: 1, channel, kind: "scheme", mode });
    },
    dispose() {
      if (closed) return;
      abort.abort();
      send({ protocol: 1, channel, kind: "cancel", sequence });
      closed = true;
      clearTimeout(connecting);
      preparation = null;
      window.removeEventListener("message", receive);
      iframe.removeEventListener("load", hello);
      window.removeEventListener("pageshow", resume);
      state("closed");
    },
  };
}
