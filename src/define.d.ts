export type FlowSignalDefinition<T = unknown> = {
  readonly kind: "async.flow.signal";
  readonly initial: T;
};

export type FlowStateDefinition<T = unknown> = FlowSignalDefinition<T> & {
  readonly state: true;
  readonly allowed: readonly T[];
};

export type FlowComputedDefinition<T = unknown> = {
  readonly kind: "async.flow.computed";
  readonly compute: (context: FlowDefinitionContext) => T;
};

export type FlowAsyncSignalDefinition<T = unknown> = {
  readonly kind: "async.flow.asyncSignal";
  readonly loader: (context: FlowDefinitionContext) => T | PromiseLike<T>;
  readonly options: Record<string, unknown>;
};

export type FlowDefinitionContext = {
  flow: unknown;
  signals: Record<string, unknown>;
  refs: Record<string, unknown>;
  input: unknown;
};

export type FlowDefinition = {
  readonly kind: "async.flow.definition";
  readonly signals: Record<string, unknown>;
  readonly on: Record<string, Function>;
};

export function defineSignal<T>(initial: T): FlowSignalDefinition<T>;
export function defineState<T>(initial: T, allowed: readonly T[]): FlowStateDefinition<T>;
export function defineComputed<T>(
  compute: (context: FlowDefinitionContext) => T
): FlowComputedDefinition<T>;
export function defineAsyncSignal<T>(
  loader: (context: FlowDefinitionContext) => T | PromiseLike<T>,
  options?: Record<string, unknown>
): FlowAsyncSignalDefinition<T>;
export function defineFlow(config: {
  signals?: Record<string, unknown>;
  on?: Record<string, Function>;
}): FlowDefinition;
export function isFlowDefinition(value: unknown): value is FlowDefinition;
export function isSignalDefinition(value: unknown): value is FlowSignalDefinition;
export function isStateDefinition(value: unknown): value is FlowStateDefinition;
export function isComputedDefinition(value: unknown): value is FlowComputedDefinition;
export function isAsyncSignalDefinition(value: unknown): value is FlowAsyncSignalDefinition;
export const flow: typeof defineFlow;
export const signal: typeof defineSignal;
export const computed: typeof defineComputed;
export const asyncSignal: typeof defineAsyncSignal;
export const state: typeof defineState;
