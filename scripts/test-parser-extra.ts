import { parseAlerts } from '../src/services/alertParser';
const cases: Array<[string, number, string, string]> = [
  ['Moniepoint: Debit of N3,500.00 for Transfer to AISHA BELLO. Bal: N12,400.00', 3500, 'DEBIT', 'URGENT_2K'],
  ['PalmPay: You paid ₦1,000.00 for MTN Airtime 08031234567', 1000, 'DEBIT', 'AIRTIME_DATA'],
  ['Kuda: You received ₦25,000.00 from TUNDE ADEBAYO. Your balance is ₦40,500.00', 25000, 'CREDIT', 'INCOME'],
  ['Acct:01XXXX9876\nAmt:NGN15,000.00 DR\nDesc:IKEDC PREPAID METER TOKEN\nAvail Bal:NGN3,210.00\nWema', 15000, 'DEBIT', 'ELECTRICITY'],
  ['GTBank Acct: 012****345 Amt: NGN50.00 DR Desc: ELECTRONIC MONEY TRANSFER LEVY', 50, 'DEBIT', 'BANK_CHARGE'],
  ['Acct:22XXXX1234\nDT:14/10/2026:07:15PM\nNIP/GTB/AYO OKONJO\nDR Amt:25,000.00\nBal:5,000.00\nZenith Bank', 25000, 'DEBIT', 'TRANSFER']
];
let fails = 0;
for (const [text, amt, dir, cat] of cases) {
  const p = parseAlerts(text, 5000).parsed[0];
  const ok = p && p.amountNgn === amt && p.direction === dir && p.category === cat;
  if (!ok) fails++;
  console.log(ok ? 'PASS' : 'FAIL', '|', p?.institution, p?.direction, p?.amountNgn, p?.category, '|', p?.narration);
}
const t = parseAlerts(cases[5][0], 5000).parsed[0];
console.log('Zenith time parsed as', new Date(t.occurredAtIso).toTimeString().slice(0,5), '(expect 19:15)');
for (const [text] of cases) {
  const n = parseAlerts(text, 5000).parsed[0]?.narration || '';
  if (/\bbal|12,400|40,500|3,210|5,000\.00/i.test(n)) { fails++; console.log('FAIL balance in narration:', n); }
}
console.log(fails ? `${fails} FAILED` : `ALL ${cases.length} PASS`);
