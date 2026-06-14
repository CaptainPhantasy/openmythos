export function echoOrFallback(input) {
  const value = typeof input === "string" ? input.trim() : "";
  if (value.length === 0) {
    return "";
  }
  return "fallback";
}
