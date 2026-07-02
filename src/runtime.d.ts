import { FLOW_INSPECT, FLOW_INSTANCE } from "./protocol.js";
import type { FlowAsyncSignalDefinition } from "./define.js";

export type FlowScheduler = {
  batch<T>(fn: () => T): T;
  enqueue?(fn: () => void): void;
  flush?(): Promise<void>;
};

export { FLOW_INSPECT, FLOW_INSTANCE } from "./protocol.js";

export type Signal<T = unknown> = {
  readonly type: "signal";
  value: T;
  get(): T;
  set(next: T): T;
  update(fn: (current: T) => T): T;
  subscribe(fn: (value: T) => void): () => void;
  snapshot(): T;
  restore(snapshot: T): void;
};

export type Status<T = unknown> = Signal<T> & {
  readonly type: "status";
  readonly allowed?: readonly T[];
};

export type Computed<T = unknown> = {
  readonly type: "computed";
  readonly value: T;
  get(): T;
  subscribe(fn: (value: T) => void): () => void;
  snapshot(): T;
};

export type ComputedOptions = {
  readonly arguments?: readonly unknown[] | ((store: Record<string, unknown> | undefined) => readonly unknown[]);
} & Record<string, unknown>;

export type ComputedReceiver = Record<string, unknown> & {
  readonly store?: Record<string, unknown>;
  readonly refs?: Record<string, unknown>;
  readonly name?: string;
};

export type AsyncSignalOptions = {
  readonly immediate?: boolean;
  readonly arguments?: readonly unknown[] | ((store: Record<string, unknown> | undefined) => readonly unknown[]);
} & Record<string, unknown>;

export type AsyncSignalReceiver = {
  readonly store?: Record<string, unknown>;
  readonly refs?: Record<string, unknown>;
  readonly asyncSignals?: Record<string, unknown>;
  readonly name?: string;
  readonly signal: AbortSignal;
  readonly version: number;
  readonly args: readonly unknown[];
};

export type AsyncSignalSnapshot<T = unknown> = {
  value: T | undefined;
  status: "idle" | "loading" | "ready" | "error";
  error: unknown;
  version: number;
};

export type AsyncSignal<T = unknown, Input = unknown> = {
  readonly type: "asyncSignal";
  readonly value: T | undefined;
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly loading: boolean;
  readonly ready: boolean;
  readonly error: unknown;
  readonly version: number;
  get(): T | undefined;
  load(input?: Input): T | PromiseLike<T>;
  reload(input?: Input): PromiseLike<T>;
  set(next: T): T;
  update(fn: (current: T | undefined) => T): T;
  cancel(reason?: unknown): "idle" | "loading" | "ready" | "error";
  subscribe(fn: (value: T | undefined) => void): () => void;
  snapshot(): AsyncSignalSnapshot<T>;
  restore(snapshot: AsyncSignalSnapshot<T> | T): void;
};

export type SignalLike<T = unknown> = Signal<T> | Status<T> | Computed<T> | AsyncSignal<T>;

export type FlowChange = {
  name?: string;
  input?: unknown;
  store: Record<string, unknown>;
};

export type FlowStoreDescriptionEntry = {
  type: string;
  writable: boolean;
  value: unknown;
  allowed?: readonly unknown[];
};

export type FlowAsyncSignalDescription = {
  type: "asyncSignal";
  status: "idle" | "loading" | "ready" | "error";
  loading: boolean;
  ready: boolean;
  version: number;
};

export type FlowTransitionRuleDescription = {
  from?: unknown;
  to?: unknown;
  dynamic?: boolean;
  conditional: boolean;
  reason?: string;
  label?: string;
};

export type FlowDescription = {
  store: Record<string, FlowStoreDescriptionEntry>;
  asyncSignals: Record<string, FlowAsyncSignalDescription>;
  handlers: string[];
  transitions: Record<string, { status: string; rules: FlowTransitionRuleDescription[] }>;
  guards: Record<string, { conditional: true; reason?: string; label?: string }>;
};

export type FlowEventExplanation = {
  event: unknown;
  allowed: boolean;
  reason: string;
  source?: "handler" | "transition" | "guard";
  status?: string;
  current?: unknown;
  next?: unknown;
  dynamic?: boolean;
  label?: string;
};

export type FlowHandlerReceiver = {
  readonly [FLOW_INSTANCE]: true;
  readonly [FLOW_INSPECT]: () => FlowDescription;
  store: Record<string, unknown>;
  refs: Record<string, SignalLike>;
  asyncSignals: Record<string, unknown>;
  dispatch(name: string, input?: unknown): unknown | PromiseLike<unknown>;
  explain(eventName: string, input?: unknown): FlowEventExplanation;
  after(ms: number, eventName: string, input?: unknown): number;
  dispose(cleanup: () => void): () => boolean;
} & Record<string, unknown>;

export type FlowHandler<Input = unknown, Result = unknown> = (
  this: FlowHandlerReceiver,
  store: Record<string, unknown>,
  input: Input
) => Result | PromiseLike<Result>;

export type StoreInstance = {
  readonly store: Record<string, unknown>;
  readonly refs: Record<string, SignalLike>;
  readonly asyncSignals: Record<string, unknown>;
  snapshot(): Record<string, unknown>;
  restore(snapshot: Record<string, unknown>): void;
};

export type FlowInstance = {
  readonly [FLOW_INSTANCE]: true;
  readonly [FLOW_INSPECT]: () => FlowDescription;
  readonly _: Record<string, unknown>;
  readonly store: Record<string, unknown>;
  readonly refs: Record<string, SignalLike>;
  readonly asyncSignals: Record<string, unknown>;
  readonly handlers: Record<string, (input?: unknown) => unknown | PromiseLike<unknown>>;
  get(name: string): unknown;
  set(name: string, value: unknown): unknown;
  update(name: string, fn: (value: unknown) => unknown): unknown;
  subscribe(name: string, fn: (value: unknown) => void): () => void;
  subscribe(fn: (change: FlowChange) => void): () => void;
  dispatch(name: string, input?: unknown): unknown | PromiseLike<unknown>;
  explain(eventName: string, input?: unknown): FlowEventExplanation;
  snapshot(): Record<string, unknown>;
  restore(snapshot: Record<string, unknown>): void;
  destroy(): void;
} & Record<string, unknown>;

export function createSignal<T>(initial: T, options?: { scheduler?: FlowScheduler }): Signal<T>;
export function createStatus<T>(
  initial: T,
  allowed?: readonly T[],
  options?: { scheduler?: FlowScheduler; name?: string }
): Status<T>;
export function createComputed<T>(
  compute: (this: ComputedReceiver, ...args: unknown[]) => T,
  options?: { scheduler?: FlowScheduler; store?: Record<string, unknown>; refs?: Record<string, unknown>; name?: string }
): Computed<T>;
export function createComputed<T>(
  options: ComputedOptions,
  compute: (this: ComputedReceiver, ...args: unknown[]) => T,
  runtimeOptions?: { scheduler?: FlowScheduler; store?: Record<string, unknown>; refs?: Record<string, unknown>; name?: string }
): Computed<T>;
export function createAsyncSignal<T = unknown, Input = unknown>(
  loader: (this: AsyncSignalReceiver, ...args: Input[]) => T | PromiseLike<T>,
  runtimeOptions?: { scheduler?: FlowScheduler; name?: string }
): AsyncSignal<T, Input>;
export function createAsyncSignal<T = unknown, Input = unknown>(
  definition: FlowAsyncSignalDefinition<T, Input>,
  runtimeOptions?: { scheduler?: FlowScheduler; name?: string }
): AsyncSignal<T, Input>;
export function createAsyncSignal<T = unknown, Input = unknown>(
  options: AsyncSignalOptions,
  loader: (this: AsyncSignalReceiver, ...args: Input[]) => T | PromiseLike<T>,
  runtimeOptions?: { scheduler?: FlowScheduler; name?: string }
): AsyncSignal<T, Input>;
export function createStore(
  declarations?: Record<string, unknown>,
  options?: { scheduler?: FlowScheduler; rejectPlainObjects?: boolean; context?: Record<string, unknown> }
): StoreInstance;
export function createFlow(
  definitionOrConfig: unknown,
  options?: {
    scheduler?: FlowScheduler;
    context?:
      | Record<string, unknown>
      | ((payload: {
          flow: FlowInstance;
          store: Record<string, unknown>;
          input: unknown;
        }) => Record<string, unknown> | undefined);
  }
): FlowInstance;
export function isPromiseLike(value: unknown): value is PromiseLike<unknown>;
