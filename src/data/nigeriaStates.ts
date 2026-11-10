/**
 * All 36 states + the FCT. Codes follow ISO 3166-2:NG (without the "NG-" prefix).
 * Shared by the app and the server (server/index.ts imports this file).
 *
 * `disco` is the main electricity distribution company for the state. Some states are
 * split between DisCos (e.g. Lagos: IKEDC north / EKEDC south; parts of Ogun use EKEDC),
 * and under the Electricity Act 2023 some states now run their own electricity markets,
 * so users can override the DisCo when they add their own area.
 */

export type StateCode =
  | 'AB' | 'AD' | 'AK' | 'AN' | 'BA' | 'BY' | 'BE' | 'BO' | 'CR' | 'DE'
  | 'EB' | 'ED' | 'EK' | 'EN' | 'FC' | 'GO' | 'IM' | 'JI' | 'KD' | 'KN'
  | 'KT' | 'KE' | 'KO' | 'KW' | 'LA' | 'NA' | 'NI' | 'OG' | 'ON' | 'OS'
  | 'OY' | 'PL' | 'RI' | 'SO' | 'TA' | 'YO' | 'ZA';

export type GeoZone =
  | 'North Central'
  | 'North East'
  | 'North West'
  | 'South East'
  | 'South South'
  | 'South West';

export interface NigerianState {
  code: StateCode;
  name: string;
  capital: string;
  zone: GeoZone;
  disco: string;
}

export const NIGERIAN_STATES: NigerianState[] = [
  { code: 'AB', name: 'Abia', capital: 'Umuahia', zone: 'South East', disco: 'EEDC / Aba Power' },
  { code: 'AD', name: 'Adamawa', capital: 'Yola', zone: 'North East', disco: 'YEDC' },
  { code: 'AK', name: 'Akwa Ibom', capital: 'Uyo', zone: 'South South', disco: 'PHED' },
  { code: 'AN', name: 'Anambra', capital: 'Awka', zone: 'South East', disco: 'EEDC' },
  { code: 'BA', name: 'Bauchi', capital: 'Bauchi', zone: 'North East', disco: 'JED' },
  { code: 'BY', name: 'Bayelsa', capital: 'Yenagoa', zone: 'South South', disco: 'PHED' },
  { code: 'BE', name: 'Benue', capital: 'Makurdi', zone: 'North Central', disco: 'JED' },
  { code: 'BO', name: 'Borno', capital: 'Maiduguri', zone: 'North East', disco: 'YEDC' },
  { code: 'CR', name: 'Cross River', capital: 'Calabar', zone: 'South South', disco: 'PHED' },
  { code: 'DE', name: 'Delta', capital: 'Asaba', zone: 'South South', disco: 'BEDC' },
  { code: 'EB', name: 'Ebonyi', capital: 'Abakaliki', zone: 'South East', disco: 'EEDC' },
  { code: 'ED', name: 'Edo', capital: 'Benin City', zone: 'South South', disco: 'BEDC' },
  { code: 'EK', name: 'Ekiti', capital: 'Ado-Ekiti', zone: 'South West', disco: 'BEDC' },
  { code: 'EN', name: 'Enugu', capital: 'Enugu', zone: 'South East', disco: 'EEDC' },
  { code: 'FC', name: 'FCT Abuja', capital: 'Abuja', zone: 'North Central', disco: 'AEDC' },
  { code: 'GO', name: 'Gombe', capital: 'Gombe', zone: 'North East', disco: 'JED' },
  { code: 'IM', name: 'Imo', capital: 'Owerri', zone: 'South East', disco: 'EEDC' },
  { code: 'JI', name: 'Jigawa', capital: 'Dutse', zone: 'North West', disco: 'KEDCO' },
  { code: 'KD', name: 'Kaduna', capital: 'Kaduna', zone: 'North West', disco: 'Kaduna Electric' },
  { code: 'KN', name: 'Kano', capital: 'Kano', zone: 'North West', disco: 'KEDCO' },
  { code: 'KT', name: 'Katsina', capital: 'Katsina', zone: 'North West', disco: 'KEDCO' },
  { code: 'KE', name: 'Kebbi', capital: 'Birnin Kebbi', zone: 'North West', disco: 'Kaduna Electric' },
  { code: 'KO', name: 'Kogi', capital: 'Lokoja', zone: 'North Central', disco: 'AEDC' },
  { code: 'KW', name: 'Kwara', capital: 'Ilorin', zone: 'North Central', disco: 'IBEDC' },
  { code: 'LA', name: 'Lagos', capital: 'Ikeja', zone: 'South West', disco: 'IKEDC / EKEDC' },
  { code: 'NA', name: 'Nasarawa', capital: 'Lafia', zone: 'North Central', disco: 'AEDC' },
  { code: 'NI', name: 'Niger', capital: 'Minna', zone: 'North Central', disco: 'AEDC' },
  { code: 'OG', name: 'Ogun', capital: 'Abeokuta', zone: 'South West', disco: 'IBEDC' },
  { code: 'ON', name: 'Ondo', capital: 'Akure', zone: 'South West', disco: 'BEDC' },
  { code: 'OS', name: 'Osun', capital: 'Osogbo', zone: 'South West', disco: 'IBEDC' },
  { code: 'OY', name: 'Oyo', capital: 'Ibadan', zone: 'South West', disco: 'IBEDC' },
  { code: 'PL', name: 'Plateau', capital: 'Jos', zone: 'North Central', disco: 'JED' },
  { code: 'RI', name: 'Rivers', capital: 'Port Harcourt', zone: 'South South', disco: 'PHED' },
  { code: 'SO', name: 'Sokoto', capital: 'Sokoto', zone: 'North West', disco: 'Kaduna Electric' },
  { code: 'TA', name: 'Taraba', capital: 'Jalingo', zone: 'North East', disco: 'YEDC' },
  { code: 'YO', name: 'Yobe', capital: 'Damaturu', zone: 'North East', disco: 'YEDC' },
  { code: 'ZA', name: 'Zamfara', capital: 'Gusau', zone: 'North West', disco: 'Kaduna Electric' }
];

export const GEO_ZONES: GeoZone[] = [
  'North Central',
  'North East',
  'North West',
  'South East',
  'South South',
  'South West'
];

const BY_CODE = new Map(NIGERIAN_STATES.map((s) => [s.code, s]));

export function isStateCode(value: unknown): value is StateCode {
  return typeof value === 'string' && BY_CODE.has(value as StateCode);
}

export function getState(code: StateCode): NigerianState {
  return BY_CODE.get(code)!;
}

/** Older builds stored a city name ('Abuja' / 'Lagos'); map it to a state code. */
export function legacyCityToState(city: unknown): StateCode | null {
  if (city === 'Abuja') return 'FC';
  if (city === 'Lagos') return 'LA';
  if (city === 'Port Harcourt') return 'RI';
  if (city === 'Ibadan') return 'OY';
  if (city === 'Kano') return 'KN';
  return null;
}

/** Deterministic area id so two neighbours who add "Rumuola" in Rivers land on the same zone. */
export function areaZoneId(code: StateCode, areaName: string): string {
  const slug = areaName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${code.toLowerCase()}-${slug || 'area'}`;
}

export const TARIFF_BANDS = ['Band A', 'Band B', 'Band C', 'Band D', 'Band E'] as const;
export type TariffBand = (typeof TARIFF_BANDS)[number];
