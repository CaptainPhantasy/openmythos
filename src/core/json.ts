export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const startObject = text.indexOf("{");
  const endObject = text.lastIndexOf("}");
  const startArray = text.indexOf("[");
  const endArray = text.lastIndexOf("]");

  if (startObject !== -1 && endObject > startObject) {
    return text.slice(startObject, endObject + 1).trim();
  }

  if (startArray !== -1 && endArray > startArray) {
    return text.slice(startArray, endArray + 1).trim();
  }

  return text.trim();
}

export function parseJsonFromModel(text: string): unknown {
  const extracted = extractJson(text);
  try {
    return JSON.parse(extracted);
  } catch (error) {
    const repaired = extracted
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/^\uFEFF/, "");
    try {
      return JSON.parse(repaired);
    } catch {
      throw new Error(`Model output was not valid JSON: ${(error as Error).message}`);
    }
  }
}
