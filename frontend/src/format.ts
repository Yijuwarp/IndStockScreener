/** Format a number with Indian digit grouping (e.g. 1500000 -> "15,00,000") for use inside an editable text input. */
export function formatIndianInput(value: string): string {
  const negative = value.startsWith("-");
  const cleaned = value.replace(/[^0-9.]/g, "");
  if (cleaned === "") return "";
  const [intPart, ...decimalParts] = cleaned.split(".");
  const decimal = decimalParts.length ? "." + decimalParts.join("").slice(0, 2) : "";
  const trimmedInt = intPart.replace(/^0+(?=\d)/, "");
  let grouped = trimmedInt;
  if (trimmedInt.length > 3) {
    const last3 = trimmedInt.slice(-3);
    const rest = trimmedInt.slice(0, -3);
    grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
  }
  return (negative ? "-" : "") + grouped + decimal;
}

/** Strip Indian grouping commas back to a plain numeric string, suitable for Number(). */
export function unformatIndianInput(value: string): string {
  return value.replace(/,/g, "");
}
