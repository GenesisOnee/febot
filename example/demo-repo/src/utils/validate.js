export function required(value) {
  return typeof value === "string" && value.trim() !== "";
}
