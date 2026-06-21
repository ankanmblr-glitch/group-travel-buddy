// ============================================================================
// SETTLEMENT ENGINE (v2) — pure functions, no Firebase/DOM dependency.
//
// Supports per-expense "splitAmong" so an expense can be shared by a subset
// of the group rather than always dividing among everyone.
//
// When splitAmong is absent or empty, the expense splits equally among ALL
// participants (backward-compatible with v1 expenses).
// ============================================================================

/**
 * @param {Array<{
 *   description: string,
 *   amount: number,
 *   paidByName: string,
 *   splitAmong?: string[]  // who shares this expense; defaults to all participants
 * }>} expenses
 * @param {Array<string>} participantNames
 * @returns {{
 *   total: number,
 *   perPersonShare: number,   // approximate; only exact when all splits are equal
 *   paidByPerson: Record<string, number>,
 *   netByPerson: Record<string, number>,
 *   transactions: Array<{from:string, to:string, amount:number}>
 * }}
 */
export function calculateSettlement(expenses, participantNames) {
  const EPSILON = 0.005;

  if (!participantNames || participantNames.length === 0) {
    throw new Error("At least one participant is required.");
  }

  const total = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);

  // net > 0: this person is owed money (creditor)
  // net < 0: this person owes money (debtor)
  const netByPerson = {};
  participantNames.forEach(function(n) { netByPerson[n] = 0; });

  // How much each person paid out of pocket (for reporting)
  const paidByPerson = {};
  participantNames.forEach(function(n) { paidByPerson[n] = 0; });

  expenses.forEach(function(e) {
    var amount = Number(e.amount || 0);
    if (!amount) return;

    var paidBy = e.paidByName;

    // Determine who shares this expense
    var among = (e.splitAmong && e.splitAmong.length > 0)
      ? e.splitAmong
      : participantNames;
    var share = amount / among.length;

    // Credit the payer the full amount
    if (netByPerson[paidBy] === undefined) netByPerson[paidBy] = 0;
    netByPerson[paidBy] += amount;

    paidByPerson[paidBy] = (paidByPerson[paidBy] || 0) + amount;

    // Debit each sharer their portion
    among.forEach(function(n) {
      if (netByPerson[n] === undefined) netByPerson[n] = 0;
      netByPerson[n] -= share;
    });
  });

  var transactions = greedySettle(netByPerson, EPSILON);

  // perPersonShare is only accurate when all expenses split equally among all
  // participants. Provided for display convenience.
  var perPersonShare = participantNames.length > 0 ? total / participantNames.length : 0;

  return {
    total: round2(total),
    perPersonShare: round2(perPersonShare),
    paidByPerson: paidByPerson,
    netByPerson: netByPerson,
    transactions: transactions,
  };
}

function greedySettle(netByPerson, epsilon) {
  // Mutable copy of balances
  var balances = Object.keys(netByPerson).map(function(name) {
    return { name: name, net: netByPerson[name] };
  });
  var transactions = [];
  var safety = 0;
  var maxIter = balances.length * balances.length + 10;

  while (safety++ < maxIter) {
    // Largest creditor and largest debtor
    var creditor = balances.reduce(function(a, b) { return b.net > a.net ? b : a; }, balances[0]);
    var debtor   = balances.reduce(function(a, b) { return b.net < a.net ? b : a; }, balances[0]);

    if (creditor.net < epsilon || debtor.net > -epsilon) break;

    var amount = Math.min(creditor.net, -debtor.net);
    transactions.push({ from: debtor.name, to: creditor.name, amount: round2(amount) });

    // Update without rounding to avoid accumulated drift across iterations
    creditor.net -= amount;
    debtor.net   += amount;
  }

  return transactions;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
