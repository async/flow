import assert from "node:assert/strict";
import test from "node:test";
import { flow, inspect, status, transition } from "@async/flow";
import { FLOW_GRAPH_KIND, toGraph, toMermaid } from "@async/flow/graph";

function createPaymentFlow() {
  return flow({
    store: {
      step: status("method", ["method", "review"]),
      method: status("cash", ["cash", "check"])
    },
    on: {
      SWITCH_CHECK: transition("method", { cash: "check" }),
      SWITCH_CASH: transition("method", { check: "cash" }),
      NEXT: transition("step", { method: "review" }),
      PREVIOUS: transition("step", { review: "method" })
    }
  });
}

test("graph subpath is separate from the root entrypoint", async () => {
  const root = await import("@async/flow");
  const graph = await import("@async/flow/graph");

  assert.equal(root.toGraph, undefined);
  assert.equal(root.toMermaid, undefined);
  assert.equal(typeof graph.toGraph, "function");
  assert.equal(typeof graph.toMermaid, "function");
});

test("toGraph builds status lanes and event transitions from a Flow instance", () => {
  const payment = createPaymentFlow();
  const graph = toGraph(payment, { name: "payment" });

  assert.equal(graph.kind, FLOW_GRAPH_KIND);
  assert.equal(graph.version, 1);
  assert.equal(graph.name, "payment");
  assert.deepEqual(graph.handlers, ["SWITCH_CHECK", "SWITCH_CASH", "NEXT", "PREVIOUS"]);
  assert.deepEqual(graph.statuses.step.states, ["method", "review"]);
  assert.deepEqual(graph.statuses.method.states, ["cash", "check"]);
  assert.deepEqual(graph.events.SWITCH_CHECK, {
    type: "transition",
    name: "SWITCH_CHECK",
    transitions: [
      {
        event: "SWITCH_CHECK",
        status: "method",
        conditional: false,
        from: "cash",
        to: "check"
      }
    ],
    guards: []
  });
  assert.deepEqual(graph.statuses.method.transitions, [
    {
      event: "SWITCH_CHECK",
      status: "method",
      conditional: false,
      from: "cash",
      to: "check"
    },
    {
      event: "SWITCH_CASH",
      status: "method",
      conditional: false,
      from: "check",
      to: "cash"
    }
  ]);
});

test("toGraph accepts an inspection object", () => {
  const payment = createPaymentFlow();
  const graph = toGraph(inspect(payment));

  assert.equal(graph.statuses.step.current, "method");
  assert.equal(graph.events.NEXT.transitions[0].to, "review");
});

test("toMermaid renders a state diagram from a graph", () => {
  const payment = createPaymentFlow();
  const graph = toGraph(payment);

  assert.equal(toMermaid(graph), `stateDiagram-v2
  state "step" as step {
    state "method" as step__method
    state "review" as step__review
    [*] --> step__method
    step__method --> step__review: NEXT
    step__review --> step__method: PREVIOUS
  }
  state "method" as method {
    state "cash" as method__cash
    state "check" as method__check
    [*] --> method__cash
    method__cash --> method__check: SWITCH_CHECK
    method__check --> method__cash: SWITCH_CASH
  }`);
});

test("toMermaid requires a graph", () => {
  const payment = createPaymentFlow();

  assert.throws(() => toMermaid(payment), /requires a Flow graph/);
});
