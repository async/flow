import assert from "node:assert/strict";
import test from "node:test";
import { can, flow, inspect } from "@async/flow";
import { toFlowConfig } from "@async/flow/builder";
import { toGraph, toMermaid } from "@async/flow/graph";

function createPaymentGraph() {
  return {
    name: "payment",
    store: {
      step: {
        type: "status",
        initial: "review",
        states: ["method", "review", "submitted", "failed"]
      },
      attempts: {
        type: "signal",
        initial: 0
      }
    },
    on: {
      submit: [
        { type: "guard", signal: "isOnline", reason: "offline", label: "Online" },
        { type: "guard", handler: "canSubmit", reason: "cannot_submit", label: "Can submit" },
        { type: "handler", handler: "chargePayment" },
        { type: "handler", handler: "sendReceipt" },
        { type: "transition", status: "step", from: "review", to: "submitted" }
      ],
      fail: [
        { type: "set", target: "attempts", value: 1 },
        { type: "transition", status: "step", to: "failed" }
      ]
    }
  };
}

test("builder subpath is separate from the root entrypoint", async () => {
  const root = await import("@async/flow");
  const builder = await import("@async/flow/builder");

  assert.equal(root.toFlowConfig, undefined);
  assert.equal(typeof builder.toFlowConfig, "function");
});

test("toFlowConfig compiles graph store on handlers and external signals", async () => {
  const calls = [];
  let online = true;
  const payment = flow(toFlowConfig(createPaymentGraph(), {
    handlers: {
      canSubmit(store, input) {
        return store.step === "review" && Boolean(input?.payment);
      },
      async chargePayment(store, input) {
        calls.push(["charge", store.step, input.payment]);
      },
      sendReceipt(_store, input) {
        calls.push(["receipt", input.receipt]);
      }
    },
    signals: {
      isOnline() {
        return online;
      }
    }
  }));

  assert.equal(payment.step, "review");
  assert.equal(can(payment, "submit", { payment: true }).get(), true);
  assert.deepEqual(payment.explain("submit", { payment: true }), {
    event: "submit",
    allowed: true,
    reason: "allowed",
    source: "transition",
    status: "step",
    current: "review",
    next: "submitted",
    label: "Online"
  });

  await payment.submit({ payment: "card", receipt: "email" });

  assert.equal(payment.step, "submitted");
  assert.deepEqual(calls, [
    ["charge", "review", "card"],
    ["receipt", "email"]
  ]);

  payment.restore({ step: "review", attempts: 0 });
  online = false;

  assert.equal(can(payment, "submit", { payment: true }).get(), false);
  assert.deepEqual(payment.explain("submit", { payment: true }), {
    event: "submit",
    allowed: false,
    reason: "offline",
    source: "guard",
    status: "step",
    current: "review",
    label: "Online"
  });
  await payment.submit({ payment: "card", receipt: "email" });
  assert.equal(payment.step, "review");
});

test("compiled builder flows remain ordinary Flow instances", () => {
  const payment = flow(toFlowConfig(createPaymentGraph(), {
    handlers: {
      canSubmit: () => true,
      chargePayment: () => undefined,
      sendReceipt: () => undefined
    },
    signals: {
      isOnline: true
    }
  }));
  const graph = toGraph(inspect(payment));

  assert.equal(typeof payment.submit, "function");
  assert.equal(graph.statuses.step.current, "review");
  assert.equal(graph.events.submit.transitions[0].to, "submitted");
  assert.match(toMermaid(graph), /state "step" as step/);
});

test("toFlowConfig validates missing bindings and status transitions", () => {
  assert.throws(
    () => toFlowConfig(createPaymentGraph(), {
      handlers: {
        canSubmit: () => true,
        chargePayment: () => undefined
      },
      signals: {
        isOnline: true
      }
    }),
    /missing handler "sendReceipt"/
  );

  assert.throws(
    () => toFlowConfig(createPaymentGraph(), {
      handlers: {
        canSubmit: () => true,
        chargePayment: () => undefined,
        sendReceipt: () => undefined
      }
    }),
    /missing signal "isOnline"/
  );

  const graph = createPaymentGraph();
  graph.on.submit = [
    { type: "transition", status: "step", from: "review", to: "unknown" }
  ];

  assert.throws(
    () => toFlowConfig(graph),
    /not in status "step" states/
  );
});

test("toFlowConfig strict mode rejects unused bindings", () => {
  assert.throws(
    () => toFlowConfig(createPaymentGraph(), {
      handlers: {
        canSubmit: () => true,
        chargePayment: () => undefined,
        sendReceipt: () => undefined,
        unused: () => undefined
      },
      signals: {
        isOnline: true
      }
    }, { strict: true }),
    /unused handlers: unused/
  );
});
