import axios from "axios";

export interface AddressInfo {
  zip_code: string;
  address: string;
  neighborhood: string;
  city: string;
  state: string;
  ibge_code?: string;
  gia_code?: string;
  ddd?: string;
  siafi_code?: string;
}

export interface ViaCepResponse {
  cep: string;
  logradouro: string;
  complemento: string;
  bairro: string;
  localidade: string;
  uf: string;
  ibge: string;
  gia: string;
  ddd: string;
  siafi: string;
  erro?: boolean;
}

class CepService {
  private readonly baseUrl = "https://viacep.com.br/ws";

  

  validateCepFormat(cep: string): boolean {
    if (!cep) return false;

    const cleanCep = cep.replace(/\D/g, "");

    return cleanCep.length === 8;
  }

  

  cleanCep(cep: string): string {
    return cep.replace(/\D/g, "");
  }

  

  formatCep(cep: string): string {
    const cleanCep = this.cleanCep(cep);
    if (cleanCep.length !== 8) return cep;

    return `${cleanCep.slice(0, 5)}-${cleanCep.slice(5)}`;
  }

  

  async getAddressByCep(cep: string): Promise<AddressInfo> {
    if (!this.validateCepFormat(cep)) {
      throw new Error("CEP deve ter 8 dígitos");
    }

    const cleanCep = this.cleanCep(cep);

    try {
      const response = await axios.get<ViaCepResponse>(
        `${this.baseUrl}/${cleanCep}/json/`,
        {
          timeout: 5000,
          headers: {
            "User-Agent": "Cesto-dAmore-Backend/1.0",
          },
        }
      );

      if (response.data.erro) {
        throw new Error("CEP não encontrado");
      }

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
    } catch (error: any) {
      if (error.message === "CEP não encontrado") {
        throw error;
      }

      if (axios.isAxiosError(error)) {
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

  

  async validateCep(cep: string): Promise<boolean> {
    try {
      await this.getAddressByCep(cep);
      return true;
    } catch (error: any) {
      return false;
    }
  }
}

export default new CepService();
