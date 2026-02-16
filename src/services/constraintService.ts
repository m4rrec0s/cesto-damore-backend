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
  

  async createConstraint(data: ItemConstraintData) {

    console.warn("createConstraint: funcionalidade desabilitada");
    return null;
  }

  

  async getItemConstraints(itemId: string, itemType: "PRODUCT" | "ADDITIONAL") {

    return [];
  }

  

  async updateConstraint(id: string, data: Partial<ItemConstraintData>) {

    console.warn("updateConstraint: funcionalidade desabilitada");
    return null;
  }

  

  async deleteConstraint(id: string) {

    console.warn("deleteConstraint: funcionalidade desabilitada");
    return { success: true };
  }

  

  async validateItemConstraints(
    cartItems: CartItem[],
  ): Promise<ValidationResult> {

    return {
      valid: true,
      errors: [],
    };
  }

  

  private isItemPresent(
    itemId: string,
    itemType: string,
    productIds: string[],
    additionalIds: string[],
  ): boolean {
    return false;
  }

  

  async listAllConstraints() {

    return [];
  }
}

export default new ConstraintService();
