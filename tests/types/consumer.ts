import {
  asyncSignal,
  can,
  compose,
  createAsyncSignal,
  flow,
  inspect,
  set,
  status
} from "@async/flow";
import { toFlowConfig, type FlowBuilderGraph } from "@async/flow/builder";
import { compose as composeSubpath } from "@async/flow/compose";
import { defineFlow, defineSignal } from "@async/flow/define";
import { toGraph, toMermaid } from "@async/flow/graph";
import { set as coreSet } from "@async/flow/helpers/core";
import { FLOW_INSPECT } from "@async/flow/protocol";
import { createFlow, createSignal } from "@async/flow/runtime";
import { createDefaultScheduler } from "@async/flow/scheduler";
import { createFlow as createFrameworkFlow } from "@async/flow/framework-runtime";
import { asyncSignal as asyncSignalSubpath } from "@async/flow/async-signal";
import { set as stepSet } from "@async/flow/steps";

const counter = flow({
  store: {
    count: 0,
    phase: status("idle", ["idle", "active"] as const)
  },
  on: {
    increment: compose([
      set("count", (store) => Number(store.count) + 1),
      set("phase", "active")
    ])
  }
});

const live = createAsyncSignal(asyncSignal(async () => 1));
const maybe: number | undefined = live.value;
const inspectFn = counter[FLOW_INSPECT];

toMermaid(toGraph(counter));
inspect(counter);
can(counter, "increment");

const graph: FlowBuilderGraph = {
  store: {
    phase: { type: "status", initial: "idle", states: ["idle", "active"] }
  },
  on: {
    activate: [{ type: "transition", status: "phase", from: "idle", to: "active" }]
  }
};

flow(toFlowConfig(graph));
inspectFn().handlers.length;

const definition = defineFlow({
  store: {
    name: defineSignal("Ada")
  }
});
createFlow(definition);
createFrameworkFlow(definition, {
  scheduler: createDefaultScheduler()
});

composeSubpath([coreSet("count", 2)]);
stepSet("count", 3);

const subpathSignal = createAsyncSignal(asyncSignalSubpath(async () => "ready"));
const subpathMaybe: string | undefined = subpathSignal.value;
const signal = createSignal(1);
const next: number = signal.set(2);

void maybe;
void subpathMaybe;
void next;
