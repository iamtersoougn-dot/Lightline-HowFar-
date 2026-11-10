/**
 * Bank & fintech alert parser (runs fully on-device).
 *
 * Takes SMS / WhatsApp / push-notification alert text as the user pastes or shares it,
 * and turns each alert into a ledger entry: amount, direction, narration, institution,
 * and a spending category (POS, fuel, small "urgent 2k" transfer, bank charges...).
 *
 * Privacy: account numbers are masked and balances are never stored. Nothing here is
 * sent to the server or put in the sync outbox.
 */

export type AlertDirection = 'DEBIT' | 'CREDIT';

export type SpendCategory =
  | 'POS'
  | 'FUEL'
  | 'URGENT_2K'
  | 'BANK_CHARGE'
  | 'AIRTIME_DATA'
  | 'ELECTRICITY'
  | 'TRANSFER'
  | 'INCOME'
  | 'OTHER';

export interface ParsedAlert {
  id: string;
  fingerprint: string; // used to skip the same alert pasted twice
  institution: string;
  direction: AlertDirection;
  amountNgn: number;
  narration: string;
  category: SpendCategory;
  occurredAtIso: string;
  maskedAccount: string | null;
}

export interface ParseResult {
  parsed: ParsedAlert[];
  unreadable: string[]; // blocks we could not read an amount from
}

export const CATEGORY_LABELS: Record<SpendCategory, string> = {
  POS: 'POS',
  FUEL: 'Fuel',
  URGENT_2K: 'Urgent 2k',
  BANK_CHARGE: 'Bank charges',
  AIRTIME_DATA: 'Airtime & data',
  ELECTRICITY: 'Light units',
  TRANSFER: 'Transfers',
  INCOME: 'Money in',
  OTHER: 'Other'
};

const INSTITUTIONS: Array<[RegExp, string]> = [
  [/\bopay\b/i, 'OPay'],
  [/moniepoint/i, 'Moniepoint'],
  [/palm\s?pay/i, 'PalmPay'],
  [/kuda/i, 'Kuda'],
  [/\bgt\s?(bank|co)\b|guaranty/i, 'GTBank'],
  [/zenith/i, 'Zenith Bank'],
  [/\baccess\b/i, 'Access Bank'],
  [/first\s?bank|firstbank/i, 'FirstBank'],
  [/\buba\b|united bank for africa/i, 'UBA'],
  [/fidelity/i, 'Fidelity Bank'],
  [/sterling/i, 'Sterling Bank'],
  [/wema|\balat\b/i, 'Wema / ALAT'],
  [/stanbic/i, 'Stanbic IBTC'],
  [/\bfcmb\b/i, 'FCMB'],
  [/union\s?bank/i, 'Union Bank'],
  [/ecobank/i, 'Ecobank'],
  [/polaris/i, 'Polaris Bank'],
  [/keystone/i, 'Keystone Bank']
];

// Order matters: the first matching rule wins.
const FEE_WORDS = /\b(sms\s*(alert)?\s*(charge|fee)|stamp\s*duty|vat\b|commission|maint(enance)?\s*fee|card\s*maint|account\s*maint|nip\s*(charge|fee)|e[-\s]?levy|electronic money transfer levy|cot\b|charges?\b|fee\b|levy)\b/i;
const FUEL_WORDS = /\b(fuel|petrol|pms|diesel|ago\b|filling\s*station|nnpc|mobil|total\s*energies|totalenergies|conoil|oando|ardova|\bmrs\b|rainoil|matrix\s*energy|ascon|forte\s*oil|11\s*plc|eterna)\b/i;
const AIRTIME_WORDS = /\b(airtime|recharge|data\s*(bundle|plan|sub)?|mtn|glo|airtel|9mobile|vtu)\b/i;
const ELECTRICITY_WORDS = /\b(electricity|prepaid\s*meter|meter\s*token|ikedc|ekedc|aedc|phed|ibedc|eedc|kedco|jed|bedc|disco)\b/i;
const POS_WORDS = /\b(pos|web\s*pmt|card\s*(purchase|pmt|payment)|pos\s*(purch|purchase|wdl|withdrawal)|atm|terminal)\b/i;
const TRANSFER_WORDS = /\b(nip|trf|transfer|transferred|sent\s*to|mobile\s*trf|ussd)\b/i;

const CREDIT_WORDS = /\b(credit(ed)?|\bcr\b|received|deposit|inflow|money\s*in|reversal|reversed)\b/i;
const DEBIT_WORDS = /\b(debit(ed)?|\bdr\b|withdrawal|wdl|purchase|transferred|sent|payment|pmt|paid|charged)\b/i;

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
};

function toNumber(raw: string): number {
  return Number(raw.replace(/,/g, ''));
}

/** Strips any line or clause that describes a balance, so its figure is never read as the amount. */
function withoutBalances(text: string): string {
  return text
    .split(/\n/)
    // Drop lines that are only a balance; single-line alerts keep their text and lose just the figure
    .filter((line) => !/^\s*(avail(able)?\s*bal|bal(ance)?\b|ledger\s*bal|clr\s*bal|cleared\s*bal)/i.test(line))
    .join('\n')
    .replace(/(avail(able)?\s*|ledger\s*|new\s*)?bal(ance)?\s*(is|:|=)?\s*(ngn|n|₦)?\s*[\d,]+(\.\d{1,2})?/gi, ' ');
}

function findAmount(text: string): { amount: number; hint: AlertDirection | null } | null {
  const t = withoutBalances(text);
  const num = '([\\d]{1,3}(?:,\\d{3})+(?:\\.\\d{1,2})?|\\d+(?:\\.\\d{1,2})?)';
  const cur = '(?:ngn|₦|n(?=\\s?\\d))\\s?';

  // 1. Labelled amount: "Amt: NGN5,000.00 DR", "DR Amt:2,000.00", "Amount: ₦1,500"
  const labelled = new RegExp(
    `\\b(dr|cr)?\\s*(?:amt|amount|txn\\s*amt)\\s*[:=]?\\s*(?:${cur})?${num}\\s*(dr|cr)?\\b`,
    'i'
  );
  const m1 = t.match(labelled);
  if (m1) {
    const side = (m1[1] || m1[3] || '').toUpperCase();
    return {
      amount: toNumber(m1[2]),
      hint: side === 'DR' ? 'DEBIT' : side === 'CR' ? 'CREDIT' : null
    };
  }

  // 2. Verb phrase: "debited with NGN2,000.00", "transferred ₦2,000 to", "received ₦50,000"
  const verb = new RegExp(
    `(debited|credited|transferred|sent|received|paid|withdrawn|charged)\\s*(?:with|of|you)?\\s*(?:${cur})${num}`,
    'i'
  );
  const m2 = t.match(verb);
  if (m2) {
    const v = m2[1].toLowerCase();
    return {
      amount: toNumber(m2[2]),
      hint: v === 'credited' || v === 'received' ? 'CREDIT' : 'DEBIT'
    };
  }

  // 3. First currency-tagged figure anywhere
  const any = new RegExp(`${cur}${num}`, 'i');
  const m3 = t.match(any);
  if (m3) return { amount: toNumber(m3[1]), hint: null };

  return null;
}

function findNarration(text: string): string {
  const labelled = text.match(
    /\b(?:desc(?:ription)?|des|narration|narr|remarks?|details|purpose|memo)\s*[:=]\s*(.+)/i
  );
  if (labelled) return labelled[1].trim().slice(0, 120);

  const toWho = text.match(/\b(?:to|from)\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,3})/);
  const line = text
    .split(/\n/)
    .map((l) => l.trim())
    .find((l) => /\b(nip|trf|pos|web\s*pmt|transfer|airtime|data)\b/i.test(l));
  if (line) return line.slice(0, 120);
  if (toWho) return `Transfer ${toWho[0]}`.slice(0, 120);
  return text.replace(/\s+/g, ' ').trim().slice(0, 80);
}

function findDate(text: string, fallback: Date): Date {
  // 14-Oct-2026 08:15 / 14 Oct 2026
  const m1 = text.match(/(\d{1,2})[-\s/]([A-Za-z]{3})[A-Za-z]*[-\s/,]+(\d{2,4})(?:[\s:,]+(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?)?/i);
  if (m1 && MONTHS[m1[2].toLowerCase()] !== undefined) {
    return build(m1[3], MONTHS[m1[2].toLowerCase()], m1[1], m1[4], m1[5], m1[6]);
  }
  // 14/10/2026 08:15 or 14/10/2026:08:15:22AM (Nigerian banks use day-first)
  const m2 = text.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:[\s:,]+(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?)?/i);
  if (m2) return build(m2[3], Number(m2[2]) - 1, m2[1], m2[4], m2[5], m2[6]);
  return fallback;

  function build(y: string, mon: number, d: string, h?: string, min?: string, ap?: string): Date {
    let year = Number(y);
    if (year < 100) year += 2000;
    let hour = h ? Number(h) : fallback.getHours();
    if (ap && /pm/i.test(ap) && hour < 12) hour += 12;
    if (ap && /am/i.test(ap) && hour === 12) hour = 0;
    const date = new Date(year, mon, Number(d), hour, min ? Number(min) : fallback.getMinutes());
    return isNaN(date.getTime()) || mon < 0 || mon > 11 ? fallback : date;
  }
}

/** The sender is named outside the narration; "NIP/OPAY/..." in a Zenith alert means paid to OPay. */
function findInstitution(text: string, narration: string): string {
  const outside = narration ? text.split(narration).join(' ') : text;
  for (const source of [outside, text]) {
    for (const [re, name] of INSTITUTIONS) if (re.test(source)) return name;
  }
  return 'Unknown bank';
}

function maskAccount(text: string): string | null {
  const m = text.match(/\b(?:acct|acc(?:ount)?|ac)\b\s*(?:no\.?|number)?\s*[:#]?\s*([0-9*Xx]{6,12})/i);
  if (!m) return null;
  const digits = m[1].replace(/[^0-9]/g, '');
  return digits.length >= 2 ? `••${digits.slice(-2)}` : '••';
}

export function categorize(
  direction: AlertDirection,
  amountNgn: number,
  narration: string,
  urgentThresholdNgn: number
): SpendCategory {
  if (direction === 'CREDIT') return 'INCOME';
  const n = narration;
  if (FEE_WORDS.test(n) && amountNgn <= 1000) return 'BANK_CHARGE';
  if (FUEL_WORDS.test(n)) return 'FUEL';
  if (ELECTRICITY_WORDS.test(n)) return 'ELECTRICITY';
  if (AIRTIME_WORDS.test(n)) return 'AIRTIME_DATA';
  if (POS_WORDS.test(n)) return 'POS';
  if (TRANSFER_WORDS.test(n) || /transfer/i.test(n)) {
    return amountNgn <= urgentThresholdNgn ? 'URGENT_2K' : 'TRANSFER';
  }
  return 'OTHER';
}

function fingerprint(text: string): string {
  const s = text.replace(/\s+/g, ' ').trim().toLowerCase();
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `fp-${(h >>> 0).toString(36)}`;
}

/**
 * Splits pasted text into separate alerts. Alerts are separated by a blank line,
 * or by a new alert header ("Acct:", "Txn:", "Debit Alert", "Credit Alert", "[Bank]").
 */
export function splitAlerts(raw: string): string[] {
  const blocks = raw
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .flatMap((block) =>
      block.split(/\n(?=\s*(?:acct\s*:|txn\s*:|debit\s*alert|credit\s*alert|\[[^\]]+\]))/i)
    )
    .map((b) => b.trim())
    .filter((b) => b.length > 8);
  return blocks;
}

export function parseAlerts(
  raw: string,
  urgentThresholdNgn: number,
  now: Date = new Date()
): ParseResult {
  const parsed: ParsedAlert[] = [];
  const unreadable: string[] = [];

  for (const block of splitAlerts(raw)) {
    const amountInfo = findAmount(block);
    if (!amountInfo || !isFinite(amountInfo.amount) || amountInfo.amount <= 0) {
      unreadable.push(block.slice(0, 60));
      continue;
    }

    let direction: AlertDirection | null = amountInfo.hint;
    if (!direction) {
      const lower = withoutBalances(block);
      const credit = CREDIT_WORDS.test(lower);
      const debit = DEBIT_WORDS.test(lower);
      direction = credit && !debit ? 'CREDIT' : 'DEBIT';
    }

    // Narration is built from balance-free text so no balance is ever stored
    const narration = findNarration(withoutBalances(block)).replace(/\s+/g, ' ').trim();
    const fp = fingerprint(block);
    parsed.push({
      id: `${fp}-${parsed.length}`,
      fingerprint: fp,
      institution: findInstitution(block, narration),
      direction,
      amountNgn: Math.round(amountInfo.amount * 100) / 100,
      narration,
      category: categorize(direction, amountInfo.amount, narration, urgentThresholdNgn),
      occurredAtIso: findDate(block, now).toISOString(),
      maskedAccount: maskAccount(block)
    });
  }

  return { parsed, unreadable };
}

export interface DaySummary {
  dateKey: string; // YYYY-MM-DD local
  spentNgn: number;
  receivedNgn: number;
  byCategory: Partial<Record<SpendCategory, number>>;
  urgentCount: number;
  posCount: number;
}

export function localDateKey(iso: string): string {
  const d = new Date(iso);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function summarizeDay(entries: ParsedAlert[], dateKey: string): DaySummary {
  const s: DaySummary = {
    dateKey,
    spentNgn: 0,
    receivedNgn: 0,
    byCategory: {},
    urgentCount: 0,
    posCount: 0
  };
  for (const e of entries) {
    if (localDateKey(e.occurredAtIso) !== dateKey) continue;
    if (e.direction === 'CREDIT') {
      s.receivedNgn += e.amountNgn;
      continue;
    }
    s.spentNgn += e.amountNgn;
    s.byCategory[e.category] = (s.byCategory[e.category] || 0) + e.amountNgn;
    if (e.category === 'URGENT_2K') s.urgentCount += 1;
    if (e.category === 'POS') s.posCount += 1;
  }
  return s;
}

export const SAMPLE_ALERTS = `Acct: 012****345
Amt: NGN10,500.00 DR
Desc: POS/WEB PMT NNPC MEGA STATION WUSE
Avail Bal: NGN84,320.50
Date: 14-Oct-2026 07:42
GTBank

Acct:22XXXX1234
DT:14/10/2026:09:15:22AM
NIP/OPAY/MUSA IBRAHIM/urgent 2k
DR Amt:2,000.00
Bal:82,270.50
Zenith Bank

Txn: Debit
Ac:20XXXXXX12
Amt:NGN 6,000.00
Des:POS WDL MONIEPOINT AGENT GWARINPA
Date:14-Oct-2026 12:31
UBA

Debit Alert: NGN 4.00 SMS ALERT CHARGE SEPT 2026 Access Bank

You have successfully transferred ₦3,000.00 to CHIOMA OKAFOR. OPay

Your Acct 31XXXX5678 Has Been Credited with NGN150,000.00 On 14-Oct-2026 Narration: SALARY OCT FirstBank`;
