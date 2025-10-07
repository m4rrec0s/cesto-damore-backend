import prisma from "../database/prisma";
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import googleDriveService from "./googleDriveService";

interface TemporaryFile {
  id: string;
  session_id: string;
  original_name: string;
  stored_filename: string;
  file_path: string;
  mime_type: string;
  size: number;
  expires_at: Date;
}

interface CustomizationData {
  photos?: Array<{
    temp_file_id: string;
    original_name: string;
    position: number;
  }>;
  text?: string;
  selected_option?: string;
  selected_item?: {
    original_item: string;
    selected_item: string;
    price_adjustment: number;
  };
  [key: string]: any;
}

interface ProductRuleData {
  product_type_id: string;
  rule_type: string;
  title: string;
  description?: string;
  required?: boolean;
  max_items?: number | null;
  conflict_with?: string[] | null;
  dependencies?: string[] | null;
  available_options?: string | null;
  preview_image_url?: string | null;
  display_order?: number;
}

class CustomizationService {
  private tempDir = path.join(process.cwd(), "temp_customizations");

  constructor() {
    this.ensureTempDir();
  }

  private async ensureTempDir() {
    try {
      await fs.access(this.tempDir);
    } catch {
      await fs.mkdir(this.tempDir, { recursive: true });
      console.log("📁 Diretório de customizações temporárias criado");
    }
  }

  // ================ NEW: PRODUCT RULE METHODS ================

  /**
   * Cria uma nova regra de customização (novo sistema)
   */
  async createProductRule(data: ProductRuleData) {
    return prisma.productRule.create({
      data: {
        ...data,
        conflict_with: data.conflict_with
          ? JSON.stringify(data.conflict_with)
          : null,
        dependencies: data.dependencies
          ? JSON.stringify(data.dependencies)
          : null,
      },
    });
  }

  /**
   * Busca regras de customização por tipo de produto
   */
  async getProductRulesByType(productTypeId: string) {
    const rules = await prisma.productRule.findMany({
      where: { product_type_id: productTypeId },
      orderBy: { display_order: "asc" },
    });

    return rules.map((rule) => ({
      ...rule,
      conflict_with: rule.conflict_with ? JSON.parse(rule.conflict_with) : null,
      dependencies: rule.dependencies ? JSON.parse(rule.dependencies) : null,
      available_options: rule.available_options
        ? JSON.parse(rule.available_options)
        : null,
    }));
  }

  /**
   * Busca regras de customização por ID de referência unificado
   * (Pode ser productId ou additionalId)
   */
  async getCustomizationsByReference(referenceId: string) {
    // Primeiro tenta buscar como produto
    const product = await prisma.product.findUnique({
      where: { id: referenceId },
      include: { type: true },
    });

    if (product) {
      // Buscar regras do tipo de produto
      const productRules = await this.getProductRulesByType(product.type_id);

      // Buscar regras antigas (retrocompatibilidade)
      const oldRules = await this.getProductCustomizations(referenceId);

      return {
        type: "product" as const,
        rules: productRules,
        legacy_rules: oldRules,
      };
    }

    // Se não for produto, tenta buscar como adicional
    const additional = await prisma.additional.findUnique({
      where: { id: referenceId },
    });

    if (additional) {
      // Por enquanto adicionais ainda usam sistema antigo
      const oldRules = await this.getAdditionalCustomizations(referenceId);
      return {
        type: "additional" as const,
        rules: [],
        legacy_rules: oldRules,
      };
    }

    return {
      type: null,
      rules: [],
      legacy_rules: [],
    };
  }

  /**
   * Atualiza uma regra de customização
   */
  async updateProductRule(id: string, data: Partial<ProductRuleData>) {
    const updateData: any = { ...data };

    if (data.conflict_with) {
      updateData.conflict_with = JSON.stringify(data.conflict_with);
    }
    if (data.dependencies) {
      updateData.dependencies = JSON.stringify(data.dependencies);
    }

    return prisma.productRule.update({
      where: { id },
      data: updateData,
    });
  }

  /**
   * Deleta uma regra de customização
   */
  async deleteProductRule(id: string) {
    return prisma.productRule.delete({
      where: { id },
    });
  }

  /**
   * Valida regras de customização aplicadas
   */
  async validateProductRules(
    productId: string,
    customizations: any[]
  ): Promise<{ valid: boolean; errors: string[] }> {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { type: true },
    });

    if (!product) {
      return { valid: false, errors: ["Produto não encontrado"] };
    }

    const rules = await this.getProductRulesByType(product.type_id);
    const errors: string[] = [];

    // Validar campos obrigatórios
    for (const rule of rules) {
      if (rule.required) {
        const hasCustomization = customizations.some(
          (c) => c.rule_id === rule.id || c.customization_rule_id === rule.id
        );

        if (!hasCustomization) {
          errors.push(`Campo obrigatório não preenchido: ${rule.title}`);
        }
      }
    }

    // Validar max_items
    for (const customization of customizations) {
      const rule = rules.find(
        (r) =>
          r.id === customization.rule_id ||
          r.id === customization.customization_rule_id
      );

      if (rule && rule.max_items && customization.data) {
        const dataObj =
          typeof customization.data === "string"
            ? JSON.parse(customization.data)
            : customization.data;

        if (dataObj.photos && dataObj.photos.length > rule.max_items) {
          errors.push(
            `${rule.title}: máximo de ${rule.max_items} itens permitidos`
          );
        }
      }
    }

    // Validar conflitos
    const appliedRuleIds = customizations.map(
      (c) => c.rule_id || c.customization_rule_id
    );

    for (const customization of customizations) {
      const rule = rules.find(
        (r) =>
          r.id === customization.rule_id ||
          r.id === customization.customization_rule_id
      );

      if (rule && rule.conflict_with && Array.isArray(rule.conflict_with)) {
        const conflictingRules = appliedRuleIds.filter((id: string) =>
          rule.conflict_with!.includes(id)
        );

        if (conflictingRules.length > 0) {
          errors.push(
            `${rule.title}: conflita com outra customização selecionada`
          );
        }
      }
    }

    // Validar dependências
    for (const customization of customizations) {
      const rule = rules.find(
        (r) =>
          r.id === customization.rule_id ||
          r.id === customization.customization_rule_id
      );

      if (rule && rule.dependencies && Array.isArray(rule.dependencies)) {
        const missingDeps = rule.dependencies.filter(
          (depId: string) => !appliedRuleIds.includes(depId)
        );

        if (missingDeps.length > 0) {
          errors.push(
            `${rule.title}: requer outra customização que não foi selecionada`
          );
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  // ================ EXISTING METHODS (Mantidos para retrocompatibilidade) ================

  /**
   * Salva arquivo temporariamente no servidor
   */
  async saveTemporaryFile(
    sessionId: string,
    file: Express.Multer.File
  ): Promise<TemporaryFile> {
    await this.ensureTempDir();

    const storedFilename = `${randomUUID()}_${file.originalname}`;
    const filePath = path.join(this.tempDir, storedFilename);

    try {
      await fs.writeFile(filePath, file.buffer);

      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 48); // 48h de expiração

      const tempFile = await prisma.temporaryCustomizationFile.create({
        data: {
          session_id: sessionId,
          original_name: file.originalname,
          stored_filename: storedFilename,
          file_path: filePath,
          mime_type: file.mimetype,
          size: file.size,
          expires_at: expiresAt,
        },
      });

      console.log(
        `💾 Arquivo temporário salvo: ${
          file.originalname
        } (sessão: ${sessionId.substring(0, 8)}...)`
      );

      return tempFile as TemporaryFile;
    } catch (error: any) {
      // Se houver erro ao salvar no DB, deletar arquivo físico
      try {
        await fs.unlink(filePath);
      } catch {}
      throw new Error(`Erro ao salvar arquivo temporário: ${error.message}`);
    }
  }

  /**
   * Busca arquivo temporário por ID
   */
  async getTemporaryFile(fileId: string): Promise<TemporaryFile | null> {
    return prisma.temporaryCustomizationFile.findUnique({
      where: { id: fileId },
    }) as Promise<TemporaryFile | null>;
  }

  /**
   * Busca todos os arquivos de uma sessão
   */
  async getSessionFiles(sessionId: string): Promise<TemporaryFile[]> {
    return prisma.temporaryCustomizationFile.findMany({
      where: { session_id: sessionId },
      orderBy: { created_at: "asc" },
    }) as Promise<TemporaryFile[]>;
  }

  /**
   * Deleta arquivo temporário
   */
  async deleteTemporaryFile(fileId: string): Promise<void> {
    const file = await this.getTemporaryFile(fileId);
    if (!file) return;

    try {
      await fs.unlink(file.file_path);
    } catch (error: any) {
      console.warn(
        `⚠️ Arquivo físico não encontrado: ${file.file_path}`,
        error.message
      );
    }

    await prisma.temporaryCustomizationFile.delete({
      where: { id: fileId },
    });

    console.log(`🗑️ Arquivo temporário deletado: ${file.original_name}`);
  }

  /**
   * Limpa arquivos temporários expirados
   */
  async cleanupExpiredFiles(): Promise<number> {
    const expiredFiles = await prisma.temporaryCustomizationFile.findMany({
      where: {
        expires_at: {
          lt: new Date(),
        },
      },
    });

    let deletedCount = 0;

    for (const file of expiredFiles) {
      try {
        await fs.unlink(file.file_path);
        await prisma.temporaryCustomizationFile.delete({
          where: { id: file.id },
        });
        deletedCount++;
      } catch (error: any) {
        console.error(`❌ Erro ao limpar arquivo ${file.id}:`, error.message);
      }
    }

    if (deletedCount > 0) {
      console.log(
        `🧹 ${deletedCount} arquivo(s) temporário(s) expirado(s) limpo(s)`
      );
    }

    return deletedCount;
  }

  /**
   * Busca customizações de um produto
   */
  async getProductCustomizations(productId: string) {
    return prisma.productCustomization.findMany({
      where: { product_id: productId },
      orderBy: { display_order: "asc" },
    });
  }

  /**
   * Busca customizações de um adicional
   */
  async getAdditionalCustomizations(additionalId: string) {
    return prisma.additionalCustomization.findMany({
      where: { additional_id: additionalId },
      orderBy: { display_order: "asc" },
    });
  }

  /**
   * Cria regra de customização para produto
   */
  async createProductCustomization(data: any) {
    return prisma.productCustomization.create({
      data,
    });
  }

  /**
   * Cria regra de customização para adicional
   */
  async createAdditionalCustomization(data: any) {
    return prisma.additionalCustomization.create({
      data,
    });
  }

  /**
   * Atualiza regra de customização de produto
   */
  async updateProductCustomization(id: string, data: any) {
    return prisma.productCustomization.update({
      where: { id },
      data,
    });
  }

  /**
   * Atualiza regra de customização de adicional
   */
  async updateAdditionalCustomization(id: string, data: any) {
    return prisma.additionalCustomization.update({
      where: { id },
      data,
    });
  }

  /**
   * Deleta regra de customização de produto
   */
  async deleteProductCustomization(id: string) {
    return prisma.productCustomization.delete({
      where: { id },
    });
  }

  /**
   * Deleta regra de customização de adicional
   */
  async deleteAdditionalCustomization(id: string) {
    return prisma.additionalCustomization.delete({
      where: { id },
    });
  }

  /**
   * Processa customizações de um pedido (após pagamento aprovado)
   */
  async processOrderCustomizations(orderId: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            customizations: true,
          },
        },
        user: true,
      },
    });

    if (!order) {
      throw new Error("Pedido não encontrado");
    }

    // Verificar se há customizações para processar
    const hasCustomizations = order.items.some(
      (item) => item.customizations.length > 0
    );

    if (!hasCustomizations) {
      console.log(`📦 Pedido ${orderId} não possui customizações`);
      return null;
    }

    // Criar pasta principal no Google Drive
    const folderName = `Pedido_${order.user.name.replace(
      /[^a-zA-Z0-9]/g,
      "_"
    )}_${new Date().toISOString().split("T")[0]}_${orderId.substring(0, 8)}`;

    const folderId = await googleDriveService.createFolder(folderName);

    // Processar cada item com customização
    for (const item of order.items) {
      if (item.customizations.length === 0) continue;

      for (const customization of item.customizations) {
        if (customization.customization_type === "PHOTO_UPLOAD") {
          await this.processPhotoUploadCustomization(customization, folderId);
        }
      }
    }

    // Retornar informações da pasta
    return {
      id: folderId,
      url: googleDriveService.getFolderUrl(folderId),
    };

    console.log(
      `✅ Customizações do pedido ${orderId} processadas com sucesso`
    );

    // Retornar informações da pasta
    return {
      id: folderId,
      url: googleDriveService.getFolderUrl(folderId),
    };
  }

  /**
   * Processa customização do tipo PHOTO_UPLOAD
   */
  private async processPhotoUploadCustomization(
    customization: any,
    folderId: string
  ) {
    const data: CustomizationData = JSON.parse(
      customization.customization_data
    );

    if (!data.photos || data.photos.length === 0) {
      console.warn(
        `⚠️ Customização ${customization.id} não possui fotos para processar`
      );
      return;
    }

    // Buscar arquivos temporários
    const tempFiles = await Promise.all(
      data.photos.map((photo) => this.getTemporaryFile(photo.temp_file_id))
    );

    // Filtrar arquivos válidos
    const validFiles = tempFiles.filter((file) => file !== null);

    if (validFiles.length === 0) {
      console.warn(
        `⚠️ Nenhum arquivo temporário encontrado para customização ${customization.id}`
      );
      return;
    }

    // Upload para Google Drive
    const uploadedFiles = await googleDriveService.uploadMultipleFiles(
      validFiles.map((tf) => ({
        path: tf!.file_path,
        name: tf!.original_name,
      })),
      folderId
    );

    // Gerar URL pública da pasta
    const folderUrl = googleDriveService.getFolderUrl(folderId);

    // Atualizar customização com URL da pasta
    await prisma.orderItemCustomization.update({
      where: { id: customization.id },
      data: {
        google_drive_folder_id: folderId,
        google_drive_url: folderUrl,
      },
    });

    // Deletar arquivos temporários
    for (const tempFile of validFiles) {
      if (tempFile) {
        await this.deleteTemporaryFile(tempFile.id);
      }
    }

    console.log(
      `📤 ${uploadedFiles.length} foto(s) enviada(s) para o Google Drive com sucesso`
    );
  }

  /**
   * Valida se customizações obrigatórias foram preenchidas
   */
  async validateRequiredCustomizations(
    productId: string,
    customizations: any[]
  ): Promise<{ valid: boolean; missing: string[] }> {
    const requiredRules = await prisma.productCustomization.findMany({
      where: {
        product_id: productId,
        is_required: true,
      },
    });

    const missing: string[] = [];

    for (const rule of requiredRules) {
      const hasCustomization = customizations.some(
        (c) => c.customization_rule_id === rule.id
      );

      if (!hasCustomization) {
        missing.push(rule.title);
      }
    }

    return {
      valid: missing.length === 0,
      missing,
    };
  }
}

export default new CustomizationService();
