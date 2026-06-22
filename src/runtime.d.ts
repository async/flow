export type FlowScheduler = {
  batch<T>(fn: () => T): T;
  enqueue?(fn: () => void): void;
  flush?(): Promise<void>;
};

export type Signal<T = unknown> = {
  readonly kind: "signal";
  value: T;
  get(): T;
  set(next: T): T;
  update(fn: (current: T) => T): T;
  subscribe(fn: (value: T) => void): () => void;
  snapshot(): T;
};

export type Status<T = unknown> = Signal<T> & {
  readonly kind: "status";
  readonly allowed?: readonly T[];
};

export type Computed<T = unknown> = {
  readonly kind: "computed";
  readonly value: T;
  get(): T;
  subscribe(fn: (value: T) => void): () => void;
  snapshot(): T;
};

export type SignalLike<T = unknown> = Signal<T> | Status<T> | Computed<T>;

export type ResourceSnapshot<T = unknown> = {
  value: T | undefined;
  status: "idle" | "loading" | "ready" | "error";
  error: unknown;
  version: number;
};

export type Resource<T = unknown, Input = unknown> = {
  readonly kind: "resource";
  readonly value: T | undefined;
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly loading: boolean;
  readonly ready: boolean;
  readonly error: unknown;
  readonly version: number;
  load(input?: Input): T | PromiseLike<T>;
  reload(input?: Input): PromiseLike<T>;
  set(next: T): T;
  cancel(reason?: unknown): "idle" | "loading" | "ready" | "error";
  subscribe(fn: (resource: Resource<T, Input>) => void): () => void;
  snapshot(): ResourceSnapshot<T>;
  restore(snapshot: ResourceSnapshot<T> | T): void;
};

export type FlowChange = {
  name?: string;
  input?: unknown;
  store: Record<string, unknown>;
};

export type FlowStoreDescriptionEntry = {
  kind: string;
  writable: boolean;
  value: unknown;
  allowed?: readonly unknown[];
};

export type FlowResourceDescription = {
  kind: "resource";
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
  resources: Record<string, FlowResourceDescription>;
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
  store: Record<string, unknown>;
  refs: Record<string, SignalLike>;
  resources: Record<string, unknown>;
  dispatch(name: string, input?: unknown): unknown | PromiseLike<unknown>;
  can(eventName: string, input?: unknown): boolean;
  explain(eventName: string, input?: unknown): FlowEventExplanation;
  describe(): FlowDescription;
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
  readonly resources: Record<string, unknown>;
  snapshot(): Record<string, unknown>;
  restore(snapshot: Record<string, unknown>): void;
};

export type FlowInstance = {
  readonly store: Record<string, unknown>;
  readonly refs: Record<string, SignalLike>;
  readonly resources: Record<string, unknown>;
  readonly handlers: Record<string, (input?: unknown) => unknown | PromiseLike<unknown>>;
  get(name: string): unknown;
  set(name: string, value: unknown): unknown;
  update(name: string, fn: (value: unknown) => unknown): unknown;
  subscribe(name: string, fn: (value: unknown) => void): () => void;
  subscribe(fn: (change: FlowChange) => void): () => void;
  dispatch(name: string, input?: unknown): unknown | PromiseLike<unknown>;
  can(eventName: string, input?: unknown): boolean;
  explain(eventName: string, input?: unknown): FlowEventExplanation;
  describe(): FlowDescription;
  snapshot(): Record<string, unknown>;
  restore(snapshot: Record<string, unknown>): void;
  destroy(): void;
};

export function createSignal<T>(initial: T, options?: { scheduler?: FlowScheduler }): Signal<T>;
export function createStatus<T>(
  initial: T,
  allowed?: readonly T[],
  options?: { scheduler?: FlowScheduler; name?: string }
): Status<T>;
export function createComputed<T>(compute: () => T, options?: { scheduler?: FlowScheduler }): Computed<T>;
export function createResource<T = unknown, Input = unknown>(
  loader: (
    store: Record<string, unknown>,
    tools: { signal: AbortSignal; input: Input; version: number }
  ) => T | PromiseLike<T>,
  runtimeOptions?: { scheduler?: FlowScheduler; store?: Record<string, unknown>; name?: string }
): Resource<T, Input>;
export function createResource<T = unknown, Input = unknown>(
  options: { immediate?: boolean } & Record<string, unknown>,
  loader: (
    store: Record<string, unknown>,
    tools: { signal: AbortSignal; input: Input; version: number }
  ) => T | PromiseLike<T>,
  runtimeOptions?: { scheduler?: FlowScheduler; store?: Record<string, unknown>; name?: string }
): Resource<T, Input>;
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
