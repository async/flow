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

export type FlowChange = {
  name?: string;
  input?: unknown;
  store: Record<string, unknown>;
};

export type FlowHandlerReceiver = {
  store: Record<string, unknown>;
  refs: Record<string, SignalLike>;
  resources: Record<string, unknown>;
  dispatch(name: string, input?: unknown): unknown | PromiseLike<unknown>;
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
