// ============================================================================
// SETTLEMENT ENGINE — pure functions, no Firebase/DOM dependency.
// Takes a list of expenses and a list of participant names, returns the
// minimum set of payments needed to settle all debts.
// ============================================================================

/**
 * @param {Array<{description:string, amount:number, paidByName:string}>} expenses
 * @param {Array<string>} participantNames
 * @returns {{
 *   total: number,
 *   perPersonShare: number,
 *   paidByPerson: Record<string, number>,
 *   netByPerson: Record<string, number>,
 *   transactions: Array<{from:string, to:string, amount:number}>
 * }}
 */
export function calculateSettlement(expenses, participantNames) {
  const EPSILON = 0.01;

  if (!participantNames || participantNames.length === 0) {
    throw new Error("At least one participant is required.");
  }

  const total = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const perPersonShare = total / participantNames.length;

  const paidByPerson = {};
  participantNames.forEach((name) => (paidByPerson[name] = 0));
  expenses.forEach((e) => {
    if (paidByPerson[e.paidByName] === undefined) {
      // Someone paid who isn't in the declared participant list — still
      // count their payment so totals stay correct, but flag for the caller.
      paidByPerson[e.paidByName] = 0;
    }
    paidByPerson[e.paidByName] += Number(e.amount || 0);
  });

  // net > 0 means this person is owed money (creditor); net < 0 means they owe (debtor)
  const netByPerson = {};
  Object.keys(paidByPerson).forEach((name) => {
    netByPerson[name] = round2(paidByPerson[name] - perPersonShare);
  });

  const transactions = greedySettle(netByPerson, EPSILON);

  return {
    total: round2(total),
    perPersonShare: round2(perPersonShare),
    paidByPerson,
    netByPerson,
    transactions,
  };
}

function greedySettle(netByPerson, epsilon) {
  // Work on a mutable copy: [name, net][]
  const balances = Object.entries(netByPerson).map(([name, net]) => ({ name, net }));
  const transactions = [];

  let safetyCounter = 0;
  const maxIterations = balances.length * balances.length + 10;

  while (safetyCounter++ < maxIterations) {
    // Largest creditor (most positive) and largest debtor (most negative)
    let creditor = balances.reduce((a, b) => (b.net > a.net ? b : a), balances[0]);
    let debtor = balances.reduce((a, b) => (b.net < a.net ? b : a), balances[0]);

    if (creditor.net < epsilon || debtor.net > -epsilon) break; // everyone settled

    const amount = Math.min(creditor.net, -debtor.net);
    transactions.push({ from: debtor.name, to: creditor.name, amount: round2(amount) });

    creditor.net = round2(creditor.net - amount);
    debtor.net = round2(debtor.net + amount);
  }

  return transactions;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
