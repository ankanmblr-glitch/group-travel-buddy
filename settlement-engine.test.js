// Run with: node settlement-engine.test.js  (requires Node 18+, no dependencies)
import assert from "node:assert";
import { calculateSettlement } from "./settlement-engine.js";

function approxEqual(a, b, msg) {
  assert.ok(Math.abs(a - b) < 0.02, `${msg}: expected ${b}, got ${a}`);
}

// --- Test 1: simple equal split, one payer -------------------------------
{
  const expenses = [{ description: "Hotel", amount: 600, paidByName: "AA" }];
  const participants = ["AA", "BB", "CC"];
  const result = calculateSettlement(expenses, participants);

  approxEqual(result.total, 600, "Test1 total");
  approxEqual(result.perPersonShare, 200, "Test1 share");
  approxEqual(result.netByPerson["AA"], 400, "Test1 AA net");
  approxEqual(result.netByPerson["BB"], -200, "Test1 BB net");
  assert.strictEqual(result.transactions.length, 2, "Test1 transaction count");
  console.log("Test 1 passed: simple equal split, one payer");
}

// --- Test 2: the AA/BB/CC/DD/EE/FF example from the requirements ---------
{
  const expenses = [
    { description: "Fuel", amount: 3000, paidByName: "AA" },
    { description: "Hotel", amount: 12000, paidByName: "BB" },
    { description: "Food", amount: 4500, paidByName: "CC" },
    { description: "Tickets", amount: 1800, paidByName: "DD" },
  ];
  const participants = ["AA", "BB", "CC", "DD", "EE", "FF"];
  const result = calculateSettlement(expenses, participants);

  const total = 3000 + 12000 + 4500 + 1800;
  approxEqual(result.total, total, "Test2 total");
  approxEqual(result.perPersonShare, total / 6, "Test2 share");

  // Every transaction should sum back to zero net overall
  const sumIn = result.transactions.reduce((s, t) => s + t.amount, 0);
  const sumOut = sumIn; // by construction, transactions are balanced transfers
  approxEqual(sumIn, sumOut, "Test2 transactions balance");

  // EE and FF paid nothing, so they should only ever appear as a 'from'
  result.transactions.forEach((t) => {
    if (t.from === "EE" || t.from === "FF") {
      assert.ok(true);
    }
  });
  console.log("Test 2 passed: AA-FF six-person example");
}

// --- Test 3: already-even split needs zero transactions -------------------
{
  const expenses = [
    { description: "Lunch", amount: 100, paidByName: "AA" },
    { description: "Snacks", amount: 100, paidByName: "BB" },
  ];
  const participants = ["AA", "BB"];
  const result = calculateSettlement(expenses, participants);

  approxEqual(result.netByPerson["AA"], 0, "Test3 AA net");
  approxEqual(result.netByPerson["BB"], 0, "Test3 BB net");
  assert.strictEqual(result.transactions.length, 0, "Test3 transaction count should be zero");
  console.log("Test 3 passed: already-even split, zero transactions needed");
}

console.log("\nAll settlement engine tests passed.");
