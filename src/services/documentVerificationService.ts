import axios from "axios";
import logger from "../utils/logger";

const CPFHUB_API_KEY = process.env.CPFHUB_API_KEY;
const CPFHUB_BASE_URL = process.env.CPFHUB_API_URL || "https://api.cpfhub.io";

const BRASILAPI_CNPJ_URL = "https://brasilapi.com.br/api/v1/cnpj";

export interface DocumentExistenceResult {
  /** true quando a consulta externa respondeu de fato (sucesso ou "não encontrado"). */
  checked: boolean;
  /** true quando o documento existe na base oficial consultada. */
  exists: boolean;
  /** Situação cadastral (quando a API retorna). */
  situation?: string;
  message?: string;
}

async function checkCnpjExists(
  cnpj: string,
): Promise<DocumentExistenceResult> {
  try {
    const res = await axios.get(`${BRASILAPI_CNPJ_URL}/${cnpj}`, {
      timeout: 5000,
    });
    if (res.status === 200 && res.data && res.data.cnpj) {
      return { checked: true, exists: true };
    }
    return {
      checked: true,
      exists: false,
      message: "CNPJ não encontrado na Receita Federal.",
    };
  } catch (err: any) {
    if (err?.response?.status === 404) {
      return {
        checked: true,
        exists: false,
        message: "CNPJ não encontrado na Receita Federal.",
      };
    }
    logger.warn(
      "Falha ao consultar existência de CNPJ (BrasilAPI) - degradando para validação local",
      { error: err?.message },
    );
    return { checked: false, exists: false };
  }
}

async function checkCpfExists(cpf: string): Promise<DocumentExistenceResult> {
  if (!CPFHUB_API_KEY) {
    logger.debug(
      "CPFHUB_API_KEY não configurada - pulando verificação de existência de CPF (apenas dígitos verificadores)",
    );
    return { checked: false, exists: false };
  }

  try {
    const res = await axios.get(`${CPFHUB_BASE_URL}/cpf/${cpf}`, {
      timeout: 5000,
      headers: {
        "x-api-key": CPFHUB_API_KEY,
        Accept: "application/json",
      },
    });

    if (res.status === 200 && res.data) {
      const situation = (res.data.situacao_cadastral || "").toString().toUpperCase();
      return {
        checked: true,
        exists: true,
        situation,
        message:
          situation && situation !== "REGULAR" && situation !== "ATIVO"
            ? `CPF com situação cadastral "${situation}".`
            : undefined,
      };
    }

    return {
      checked: true,
      exists: false,
      message: "CPF não encontrado na base da Receita Federal.",
    };
  } catch (err: any) {
    if (err?.response?.status === 404) {
      return {
        checked: true,
        exists: false,
        message: "CPF não encontrado na base da Receita Federal.",
      };
    }
    logger.warn(
      "Falha ao consultar existência de CPF (CPFHub) - degradando para validação local",
      { error: err?.message },
    );
    return { checked: false, exists: false };
  }
}

/**
 * Verifica se um CPF/CNPJ existe na base oficial.
 *
 * Degrada graciosamente: se a API externa estiver indisponível, sem créditos
 * ou sem chave configurada (CPF), retorna `checked: false` para que o chamador
 * não bloqueie o checkout apenas por falha de infraestrutura.
 */
export async function verifyDocumentExists(
  type: "CPF" | "CNPJ",
  value: string,
): Promise<DocumentExistenceResult> {
  const digits = (value || "").replace(/\D/g, "");
  if (!digits) return { checked: false, exists: false };

  return type === "CPF"
    ? checkCpfExists(digits)
    : checkCnpjExists(digits);
}
