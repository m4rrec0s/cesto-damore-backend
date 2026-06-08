import { humanizationGuard } from "./humanizationGuard";
import { safetyGuard } from "./safetyGuard";
import { formatGuard } from "./formatGuard";

export function applyGuardrails(text: string): string {
  let result = text;
  result = humanizationGuard(result);
  result = safetyGuard(result);
  result = formatGuard(result);
  return result;
}

export { humanizationGuard } from "./humanizationGuard";
export { safetyGuard } from "./safetyGuard";
export { formatGuard } from "./formatGuard";
