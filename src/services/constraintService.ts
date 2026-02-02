import prisma from "../database/prisma";

interface ItemConstraintData {
  target_item_id: string;
  target_item_type: "PRODUCT" | "ADDITIONAL";
  constraint_type: "MUTUALLY_EXCLUSIVE" | "REQUIRES";
  related_item_id: string;
  related_item_type: "PRODUCT" | "ADDITIONAL";
  message?: string;
}

interface CartItem {
  product_id?: string;
  additional_id?: string;
  additionals?: Array<{
    additional_id: string;
  }>;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

class ConstraintService {
  /**
   * Cria uma nova restrição entre itens
   */
  async createConstraint(data: ItemConstraintData) {
    // Tabela ItemConstraint foi removida do schema
    console.warn("createConstraint: funcionalidade desabilitada");
    return null;
  }

  /**
   * Busca restrições de um item específico
   */
  async getItemConstraints(itemId: string, itemType: "PRODUCT" | "ADDITIONAL") {
    // Tabela ItemConstraint foi removida do schema
    return [];
  }

  /**
   * Atualiza uma restrição existente
   */
  async updateConstraint(id: string, data: Partial<ItemConstraintData>) {
    // Tabela ItemConstraint foi removida do schema
    console.warn("updateConstraint: funcionalidade desabilitada");
    return null;
  }

  /**
   * Deleta uma restrição
   */
  async deleteConstraint(id: string) {
    // Tabela ItemConstraint foi removida do schema
    console.warn("deleteConstraint: funcionalidade desabilitada");
    return { success: true };
  }

  /**
   * Valida restrições de itens no carrinho
   */
  async validateItemConstraints(
    cartItems: CartItem[],
  ): Promise<ValidationResult> {
    // Tabela ItemConstraint foi removida do schema
    return {
      valid: true,
      errors: [],
    };
  }

  /**
   * Verifica se um item está presente nas listas fornecidas
   */
  private isItemPresent(
    itemId: string,
    itemType: string,
    productIds: string[],
    additionalIds: string[],
  ): boolean {
    return false;
  }

  /**
   * Lista todas as restrições cadastradas
   */
  async listAllConstraints() {
    // Tabela ItemConstraint foi removida do schema
    return [];
  }
}

export default new ConstraintService();
