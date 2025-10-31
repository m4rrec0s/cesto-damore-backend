import prisma from "../database/prisma";
import path from "path";
import fs from "fs/promises";

interface PreviewRequest {
  productId: string;
  customizationData: {
    photos?: Array<{
      temp_file_id?: string;
      preview_url?: string;
      original_name?: string;
    }>;
    text?: string;
    selected_option?: string;
    [key: string]: any;
  };
}

interface PreviewResponse {
  previewUrl?: string;
  model3d?: string;
  message?: string;
}

class PreviewService {
  /**
   * Gera preview dinâmico da customização
   */
  async generatePreview(data: PreviewRequest): Promise<PreviewResponse> {
    try {
      // Buscar produto e seu tipo
      const product = await prisma.product.findUnique({
        where: { id: data.productId },
        include: {
          type: true,
        },
      });

      if (!product) {
        return {
          message: "Produto não encontrado",
        };
      }

      // Verificar se o tipo de produto suporta preview 3D
      const productType = await prisma.productType.findUnique({
        where: { id: product.type_id },
      });

      const response: PreviewResponse = {};

      if (product.image_url) {
        response.previewUrl = product.image_url;
      }

      if (
        data.customizationData.photos &&
        data.customizationData.photos.length > 0
      ) {
        const firstPhoto = data.customizationData.photos[0];
        if (firstPhoto.preview_url) {
          response.previewUrl = firstPhoto.preview_url;
        }
      }

      return response;
    } catch (error: any) {
      console.error("Erro ao gerar preview:", error);
      return {
        message: "Erro ao gerar preview",
      };
    }
  }

  /**
   * Retorna URL do modelo 3D baseado no tipo de produto
   */
  private get3DModelUrl(productTypeId: string): string {
    // Mapeamento estático - pode ser migrado para banco futuramente
    const modelsMap: Record<string, string> = {
      // Exemplos de mapeamento
      // 'caneca-id': '/models/caneca.glb',
      // 'quadro-id': '/models/quadro.glb',
    };

    return (
      modelsMap[productTypeId] || `/models/default.glb?type=${productTypeId}`
    );
  }

  /**
   * Valida se os dados de customização estão completos para preview
   */
  validatePreviewData(data: PreviewRequest): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!data.productId) {
      errors.push("ID do produto é obrigatório");
    }

    if (!data.customizationData) {
      errors.push("Dados de customização são obrigatórios");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

export default new PreviewService();
