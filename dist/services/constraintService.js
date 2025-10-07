"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = __importDefault(require("../database/prisma"));
class ConstraintService {
    /**
     * Cria uma nova restrição entre itens
     */
    async createConstraint(data) {
        return prisma_1.default.itemConstraint.create({
            data,
        });
    }
    /**
     * Busca restrições de um item específico
     */
    async getItemConstraints(itemId, itemType) {
        return prisma_1.default.itemConstraint.findMany({
            where: {
                OR: [
                    { target_item_id: itemId, target_item_type: itemType },
                    { related_item_id: itemId, related_item_type: itemType },
                ],
            },
        });
    }
    /**
     * Atualiza uma restrição existente
     */
    async updateConstraint(id, data) {
        return prisma_1.default.itemConstraint.update({
            where: { id },
            data,
        });
    }
    /**
     * Deleta uma restrição
     */
    async deleteConstraint(id) {
        return prisma_1.default.itemConstraint.delete({
            where: { id },
        });
    }
    /**
     * Valida restrições de itens no carrinho
     */
    async validateItemConstraints(cartItems) {
        const errors = [];
        // Extrair IDs de produtos e adicionais presentes no carrinho
        const productIds = cartItems
            .filter((item) => item.product_id)
            .map((item) => item.product_id);
        const additionalIds = cartItems.flatMap((item) => {
            const ids = [];
            if (item.additional_id)
                ids.push(item.additional_id);
            if (item.additionals) {
                ids.push(...item.additionals.map((add) => add.additional_id));
            }
            return ids;
        });
        // Buscar todas as restrições aplicáveis
        const allConstraints = await prisma_1.default.itemConstraint.findMany({
            where: {
                OR: [
                    {
                        target_item_id: { in: [...productIds, ...additionalIds] },
                    },
                    {
                        related_item_id: { in: [...productIds, ...additionalIds] },
                    },
                ],
            },
        });
        // Validar cada restrição
        for (const constraint of allConstraints) {
            const targetPresent = this.isItemPresent(constraint.target_item_id, constraint.target_item_type, productIds, additionalIds);
            const relatedPresent = this.isItemPresent(constraint.related_item_id, constraint.related_item_type, productIds, additionalIds);
            if (constraint.constraint_type === "MUTUALLY_EXCLUSIVE") {
                // Se ambos estão presentes, é um erro
                if (targetPresent && relatedPresent) {
                    errors.push(constraint.message ||
                        `Os itens "${constraint.target_item_id}" e "${constraint.related_item_id}" não podem ser adicionados juntos.`);
                }
            }
            else if (constraint.constraint_type === "REQUIRES") {
                // Se o item principal está presente mas o requerido não, é um erro
                if (targetPresent && !relatedPresent) {
                    errors.push(constraint.message ||
                        `O item "${constraint.target_item_id}" requer "${constraint.related_item_id}".`);
                }
            }
        }
        return {
            valid: errors.length === 0,
            errors,
        };
    }
    /**
     * Verifica se um item está presente nas listas fornecidas
     */
    isItemPresent(itemId, itemType, productIds, additionalIds) {
        if (itemType === "PRODUCT") {
            return productIds.includes(itemId);
        }
        else if (itemType === "ADDITIONAL") {
            return additionalIds.includes(itemId);
        }
        return false;
    }
    /**
     * Lista todas as restrições cadastradas
     */
    async listAllConstraints() {
        return prisma_1.default.itemConstraint.findMany({
            orderBy: { created_at: "desc" },
        });
    }
}
exports.default = new ConstraintService();
