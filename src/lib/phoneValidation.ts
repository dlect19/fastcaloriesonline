// Nigerian phone number validation
// Rule: exactly 11 digits, digits only (e.g. 08012345678).
// No country code (e.g. +234 / 234) — users must enter the local 11-digit format.

export const PHONE_LENGTH = 11;

/** Strip everything that is not a digit and cap at 11 chars. */
export function sanitizePhoneInput(value: string): string {
  return (value || '').replace(/\D/g, '').slice(0, PHONE_LENGTH);
}

/** Returns true only if the value is exactly 11 digits. */
export function isValidNgPhone(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^\d{11}$/.test(value.trim());
}

export const PHONE_ERROR_MESSAGE =
  'Phone number must be exactly 11 digits (e.g. 08012345678). Do not include country code.';
