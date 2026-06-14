export function trimOrEmpty(inputs) {
  if (!Array.isArray(inputs)) {
    return [];
  }

  return inputs.map((value) => String(value));
}
