import { parseAlerts, SAMPLE_ALERTS, summarizeDay, localDateKey } from '../src/services/alertParser';

const now = new Date('2026-10-14T20:00:00+01:00');
const { parsed, unreadable } = parseAlerts(SAMPLE_ALERTS, 5000, now);
for (const p of parsed) {
  console.log(
    [p.institution.padEnd(12), p.direction.padEnd(6), String(p.amountNgn).padStart(9), p.category.padEnd(11), localDateKey(p.occurredAtIso), p.maskedAccount ?? '-', p.narration].join(' | ')
  );
}
console.log('unreadable:', unreadable);

const expect: Array<[string, string, number, string]> = [
  ['GTBank', 'DEBIT', 10500, 'FUEL'],
  ['Zenith Bank', 'DEBIT', 2000, 'URGENT_2K'],
  ['UBA', 'DEBIT', 6000, 'POS'],
  ['Access Bank', 'DEBIT', 4, 'BANK_CHARGE'],
  ['OPay', 'DEBIT', 3000, 'URGENT_2K'],
  ['FirstBank', 'CREDIT', 150000, 'INCOME']
];
let fails = 0;
expect.forEach(([inst, dir, amt, cat], i) => {
  const p = parsed[i];
  if (!p || p.institution !== inst || p.direction !== dir || p.amountNgn !== amt || p.category !== cat) {
    fails++;
    console.log('FAIL', i, { inst, dir, amt, cat }, p);
  }
});
// Balances must never be read as the amount
if (parsed.some((p) => [84320.5, 82270.5].includes(p.amountNgn))) { fails++; console.log('FAIL balance leaked'); }
console.log(summarizeDay(parsed, '2026-10-14'));
console.log(fails === 0 ? `ALL ${expect.length} PASS` : `${fails} FAILED`);
process.exit(fails ? 1 : 0);
