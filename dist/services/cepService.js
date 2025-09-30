"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
class CepService {
    constructor() {
        this.baseUrl = "https://viacep.com.br/ws";
    }
    /**
     * Valida se o CEP tem formato válido (00000-000 ou 00000000)
     */
    validateCepFormat(cep) {
        if (!cep)
            return false;
        // Remove qualquer formatação
        const cleanCep = cep.replace(/\D/g, "");
        // Verifica se tem exatamente 8 dígitos
        return cleanCep.length === 8;
    }
    /**
     * Remove formatação do CEP, deixando apenas números
     */
    cleanCep(cep) {
        return cep.replace(/\D/g, "");
    }
    /**
     * Formata CEP no padrão 00000-000
     */
    formatCep(cep) {
        const cleanCep = this.cleanCep(cep);
        if (cleanCep.length !== 8)
            return cep;
        return `${cleanCep.slice(0, 5)}-${cleanCep.slice(5)}`;
    }
    /**
     * Consulta informações de endereço por CEP na API ViaCEP
     */
    async getAddressByCep(cep) {
        if (!this.validateCepFormat(cep)) {
            throw new Error("CEP deve ter 8 dígitos");
        }
        const cleanCep = this.cleanCep(cep);
        try {
            const response = await axios_1.default.get(`${this.baseUrl}/${cleanCep}/json/`, {
                timeout: 5000, // 5 segundos de timeout
                headers: {
                    "User-Agent": "Cesto-dAmore-Backend/1.0",
                },
            });
            if (response.data.erro) {
                throw new Error("CEP não encontrado");
            }
            // Mapeia a resposta da ViaCEP para nosso formato
            return {
                zip_code: this.formatCep(response.data.cep),
                address: response.data.logradouro || "",
                neighborhood: response.data.bairro || "",
                city: response.data.localidade || "",
                state: response.data.uf || "",
                ibge_code: response.data.ibge || undefined,
                gia_code: response.data.gia || undefined,
                ddd: response.data.ddd || undefined,
                siafi_code: response.data.siafi || undefined,
            };
        }
        catch (error) {
            if (error.message === "CEP não encontrado") {
                throw error;
            }
            if (axios_1.default.isAxiosError(error)) {
                if (error.code === "ECONNABORTED") {
                    throw new Error("Timeout na consulta do CEP. Tente novamente.");
                }
                if (error.response?.status === 404) {
                    throw new Error("CEP não encontrado");
                }
                if (error.response && error.response.status >= 500) {
                    throw new Error("Serviço de CEP temporariamente indisponível");
                }
            }
            console.error("Erro na consulta do CEP:", error);
            throw new Error("Erro ao consultar informações do CEP");
        }
    }
    /**
     * Verifica se um CEP é válido consultando a API
     */
    async validateCep(cep) {
        try {
            await this.getAddressByCep(cep);
            return true;
        }
        catch (error) {
            return false;
        }
    }
}
exports.default = new CepService();
