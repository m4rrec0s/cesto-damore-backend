interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateArgs(
  args: Record<string, unknown>,
  schema: Record<string, unknown>,
): ValidationResult {
  if (!schema || schema.type !== "object") return { valid: true };

  const required = (schema.required as string[]) || [];
  const properties = (schema.properties as Record<string, any>) || {};

  // Check required fields
  for (const field of required) {
    if (args[field] === undefined || args[field] === null) {
      return { valid: false, error: `Missing required field: "${field}"` };
    }
  }

  // Check types for provided fields
  for (const [key, value] of Object.entries(args)) {
    const prop = properties[key];
    if (!prop) continue;

    const typeError = checkType(value, prop.type, key);
    if (typeError) return { valid: false, error: typeError };
  }

  return { valid: true };
}

function checkType(value: unknown, expectedType: string, field: string): string | null {
  if (!expectedType || value === undefined || value === null) return null;

  switch (expectedType) {
    case "string":
      if (typeof value !== "string") return `"${field}" must be a string`;
      break;
    case "number":
      if (typeof value !== "number") return `"${field}" must be a number`;
      break;
    case "boolean":
      if (typeof value !== "boolean") return `"${field}" must be a boolean`;
      break;
    case "array":
      if (!Array.isArray(value)) return `"${field}" must be an array`;
      break;
    case "object":
      if (typeof value !== "object" || Array.isArray(value)) return `"${field}" must be an object`;
      break;
  }

  return null;
}
