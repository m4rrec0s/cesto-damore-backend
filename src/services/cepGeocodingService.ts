import axios from "axios";
import logger from "../utils/logger";

class CepGeocodingService {
  async geocode(cep?: string | null) {
    const normalizedCep = cep?.replace(/\D/g, "");
    if (!normalizedCep || normalizedCep.length !== 8) return null;

    try {
      const response = await axios.get(
        `https://brasilapi.com.br/api/cep/v2/${normalizedCep}`,
        { timeout: 5000 },
      );
      const coordinates = response.data?.location?.coordinates;
      const latitude = Number(coordinates?.latitude);
      const longitude = Number(coordinates?.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return null;
      }
      return { latitude, longitude };
    } catch (error) {
      logger.warn("[CepGeocoding] Falha ao localizar CEP", { cep: normalizedCep });
      return null;
    }
  }
}

export default new CepGeocodingService();
