export function isValidEmail(input) {
  if (typeof input !== "string") {
    return false;
  }

  return input.includes("@");
}
