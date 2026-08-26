export type BrazilianDocumentType = "CPF" | "CNPJ";

export interface DocumentValidationResult {
  valid: boolean;
  type: BrazilianDocumentType | null;
  message?: string;
}

export function isValidCPF(value: string): boolean {
  const cpf = value.replace(/\D/g, "");
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  const digits = cpf.split("").map(Number);

  for (const round of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < round; i++) {
      sum += digits[i] * (round + 1 - i);
    }
    let check = (sum * 10) % 11;
    if (check === 10) check = 0;
    if (check !== digits[round]) return false;
  }

  return true;
}

export function isValidCNPJ(value: string): boolean {
  const cnpj = value.replace(/\D/g, "");
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;

  const calcCheckDigit = (base: string): number => {
    let weight = base.length - 7;
    let sum = 0;
    for (let i = 0; i < base.length; i++) {
      sum += Number(base[i]) * weight--;
      if (weight < 2) weight = 9;
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  const firstDigit = calcCheckDigit(cnpj.slice(0, 12));
  const secondDigit = calcCheckDigit(cnpj.slice(0, 13));

  return firstDigit === Number(cnpj[12]) && secondDigit === Number(cnpj[13]);
}

export function validateBrazilianDocument(
  value: string | undefined | null,
): DocumentValidationResult {
  const digits = (value || "").replace(/\D/g, "");

  if (!digits) {
    return {
      valid: false,
      type: null,
      message: "Informe seu CPF ou CNPJ para continuar",
    };
  }

  if (digits.length !== 11 && digits.length !== 14) {
    return {
      valid: false,
      type: null,
      message:
        "Documento inválido: CPF deve ter 11 dígitos e CNPJ deve ter 14 dígitos",
    };
  }

  if (digits.length === 11) {
    if (!isValidCPF(digits)) {
      return {
        valid: false,
        type: "CPF",
        message: "CPF inválido. Verifique os números digitados.",
      };
    }
    return { valid: true, type: "CPF" };
  }

  if (!isValidCNPJ(digits)) {
    return {
      valid: false,
      type: "CNPJ",
      message: "CNPJ inválido. Verifique os números digitados.",
    };
  }
  return { valid: true, type: "CNPJ" };
}
