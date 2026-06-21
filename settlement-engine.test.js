// Run with: node settlement-engine.test.js  (requires Node 18+, no dependencies)
import assert from "node:assert";
import { calculateSettlement } from "./settlement-engine.js";

function approxEqual(a, b, msg, tol) {
  var tolerance = tol !== undefined ? tol : 0.02;
  assert.ok(Math.abs(a - b) <= tolerance, msg + ": expected " + b + ", got " + a);
}

function verifyNetFlows(expenses, participants, result, label) {
  var paid = {};
  participants.forEach(function(n) { paid[n] = 0; });
  expenses.forEach(function(e) {
    paid[e.paidByName] = (paid[e.paidByName] || 0) + e.amount;
  });
  var flow = {};
  participants.forEach(function(n) { flow[n] = 0; });
  result.transactions.forEach(function(t) {
    flow[t.from] -= t.amount;
    flow[t.to]   += t.amount;
    assert.ok(t.amount >= 0, label + ": negative transaction " + JSON.stringify(t));
  });
  participants.forEach(function(n) {
    var expected = paid[n] - result.perPersonShare;
    approxEqual(flow[n], expected, label + " net-flow " + n, 0.03);
  });
}

// Test 1: simple equal split, one payer
{
  var e1 = [{ description: "Hotel", amount: 600, paidByName: "AA" }];
  var p1 = ["AA", "BB", "CC"];
  var r1 = calculateSettlement(e1, p1);
  approxEqual(r1.total, 600, "T1 total");
  approxEqual(r1.perPersonShare, 200, "T1 share");
  approxEqual(r1.netByPerson["AA"],  400, "T1 AA net");
  approxEqual(r1.netByPerson["BB"], -200, "T1 BB net");
  assert.strictEqual(r1.transactions.length, 2, "T1 tx count");
  verifyNetFlows(e1, p1, r1, "T1");
  console.log("Test 1 passed: simple equal split, one payer");
}

// Test 2: six-person, four payers, two free-riders
{
  var e2 = [
    { description: "Fuel",    amount:  3000, paidByName: "AA" },
    { description: "Hotel",   amount: 12000, paidByName: "BB" },
    { description: "Food",    amount:  4500, paidByName: "CC" },
    { description: "Tickets", amount:  1800, paidByName: "DD" },
  ];
  var p2 = ["AA","BB","CC","DD","EE","FF"];
  var r2 = calculateSettlement(e2, p2);
  var total2 = 3000 + 12000 + 4500 + 1800;
  approxEqual(r2.total, total2, "T2 total");
  approxEqual(r2.perPersonShare, total2 / 6, "T2 share");
  verifyNetFlows(e2, p2, r2, "T2");
  r2.transactions.forEach(function(t) {
    if (t.to === "EE" || t.to === "FF") assert.fail("T2: EE/FF should not receive money");
  });
  console.log("Test 2 passed: six-person, four payers, two free-riders");
}

// Test 3: already even, zero transactions
{
  var e3 = [
    { description: "Lunch",  amount: 100, paidByName: "AA" },
    { description: "Snacks", amount: 100, paidByName: "BB" },
  ];
  var p3 = ["AA","BB"];
  var r3 = calculateSettlement(e3, p3);
  approxEqual(r3.netByPerson["AA"], 0, "T3 AA net");
  approxEqual(r3.netByPerson["BB"], 0, "T3 BB net");
  assert.strictEqual(r3.transactions.length, 0, "T3 tx count should be 0");
  console.log("Test 3 passed: already-even split, zero transactions");
}

// Test 4: multiple expenses per person, realistic road trip Rs.24900/6
{
  var e4 = [
    { description: "Fuel 1",    amount: 2500, paidByName: "AA" },
    { description: "Toll",      amount:  300, paidByName: "AA" },
    { description: "Breakfast", amount:  900, paidByName: "AA" },
    { description: "Hotel 1",   amount: 6000, paidByName: "BB" },
    { description: "Lunch",     amount: 1200, paidByName: "CC" },
    { description: "Dinner",    amount: 1800, paidByName: "CC" },
    { description: "Hotel 2",   amount: 6000, paidByName: "DD" },
    { description: "Snacks",    amount:  600, paidByName: "DD" },
    { description: "Fuel 2",    amount: 2200, paidByName: "EE" },
    { description: "Tea",       amount:  400, paidByName: "EE" },
    { description: "Tickets",   amount: 3000, paidByName: "FF" },
  ];
  var p4 = ["AA","BB","CC","DD","EE","FF"];
  var r4 = calculateSettlement(e4, p4);
  approxEqual(r4.total, 24900, "T4 total");
  approxEqual(r4.perPersonShare, 4150, "T4 share");
  verifyNetFlows(e4, p4, r4, "T4");
  console.log("Test 4 passed: multiple expenses per person, Rs.24900 trip");
}

// Test 5: non-divisible Rs.10000 / 3
{
  var e5 = [{ description: "Hotel", amount: 10000, paidByName: "AA" }];
  var p5 = ["AA","BB","CC"];
  var r5 = calculateSettlement(e5, p5);
  approxEqual(r5.total, 10000, "T5 total");
  var paid5 = r5.transactions.reduce(function(s,t) { return s+t.amount; }, 0);
  approxEqual(paid5, r5.netByPerson["AA"], "T5 AA receives correct total", 0.02);
  verifyNetFlows(e5, p5, r5, "T5");
  console.log("Test 5 passed: non-divisible Rs.10000 / 3 people");
}

// Test 6: toughest rounding — Rs.25000 / 6 (4166.666... per person)
{
  var e6 = [{ description: "All", amount: 25000, paidByName: "AA" }];
  var p6 = ["AA","BB","CC","DD","EE","FF"];
  var r6 = calculateSettlement(e6, p6);
  var paid6 = r6.transactions.reduce(function(s,t) { return s+t.amount; }, 0);
  approxEqual(paid6, r6.netByPerson["AA"], "T6 AA receives correct total", 0.05);
  verifyNetFlows(e6, p6, r6, "T6");
  console.log("Test 6 passed: Rs.25000 / 6, last payer absorbs <=2 paise rounding");
}

// Test 7: two payers, four free-riders
{
  var e7 = [
    { description: "Hotel", amount: 12000, paidByName: "AA" },
    { description: "Food",  amount:  6000, paidByName: "BB" },
  ];
  var p7 = ["AA","BB","CC","DD","EE","FF"];
  var r7 = calculateSettlement(e7, p7);
  approxEqual(r7.total, 18000, "T7 total");
  approxEqual(r7.perPersonShare, 3000, "T7 share");
  verifyNetFlows(e7, p7, r7, "T7");
  console.log("Test 7 passed: two payers, four free-riders (Rs.18000 / 6)");
}

// Test 8: decimal amounts
{
  var e8 = [
    { description: "A", amount: 1111.11, paidByName: "AA" },
    { description: "B", amount: 2222.22, paidByName: "BB" },
    { description: "C", amount: 3333.33, paidByName: "CC" },
  ];
  var p8 = ["AA","BB","CC","DD","EE","FF"];
  var r8 = calculateSettlement(e8, p8);
  approxEqual(r8.total, 6666.66, "T8 total");
  approxEqual(r8.perPersonShare, 1111.11, "T8 share");
  verifyNetFlows(e8, p8, r8, "T8");
  console.log("Test 8 passed: decimal amounts (Rs.6666.66 / 6)");
}

console.log("\nAll 8 settlement engine tests passed.");
