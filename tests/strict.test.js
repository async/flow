import assert from "node:assert/strict";
import test from "node:test";
import {
  can,
  flow,
  guard,
  matches,
  set,
  state,
  transition
} from "@async/flow";
import { run } from "@async/flow/run";

test("state stores values in ordinary writable Flow signals and validates writes", () => {
  const checkout = flow({
    signals: {
      step: state("shipping", ["shipping", "payment", "review"])
    }
  });

  assert.equal(checkout.refs.step.kind, "signal");
  checkout.signals.step = "payment";
  assert.equal(checkout.signals.step, "payment");
  assert.throws(
    () => {
      checkout.signals.step = "done";
    },
    /Invalid state value/
  );
});

test("transition writes matching state changes and no-ops when no rule matches", () => {
  const checkout = flow({
    signals: {
      step: state("shipping", ["shipping", "payment", "review"])
    },
    on: {
      next: transition([
        { from: "shipping", to: "payment" },
        { from: "payment", to: "review" }
      ])
    }
  });

  assert.equal(checkout.next(), undefined);
  assert.equal(checkout.signals.step, "payment");
  checkout.next();
  assert.equal(checkout.signals.step, "review");
  checkout.next();
  assert.equal(checkout.signals.step, "review");
});

test("guard skips the handler when the predicate is false", () => {
  const checkout = flow({
    signals: {
      step: state("payment", ["shipping", "payment", "review"]),
      submitted: false
    },
    on: {
      submit: guard(
        ({ signals }) => signals.step === "review",
        set("submitted", true)
      )
    }
  });

  assert.equal(checkout.submit(), undefined);
  assert.equal(checkout.signals.submitted, false);

  checkout.signals.step = "review";
  checkout.submit();
  assert.equal(checkout.signals.submitted, true);
});

test("strict helpers work inside run pipelines", () => {
  const checkout = flow({
    signals: {
      step: state("shipping", ["shipping", "payment"]),
      moved: false
    },
    on: {
      next: run([
        transition([{ from: "shipping", to: "payment" }]),
        set("moved", true)
      ])
    }
  });

  checkout.next();
  assert.equal(checkout.signals.step, "payment");
  assert.equal(checkout.signals.moved, true);
});

test("can and matches compute from strict transition metadata and state signal values", () => {
  const checkout = flow({
    signals: {
      step: state("shipping", ["shipping", "payment"]),
      canNext: can("next"),
      inPayment: matches("payment")
    },
    on: {
      next: transition([{ from: "shipping", to: "payment" }])
    }
  });

  assert.equal(checkout.signals.canNext, true);
  assert.equal(checkout.signals.inPayment, false);

  checkout.next();

  assert.equal(checkout.signals.canNext, false);
  assert.equal(checkout.signals.inPayment, true);
});
