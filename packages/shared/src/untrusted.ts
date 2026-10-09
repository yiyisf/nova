/** Marker wrapping tool output so the model treats it as untrusted data, not instructions. */
export const UNTRUSTED_OPEN = "<untrusted-data>";
export const UNTRUSTED_CLOSE = "</untrusted-data>";

export function wrapUntrusted(text: string): string {
  const body = text
    .replaceAll(UNTRUSTED_OPEN, "")
    .replaceAll(UNTRUSTED_CLOSE, "");
  return `${UNTRUSTED_OPEN}\n${body}\n${UNTRUSTED_CLOSE}`;
}

export function isWrappedUntrusted(text: string): boolean {
  return text.startsWith(`${UNTRUSTED_OPEN}\n`) && text.endsWith(`\n${UNTRUSTED_CLOSE}`);
}
