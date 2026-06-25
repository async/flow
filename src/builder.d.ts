import type { FlowHandler } from "./runtime.js";

export type FlowBuilderStoreStatus = {
  readonly type: "status";
  readonly initial: unknown;
  readonly states: readonly unknown[];
};

export type FlowBuilderStoreSignal = {
  readonly type: "signal";
  readonly initial: unknown;
};

export type FlowBuilderStoreEntry = FlowBuilderStoreStatus | FlowBuilderStoreSignal;

export type FlowBuilderMetadata = {
  readonly reason?: string;
  readonly label?: string;
};

export type FlowBuilderTransitionStep = FlowBuilderMetadata & {
  readonly type: "transition";
  readonly status: string;
  readonly from?: unknown | readonly unknown[];
  readonly to: unknown;
};

export type FlowBuilderGuardStep = FlowBuilderMetadata & {
  readonly type: "guard";
  readonly handler?: string;
  readonly signal?: string;
};

export type FlowBuilderHandlerStep = {
  readonly type: "handler";
  readonly handler: string;
};

export type FlowBuilderSetStep = {
  readonly type: "set";
  readonly target: string;
  readonly value?: unknown;
  readonly from?: string;
};

export type FlowBuilderDispatchStep = {
  readonly type: "dispatch";
  readonly event: string;
  readonly input?: unknown;
};

export type FlowBuilderAfterStep = {
  readonly type: "after";
  readonly ms: number;
  readonly event: string;
  readonly input?: unknown;
};

export type FlowBuilderParallelStep = {
  readonly type: "parallel";
  readonly steps: readonly FlowBuilderStep[];
};

export type FlowBuilderStep =
  | FlowBuilderTransitionStep
  | FlowBuilderGuardStep
  | FlowBuilderHandlerStep
  | FlowBuilderSetStep
  | FlowBuilderDispatchStep
  | FlowBuilderAfterStep
  | FlowBuilderParallelStep;

export type FlowBuilderGraph = {
  readonly name?: string;
  readonly store: Record<string, FlowBuilderStoreEntry>;
  readonly on: Record<string, FlowBuilderStep | readonly FlowBuilderStep[]>;
};

export type FlowBuilderBindings = {
  readonly handlers?: Record<string, FlowHandler>;
  readonly signals?: Record<string, unknown>;
};

export type FlowBuilderOptions = {
  readonly strict?: boolean;
};

export type FlowBuilderConfig = {
  readonly store: Record<string, unknown>;
  readonly on: Record<string, FlowHandler>;
};

export function toFlowConfig(
  graph: FlowBuilderGraph,
  bindings?: FlowBuilderBindings,
  options?: FlowBuilderOptions
): FlowBuilderConfig;
