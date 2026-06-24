import assert from "node:assert/strict";
import test from "node:test";
import {
  AVAILABILITY,
  FLOW_INSTANCE,
  GUARD,
  STANDALONE_AFTER,
  STANDALONE_DISPATCH,
  STANDALONE_TRANSITION,
  TRANSITION,
  after,
  bool,
  can,
  dispatch,
  every,
  flow,
  guard,
  inspect,
  matches,
  not,
  set,
  some,
  status,
  transition,
  update,
  when
} from "@async/flow";
import { compose } from "@async/flow/compose";

test("status stores values in writable Flow refs and validates writes", () => {
  const checkout = flow({
    store: {
      step: status("shipping", ["shipping", "payment", "review"])
    }
  });

  assert.equal(checkout.refs.step.type, "status");
  checkout.store.step = "payment";
  assert.equal(checkout.store.step, "payment");
  assert.throws(
    () => {
      checkout.store.step = "done";
    },
    /Invalid status value/
  );
});

test("transition writes matching status changes and no-ops when no rule matches", () => {
  const checkout = flow({
    store: {
      step: status("shipping", ["shipping", "payment", "review"])
    },
    on: {
      next: transition("step", {
        shipping: "payment",
        payment: "review"
      })
    }
  });

  assert.equal(checkout.next(), undefined);
  assert.equal(checkout.store.step, "payment");
  checkout.next();
  assert.equal(checkout.store.step, "review");
  checkout.next();
  assert.equal(checkout.store.step, "review");
});

test("standalone status transition can and matches helpers track live refs", () => {
  const phase = status("idle", ["idle", "dragging", "dropped"]);
  const startDragging = transition(phase, {
    idle: "dragging"
  });
  const drop = transition(phase, {
    dragging: "dropped"
  });
  const canStartDragging = can(startDragging);
  const canDrop = can(drop);
  const isDragging = matches(phase, "dragging");

  assert.equal(startDragging[TRANSITION], undefined);
  assert.equal(startDragging[STANDALONE_TRANSITION].target, phase);
  assert.equal(startDragging[Symbol.for("@async/flow.standaloneTransition")].target, phase);
  assert.equal(canStartDragging.get(), true);
  assert.equal(canDrop.get(), false);
  assert.equal(isDragging.get(), false);

  assert.equal(startDragging(), undefined);
  assert.equal(phase.get(), "dragging");
  assert.equal(canStartDragging.get(), false);
  assert.equal(canDrop.get(), true);
  assert.equal(isDragging.get(), true);

  assert.equal(drop(), undefined);
  assert.equal(phase.get(), "dropped");
  assert.equal(canDrop.get(), false);
});

test("standalone after schedules callbacks and can be cancelled", async () => {
  const phase = status("idle", ["idle", "ready", "cancelled"]);
  const markReady = after(0, (next) => {
    phase.set(next);
  }, "ready");

  assert.equal(markReady[STANDALONE_AFTER].ms, 0);
  assert.equal(markReady[Symbol.for("@async/flow.standaloneAfter")].ms, 0);
  assert.deepEqual(inspect(markReady), {
    type: "after",
    ms: 0
  });

  const cancelReady = markReady();
  assert.equal(typeof cancelReady, "function");
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(phase.get(), "ready");

  const markCancelled = after(5, () => {
    phase.set("cancelled");
  });
  const cancelCancelled = markCancelled();
  cancelCancelled();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(phase.get(), "ready");
});

test("standalone dispatch sender works with Flow DOM emitter and sender targets", () => {
  const checkout = flow({
    store: {
      lastReady: null
    },
    on: {
      ready(store, input) {
        store.lastReady = input.id;
        return `flow:${input.id}`;
      }
    }
  });
  const ready = dispatch("ready", { id: 1 });

  assert.equal(ready[STANDALONE_DISPATCH].event, "ready");
  assert.equal(ready[STANDALONE_DISPATCH].payload, true);
  assert.equal(ready[Symbol.for("@async/flow.standaloneDispatch")].event, "ready");
  assert.deepEqual(inspect(ready), {
    type: "dispatch",
    event: "ready",
    payload: true
  });

  assert.equal(ready.call(checkout), "flow:1");
  assert.equal(checkout.store.lastReady, 1);

  const target = new EventTarget();
  let receivedEvent;
  target.addEventListener("ready", (event) => {
    receivedEvent = event;
  });

  assert.equal(ready.call(target), true);
  assert.equal(receivedEvent.type, "ready");
  assert.equal(receivedEvent.bubbles, true);
  assert.equal(receivedEvent.composed, true);
  assert.deepEqual(receivedEvent.detail, { id: 1 });
  assert.equal(receivedEvent[STANDALONE_DISPATCH], true);

  const emitter = {
    calls: [],
    emit(eventName, payload) {
      this.calls.push([eventName, payload]);
      return "emitted";
    }
  };
  assert.equal(ready.emit(emitter, { id: 2 }), "emitted");
  assert.deepEqual(emitter.calls, [["ready", { id: 2 }]]);

  const sender = {
    calls: [],
    send(eventName, payload) {
      this.calls.push([eventName, payload]);
      return "sent";
    }
  };
  assert.equal(ready.send(sender, { id: 3 }), "sent");
  assert.deepEqual(sender.calls, [["ready", { id: 3 }]]);
  assert.equal(ready(), false);
});

test("dispatch immediately targets Flow DOM emitter and sender sinks", () => {
  const checkout = flow({
    store: {
      lastReady: null
    },
    on: {
      start() {
        return dispatch(this, "ready", { id: 4 });
      },
      ready(store, input) {
        store.lastReady = input.id;
        return `ready:${input.id}`;
      }
    }
  });

  assert.equal(dispatch(checkout, "ready", { id: 5 }), "ready:5");
  assert.equal(checkout.store.lastReady, 5);
  assert.throws(() => dispatch(checkout, "missing"), /Unknown Flow handler/);
  assert.equal(checkout.start(), "ready:4");
  assert.equal(checkout.store.lastReady, 4);

  const target = new EventTarget();
  let plainEvent;
  target.addEventListener("plain", (event) => {
    plainEvent = event;
  });
  assert.equal(dispatch(target, "plain"), true);
  assert.equal(plainEvent.type, "plain");
  assert.equal(plainEvent.bubbles, true);
  assert.equal(plainEvent.composed, true);
  assert.equal("detail" in plainEvent, false);
  assert.equal(plainEvent[STANDALONE_DISPATCH], true);

  const emitter = {
    emit(eventName, payload) {
      return [eventName, payload];
    }
  };
  assert.deepEqual(dispatch(emitter, "ready", { id: 6 }), ["ready", { id: 6 }]);

  const sender = {
    send(eventName, payload) {
      return [eventName, payload];
    }
  };
  assert.deepEqual(dispatch(sender, "ready", { id: 7 }), ["ready", { id: 7 }]);
});

test("dispatch target selection is best effort with stable precedence", () => {
  assert.equal(dispatch({}, "ready"), false);
  assert.equal(dispatch(undefined, "ready"), false);
  assert.throws(() => dispatch({}, ""), /dispatch\(\.\.\.\) requires an event name/);

  const mixed = {
    [FLOW_INSTANCE]: true,
    dispatch(eventName, payload) {
      return ["flow", eventName, payload];
    },
    explain() {
      return { allowed: true };
    },
    dispatchEvent() {
      throw new Error("DOM path should not run.");
    },
    emit() {
      throw new Error("emitter path should not run.");
    },
    send() {
      throw new Error("sender path should not run.");
    }
  };
  assert.deepEqual(dispatch(mixed, "ready", { id: 8 }), ["flow", "ready", { id: 8 }]);

  const restoreCustomEvent = replaceGlobal("CustomEvent", undefined);
  try {
    assert.equal(dispatch(new EventTarget(), "ready", { id: 9 }), false);
  } finally {
    restoreCustomEvent();
  }

  const restoreEvent = replaceGlobal("Event", undefined);
  try {
    assert.equal(dispatch(new EventTarget(), "ready"), false);
  } finally {
    restoreEvent();
  }
});

test("inspect returns safe standalone helper metadata", () => {
  const phase = status("idle", ["idle", "dragging", "dropped"]);
  const startDragging = transition(phase, {
    idle: "dragging"
  });
  const canStartDragging = can(startDragging);

  assert.deepEqual(inspect(phase), {
    type: "status",
    value: "idle",
    allowed: ["idle", "dragging", "dropped"]
  });
  assert.deepEqual(inspect(startDragging), {
    type: "transition",
    target: {
      type: "status",
      value: "idle",
      allowed: ["idle", "dragging", "dropped"]
    },
    rules: [
      {
        conditional: false,
        from: "idle",
        to: "dragging"
      }
    ]
  });
  assert.deepEqual(inspect(canStartDragging), {
    type: "computed",
    value: true
  });

  startDragging();
  assert.equal(inspect(phase).value, "dragging");
  assert.equal(inspect(canStartDragging).value, false);
});

test("set update and boolean helpers work directly with standalone refs", () => {
  const phase = status("idle", ["idle", "dragging", "dropped"]);
  const enabled = status(false, [false, true]);
  const isDragging = matches(phase, "dragging");
  const canDrop = every(isDragging, enabled);
  const canStart = some(matches(phase, "idle"), enabled);
  const disabled = not(enabled);
  const enabledNow = bool(enabled);

  assert.equal(canDrop.get(), false);
  assert.equal(canStart.get(), true);
  assert.equal(disabled.get(), true);
  assert.equal(enabledNow.get(), false);

  set(phase, "dragging")();
  assert.equal(phase.get(), "dragging");
  assert.equal(canDrop.get(), false);

  update(enabled, (current) => !current)();
  assert.equal(enabled.get(), true);
  assert.equal(canDrop.get(), true);
  assert.equal(canStart.get(), true);
  assert.equal(disabled.get(), false);
  assert.equal(enabledNow.get(), true);

  set(phase, (_store, input) => input.next)(undefined, { next: "dropped" });
  assert.equal(phase.get(), "dropped");
  assert.equal(canDrop.get(), false);
});

test("transition resolves string targets from branded Flow receivers", () => {
  const checkout = flow({
    store: {
      step: status("shipping", ["shipping", "payment"])
    }
  });
  const move = transition("step", {
    from: "shipping",
    to: "payment",
    when(store) {
      return store.step === "shipping";
    }
  });

  assert.equal(checkout[Symbol.for("@async/flow.instance")], true);
  assert.deepEqual(inspect(move), {
    type: "transition",
    status: "step",
    rules: [
      {
        conditional: true,
        from: "shipping",
        to: "payment"
      }
    ]
  });
  assert.equal(move.call(checkout), undefined);
  assert.equal(checkout.store.step, "payment");
});

test("guard skips the handler when the predicate is false", () => {
  const checkout = flow({
    store: {
      step: status("payment", ["shipping", "payment", "review"]),
      submitted: false
    },
    on: {
      submit: guard(
        (store) => store.step === "review",
        set("submitted", true)
      )
    }
  });

  assert.equal(checkout.submit(), undefined);
  assert.equal(checkout.store.submitted, false);

  checkout.store.step = "review";
  checkout.submit();
  assert.equal(checkout.store.submitted, true);
});

test("transition and guard metadata use public symbols", () => {
  const move = transition("step", { shipping: "payment" });
  const guarded = guard(() => true, move);
  const availability = when(() => true, {
    availability: true,
    reason: "ready_required",
    label: "Ready"
  });

  assert.equal(move[TRANSITION].status, "step");
  assert.deepEqual(move[TRANSITION].rules, [
    {
      from: "shipping",
      to: "payment",
      when: undefined
    }
  ]);
  assert.equal(guarded[TRANSITION], move[TRANSITION]);
  assert.equal(typeof guarded[GUARD].predicate, "function");
  assert.equal(typeof availability[AVAILABILITY].predicate, "function");
  assert.equal(availability[AVAILABILITY].reason, "ready_required");
  assert.equal(availability[AVAILABILITY].label, "Ready");
  assert.equal(Object.hasOwn(move, "_flowTransition"), false);
  assert.equal(Object.hasOwn(guarded, "_flowTransition"), false);
  assert.equal(Object.hasOwn(availability, "_flowAvailability"), false);
});

test("strict helpers work inside compose pipelines", () => {
  const checkout = flow({
    store: {
      step: status("shipping", ["shipping", "payment"]),
      moved: false
    },
    on: {
      next: compose([
        transition("step", { shipping: "payment" }),
        set("moved", true)
      ])
    }
  });

  checkout.next();
  assert.equal(checkout.store.step, "payment");
  assert.equal(checkout.store.moved, true);
});

test("compose lifts leading availability gates into event inspection", () => {
  const checkout = flow({
    store: {
      readyToSubmit: false,
      loading: false,
      canSubmitNow: can("submit")
    },
    on: {
      submit: compose([
        when((store, input) => store.readyToSubmit && input?.confirm === true, {
          availability: true,
          reason: "not_ready",
          label: "Submit order"
        }),
        set("loading", true)
      ])
    }
  });

  assert.equal(can(checkout, "submit", { confirm: true }).get(), false);
  assert.equal(checkout.store.canSubmitNow, false);
  assert.deepEqual(checkout.explain("submit", { confirm: true }), {
    event: "submit",
    allowed: false,
    reason: "not_ready",
    source: "guard",
    label: "Submit order"
  });
  assert.deepEqual(inspect(checkout).guards.submit, {
    conditional: true,
    reason: "not_ready",
    label: "Submit order"
  });
  assert.equal(Object.hasOwn(inspect(checkout).guards.submit, "predicate"), false);
  assert.equal(checkout.submit({ confirm: true }), undefined);
  assert.equal(checkout.store.loading, false);

  checkout.store.readyToSubmit = true;
  assert.equal(can(checkout, "submit", { confirm: true }).get(), true);
  assert.deepEqual(checkout.explain("submit", { confirm: true }), {
    event: "submit",
    allowed: true,
    reason: "allowed",
    source: "guard",
    label: "Submit order"
  });
  checkout.submit({ confirm: true });
  assert.equal(checkout.store.loading, true);
});

test("multiple leading availability gates report the first failed gate", () => {
  const checkout = flow({
    store: {
      accountReady: false,
      submitted: false
    },
    on: {
      submit: compose([
        when((store) => store.accountReady, {
          availability: true,
          reason: "account_not_ready",
          label: "Account ready"
        }),
        when((_store, input) => input?.confirm === true, {
          availability: true,
          reason: "confirm_required",
          label: "Confirm submit"
        }),
        set("submitted", true)
      ])
    }
  });

  assert.deepEqual(checkout.explain("submit", { confirm: false }), {
    event: "submit",
    allowed: false,
    reason: "account_not_ready",
    source: "guard",
    label: "Account ready"
  });

  checkout.store.accountReady = true;
  assert.deepEqual(checkout.explain("submit", { confirm: false }), {
    event: "submit",
    allowed: false,
    reason: "confirm_required",
    source: "guard",
    label: "Confirm submit"
  });

  assert.equal(can(checkout, "submit", { confirm: true }).get(), true);
  checkout.submit({ confirm: true });
  assert.equal(checkout.store.submitted, true);
});

test("availability metadata does not bleed from later gates", () => {
  const checkout = flow({
    store: {
      ready: false
    },
    on: {
      submit: compose([
        when((store) => store.ready, {
          availability: true
        }),
        when(() => false, {
          availability: true,
          reason: "later_failed",
          label: "Later gate"
        })
      ])
    }
  });

  assert.deepEqual(checkout.explain("submit"), {
    event: "submit",
    allowed: false,
    reason: "guard_failed",
    source: "guard"
  });
});

test("compose does not lift later availability gates", () => {
  const checkout = flow({
    store: {
      touched: false,
      ready: false,
      submitted: false
    },
    on: {
      submit: compose([
        set("touched", true),
        when((store) => store.ready, {
          availability: true,
          reason: "not_ready"
        }),
        set("submitted", true)
      ])
    }
  });

  assert.equal(can(checkout, "submit").get(), true);
  assert.deepEqual(checkout.explain("submit"), {
    event: "submit",
    allowed: true,
    reason: "plain_handler",
    source: "handler"
  });

  checkout.submit();
  assert.equal(checkout.store.touched, true);
  assert.equal(checkout.store.submitted, false);
});

test("can and matches compute from strict transition metadata and status values", () => {
  const checkout = flow({
    store: {
      step: status("shipping", ["shipping", "payment"]),
      canNext: can("step", "next"),
      inPayment: matches("step", "payment")
    },
    on: {
      next: transition("step", { shipping: "payment" })
    }
  });

  assert.equal(checkout.store.canNext, true);
  assert.equal(checkout.store.inPayment, false);

  checkout.next();

  assert.equal(checkout.store.canNext, false);
  assert.equal(checkout.store.inPayment, true);
});

test("boolean condition helpers compose status matches predicates and can checks", () => {
  const checkout = flow({
    store: {
      phase: status("idle", ["idle", "dragging", "overTarget"]),
      cardId: null,
      overColumnId: null,
      dropped: false,
      dragging: matches("phase", ["dragging", "overTarget"]),
      dropReady: every(
        matches("phase", "overTarget"),
        (store) => store.cardId,
        (store) => store.overColumnId
      ),
      blocked: not(can("drop")),
      hasTarget: bool((store) => store.overColumnId),
      idleOrTargeted: some(
        matches("phase", "idle"),
        (store) => store.overColumnId
      ),
      contextReady: bool((store) => store.phase === "idle")
    },
    on: {
      start: set({
        phase: "dragging",
        cardId: "card-1"
      }),
      over: set({
        phase: "overTarget",
        overColumnId: "done"
      }),
      drop: guard(
        every(
          matches("phase", "overTarget"),
          (store) => store.cardId,
          (store) => store.overColumnId
        ),
        set("dropped", true)
      )
    }
  });

  assert.equal(checkout.store.dragging, false);
  assert.equal(checkout.store.dropReady, false);
  assert.equal(checkout.store.blocked, true);
  assert.equal(checkout.store.hasTarget, false);
  assert.equal(checkout.store.idleOrTargeted, true);
  assert.equal(checkout.store.contextReady, true);

  checkout.start();
  assert.equal(checkout.store.dragging, true);
  assert.equal(checkout.store.dropReady, false);
  assert.equal(checkout.store.blocked, true);

  checkout.over();
  assert.equal(checkout.store.dropReady, true);
  assert.equal(checkout.store.blocked, false);
  assert.equal(checkout.store.hasTarget, true);
  assert.equal(can(checkout, "drop").get(), true);

  checkout.drop();
  assert.equal(checkout.store.dropped, true);
});

test("boolean condition helpers reject store key strings", () => {
  assert.throws(
    () => bool("missing"),
    /bool\(\.\.\.\) requires a boolean condition/
  );
});

test("flow can and explain cover unknown plain transition and conditioned events", () => {
  const checkout = flow({
    store: {
      step: status("shipping", ["shipping", "payment", "review"]),
      attempts: 0,
      canNext: can("next"),
      canNextForStep: can("step", "next")
    },
    on: {
      ping() {
        return "pong";
      },
      next: transition("step", [
        {
          from: "shipping",
          to: "payment",
          when(store, input) {
            store.attempts += 1;
            return input?.allow === true;
          },
          reason: "cannot_continue",
          label: "Continue"
        },
        {
          from: "payment",
          to: "review"
        }
      ])
    }
  });

  assert.equal(can(checkout, "missing").get(), false);
  assert.deepEqual(checkout.explain("missing"), {
    event: "missing",
    allowed: false,
    reason: "unknown_event"
  });
  assert.equal(can(checkout, "ping").get(), true);
  assert.deepEqual(checkout.explain("ping"), {
    event: "ping",
    allowed: true,
    reason: "plain_handler",
    source: "handler"
  });
  assert.equal(can(checkout, "next", { allow: false }).get(), false);
  assert.equal(checkout.store.attempts, 0);
  assert.deepEqual(checkout.explain("next", { allow: false }), {
    event: "next",
    allowed: false,
    reason: "cannot_continue",
    source: "transition",
    status: "step",
    current: "shipping",
    label: "Continue"
  });
  assert.equal(can(checkout, "next", { allow: true }).get(), true);
  assert.deepEqual(checkout.explain("next", { allow: true }), {
    event: "next",
    allowed: true,
    reason: "allowed",
    source: "transition",
    status: "step",
    current: "shipping",
    label: "Continue",
    next: "payment"
  });
  assert.equal(checkout.store.canNext, false);
  assert.equal(checkout.store.canNextForStep, false);

  checkout.next({ allow: true });
  assert.equal(checkout.store.step, "payment");
  assert.equal(checkout.store.canNext, true);
  assert.equal(checkout.store.canNextForStep, true);

  checkout.next();
  assert.equal(checkout.store.step, "review");
  assert.equal(can(checkout, "next").get(), false);
  assert.equal(checkout.explain("next").reason, "no_matching_transition");
});

test("status matches and can helpers work as standalone computed refs", () => {
  const phase = status("idle", ["idle", "dragging"]);
  const dragging = matches(phase, "dragging");

  assert.equal(dragging.get(), false);
  phase.set("dragging");
  assert.equal(dragging.get(), true);

  const checkout = flow({
    store: {
      step: status("shipping", ["shipping", "payment"]),
      approved: false
    },
    on: {
      next: transition("step", {
        from: "shipping",
        to: "payment",
        when: (store) => store.approved
      })
    }
  });
  const canGoNext = can(checkout, "next");

  assert.equal(canGoNext.get(), false);
  checkout.store.approved = true;
  assert.equal(canGoNext.get(), true);
});

test("transition rules accept composed boolean conditions", () => {
  const checkout = flow({
    store: {
      step: status("shipping", ["shipping", "payment"]),
      approved: false,
      canNext: can("next")
    },
    on: {
      next: transition("step", {
        from: "shipping",
        to: "payment",
        when: every(matches("step", "shipping"), (store) => store.approved),
        reason: "approval_required"
      })
    }
  });

  assert.equal(can(checkout, "next").get(), false);
  assert.equal(checkout.store.canNext, false);
  assert.deepEqual(checkout.explain("next"), {
    event: "next",
    allowed: false,
    reason: "approval_required",
    source: "transition",
    status: "step",
    current: "shipping"
  });

  checkout.store.approved = true;
  assert.equal(can(checkout, "next").get(), true);
  assert.equal(checkout.store.canNext, true);

  checkout.next();
  assert.equal(checkout.store.step, "payment");
});

test("guarded events explain blocked and allowed outcomes with receiver helpers", () => {
  const checkout = flow({
    store: {
      step: status("review", ["review", "submitted"]),
      canSubmit: false,
      submitted: false,
      canSubmitNow: can("submit")
    },
    on: {
      submit: guard(
        (store, input) => {
          store.canSubmit = true;
          return input?.confirm === true && store.step === "review";
        },
        transition("step", {
          review: "submitted"
        }),
        {
          reason: "cannot_submit",
          label: "Submit order"
        }
      ),
      audit(store, input) {
        return [
          can(this, "submit", input).get(),
          this.explain("submit", input).reason,
          inspect(this).handlers
        ];
      }
    }
  });

  assert.equal(can(checkout, "submit", { confirm: false }).get(), false);
  assert.equal(checkout.store.canSubmit, false);
  assert.deepEqual(checkout.explain("submit", { confirm: false }), {
    event: "submit",
    allowed: false,
    reason: "cannot_submit",
    source: "guard",
    status: "step",
    current: "review",
    label: "Submit order"
  });
  assert.equal(checkout.store.canSubmitNow, false);
  assert.deepEqual(checkout.audit({ confirm: false }), [
    false,
    "cannot_submit",
    ["submit", "audit"]
  ]);

  assert.equal(can(checkout, "submit", { confirm: true }).get(), true);
  assert.deepEqual(checkout.explain("submit", { confirm: true }), {
    event: "submit",
    allowed: true,
    reason: "allowed",
    source: "transition",
    status: "step",
    current: "review",
    label: "Submit order",
    next: "submitted"
  });
  checkout.submit({ confirm: true });
  assert.equal(checkout.store.step, "submitted");
});

function replaceGlobal(name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);

  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value
  });

  return () => {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      delete globalThis[name];
    }
  };
}
