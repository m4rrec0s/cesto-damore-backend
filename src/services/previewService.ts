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

      // Se tem suporte a 3D, retornar URL do modelo
      if (productType?.has_3d_preview) {
        // Por enquanto, retornar URL estática baseada no tipo
        // Futuramente pode ser gerado dinamicamente
        response.model3d = this.get3DModelUrl(product.type_id);
      }

      // Gerar preview estático (pode ser expandido futuramente)
      // Por enquanto retorna a imagem do produto
      if (product.image_url) {
        response.previewUrl = product.image_url;
      }

      // Se houver fotos personalizadas, usar a primeira como preview
      if (
        data.customizationData.photos &&
        data.customizationData.photos.length > 0
      ) {
        const firstPhoto = data.customizationData.photos[0];
        if (firstPhoto.preview_url) {
          response.previewUrl = firstPhoto.preview_url;
        } else if (firstPhoto.temp_file_id) {
          // Buscar arquivo temporário
          const tempFile = await prisma.temporaryCustomizationFile.findUnique({
            where: { id: firstPhoto.temp_file_id },
          });

          if (tempFile) {
            // Retornar caminho relativo para o arquivo temporário
            response.previewUrl = `/api/temp-files/${tempFile.id}`;
          }
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

  /**
   * Servir arquivo temporário para preview
   */
  async serveTempFile(fileId: string): Promise<{
    filePath: string;
    mimeType: string;
    fileName: string;
  } | null> {
    try {
      const tempFile = await prisma.temporaryCustomizationFile.findUnique({
        where: { id: fileId },
      });

      if (!tempFile) {
        return null;
      }

      // Verificar se arquivo ainda existe
      try {
        await fs.access(tempFile.file_path);
      } catch {
        return null;
      }

      return {
        filePath: tempFile.file_path,
        mimeType: tempFile.mime_type,
        fileName: tempFile.original_name,
      };
    } catch (error) {
      console.error("Erro ao servir arquivo temporário:", error);
      return null;
    }
  }
}

export default new PreviewService();
