export declare const SIGNAL: unique symbol;
export declare const STATUS: unique symbol;
export declare const COMPUTED: unique symbol;
export declare const RESOURCE: unique symbol;
export declare const RESOURCE_IMMEDIATE: unique symbol;

export type FlowSignalDefinition<T = unknown> = {
  readonly kind: "async.flow.signal";
  readonly initial: T;
};

export type FlowStatusDefinition<T = unknown> = {
  readonly kind: "async.flow.status";
  readonly initial: T;
  readonly allowed?: readonly T[];
};

export type FlowComputedDefinition<T = unknown> = {
  readonly kind: "async.flow.computed";
  readonly compute: (store: Record<string, unknown>, context?: FlowDefinitionContext) => T;
};

export type FlowResourceOptions = {
  readonly immediate?: boolean;
} & Record<string, unknown>;

export type FlowResourceDefinition<T = unknown, Input = unknown> = {
  readonly [RESOURCE]: true;
  readonly [RESOURCE_IMMEDIATE]?: true;
  readonly kind: "async.flow.resource";
  readonly options: FlowResourceOptions;
  readonly loader: (
    store: Record<string, unknown>,
    tools: {
      signal: AbortSignal;
      input: Input;
      version: number;
    }
  ) => T | PromiseLike<T>;
};

export type FlowDefinitionContext = {
  describe?(): {
    statuses?: readonly string[];
    transitions?: Record<string, unknown>;
    handlers?: readonly string[];
  };
};

export type FlowDefinition = {
  readonly kind: "async.flow.definition";
  readonly store: Record<string, unknown>;
  readonly on: Record<string, Function>;
};

export function defineSignal<T>(initial: T): FlowSignalDefinition<T>;
export function defineStatus<T>(initial: T, allowed?: readonly T[]): FlowStatusDefinition<T>;
export function defineComputed<T>(
  compute: (store: Record<string, unknown>, context?: FlowDefinitionContext) => T
): FlowComputedDefinition<T>;
export function defineResource<T = unknown, Input = unknown>(
  loader: FlowResourceDefinition<T, Input>["loader"]
): FlowResourceDefinition<T, Input>;
export function defineResource<T = unknown, Input = unknown>(
  options: FlowResourceOptions,
  loader: FlowResourceDefinition<T, Input>["loader"]
): FlowResourceDefinition<T, Input>;
export function defineFlow(config: {
  store?: Record<string, unknown>;
  on?: Record<string, Function>;
}): FlowDefinition;
export function isFlowDefinition(value: unknown): value is FlowDefinition;
export function isSignalDefinition(value: unknown): value is FlowSignalDefinition;
export function isStatusDefinition(value: unknown): value is FlowStatusDefinition;
export function isComputedDefinition(value: unknown): value is FlowComputedDefinition;
export function isResourceDefinition(value: unknown): value is FlowResourceDefinition;
export function isResource(value: unknown): boolean;
export function isImmediateResource(value: unknown): boolean;
export const flow: typeof defineFlow;
export const signal: typeof defineSignal;
export const computed: typeof defineComputed;
export const status: typeof defineStatus;
export const resource: typeof defineResource;
