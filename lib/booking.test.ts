import assert from "node:assert/strict";
import test from "node:test";
import {
  filterSlots,
  instantForRelease,
  isClosedDay,
  nextRelease,
  pickSlot,
  saveResult,
  slotsForRelease,
  startRun,
  terminalParts,
  tick,
  type RunState,
} from "./booking.ts";

const ranges = [{ from: "10:00", to: "10:19" }];

test("25 December and 1 January have no release", () => {
  assert.equal(isClosedDay("2026-12-25"), true);
  assert.equal(isClosedDay("2026-01-01"), true);
  assert.equal(isClosedDay("2026-12-24"), false);
  const closed = terminalParts(instantForRelease("2026-12-25", "09:30"));
  assert.equal(nextRelease(closed)?.iso, "2026-12-26");
  assert.equal(nextRelease(closed)?.time, "01:30");
});

test("01:30 keeps any same-day interval inside the operator range", () => {
  const slots = slotsForRelease("2026-11-18", "01:30");
  const matches = filterSlots(slots, ranges, []);
  assert.deepEqual(
    matches.map((slot) => slot.start),
    ["10:00"],
  );
  assert.equal(pickSlot(matches, "earliest")?.start, "10:00");
});

test("21:30 spans 21:00 today through 02:00 tomorrow", () => {
  const slots = slotsForRelease("2026-11-18", "21:30");
  const starts = slots.map((slot) => `${slot.date} ${slot.start}`);
  assert.ok(starts.includes("2026-11-18 21:00"));
  assert.ok(starts.includes("2026-11-19 00:00"));
  assert.ok(starts.includes("2026-11-19 01:00"));
  assert.equal(starts.includes("2026-11-18 10:00"), false);
  const night = filterSlots(slots, [{ from: "21:00", to: "22:30" }], []);
  assert.deepEqual(
    night.map((slot) => slot.start),
    ["21:00", "22:00"],
  );
  assert.equal(pickSlot(night, "latest")?.start, "22:00");
});

test("an empty check refreshes once, then monitors", () => {
  let run = startRun({ phase: "idle" } as RunState);
  const terminal = terminalParts(new Date(Date.UTC(2026, 10, 18, 7, 0, 0)));
  const logs: string[] = [];
  for (let step = 0; step < 12 && run.phase !== "monitoring"; step += 1) {
    const next = tick({
      run,
      ranges,
      priority: "earliest",
      container: "MRKU8134890",
      appointmentDate: "2026-11-18",
      securedContainers: [],
      terminal,
    });
    run = next.run;
    if (next.log) logs.push(next.log);
  }
  assert.equal(run.phase, "monitoring");
  assert.match(logs.join("\n"), /Dismissed/);
  assert.match(logs.join("\n"), /Cleared the appointment date/);
  assert.match(logs.join("\n"), /Monitoring until the next release/);
});

test("a release selects the earliest match and confirms the booking", () => {
  let run = startRun({ phase: "idle" } as RunState);
  const terminal = terminalParts(instantForRelease("2026-11-18", "09:30"));
  const logs: string[] = [];
  for (let step = 0; step < 12 && run.phase !== "secured"; step += 1) {
    const next = tick({
      run,
      ranges,
      priority: "earliest",
      container: "MRKU8134890",
      appointmentDate: "2026-11-18",
      securedContainers: [],
      terminal,
    });
    run = next.run;
    if (next.log) logs.push(next.log);
  }
  assert.equal(run.phase, "secured");
  assert.equal(run.securedSlot?.start, "10:00");
  assert.match(logs.join("\n"), /confirmed the booking/);
});

test("quota moves on and a duplicate stops the window", () => {
  const slots = slotsForRelease("2026-11-18", "13:30");
  const quota = slots.find((slot) => slot.start === "13:00");
  assert.ok(quota);
  assert.equal(saveResult(quota, "MAGU2328375", []), "quota");
  assert.equal(saveResult(quota, "MAGU2328375", ["MAGU2328375"]), "duplicate");

  let run = startRun({ phase: "idle" } as RunState);
  const terminal = terminalParts(instantForRelease("2026-11-18", "13:30"));
  const logs: string[] = [];
  for (let step = 0; step < 16 && run.phase !== "secured"; step += 1) {
    const next = tick({
      run,
      ranges: [{ from: "13:00", to: "14:30" }],
      priority: "earliest",
      container: "MAGU2328375",
      appointmentDate: "2026-11-18",
      securedContainers: [],
      terminal,
    });
    run = next.run;
    if (next.log) logs.push(next.log);
  }
  assert.equal(run.quotaCount, 1);
  assert.equal(run.securedSlot?.start, "14:00");
  assert.match(logs.join("\n"), /quota is reached/);
});
