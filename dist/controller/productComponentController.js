"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const productComponentService_1 = __importDefault(require("../services/productComponentService"));
class ProductComponentController {
    /**
     * Adiciona item como componente de um produto
     */
    async addComponent(req, res) {
        try {
            const { productId } = req.params;
            const { item_id, quantity } = req.body;
            if (!item_id) {
                return res.status(400).json({ error: "Item ID é obrigatório" });
            }
            if (!quantity || quantity <= 0) {
                return res.status(400).json({
                    error: "Quantidade é obrigatória e deve ser maior que zero",
                });
            }
            const component = await productComponentService_1.default.addComponent({
                product_id: productId,
                item_id,
                quantity,
            });
            // Atualizar estoque do produto após adicionar componente
            const newStock = await productComponentService_1.default.updateProductStock(productId);
            res.status(201).json({
                component,
                product_stock: newStock,
            });
        }
        catch (error) {
            console.error("Erro ao adicionar componente:", error);
            if (error.message.includes("não encontrado") ||
                error.message.includes("já foi adicionado")) {
                res.status(400).json({ error: error.message });
            }
            else {
                res.status(500).json({
                    error: "Erro ao adicionar componente",
                    details: error.message,
                });
            }
        }
    }
    /**
     * Atualiza quantidade de um componente
     */
    async updateComponent(req, res) {
        try {
            const { componentId } = req.params;
            const { quantity } = req.body;
            if (!quantity || quantity <= 0) {
                return res.status(400).json({
                    error: "Quantidade é obrigatória e deve ser maior que zero",
                });
            }
            const component = await productComponentService_1.default.updateComponent(componentId, { quantity });
            // Atualizar estoque do produto após atualizar componente
            const newStock = await productComponentService_1.default.updateProductStock(component.product_id);
            res.json({
                component,
                product_stock: newStock,
            });
        }
        catch (error) {
            console.error("Erro ao atualizar componente:", error);
            if (error.message.includes("não encontrado")) {
                res.status(404).json({ error: error.message });
            }
            else {
                res.status(500).json({
                    error: "Erro ao atualizar componente",
                    details: error.message,
                });
            }
        }
    }
    /**
     * Remove componente de um produto
     */
    async removeComponent(req, res) {
        try {
            const { componentId } = req.params;
            const component = await productComponentService_1.default.removeComponent(componentId);
            // Atualizar estoque do produto após remover componente
            const newStock = await productComponentService_1.default.updateProductStock(component.product_id);
            res.json({
                message: "Componente removido com sucesso",
                product_stock: newStock,
            });
        }
        catch (error) {
            console.error("Erro ao remover componente:", error);
            if (error.message.includes("não encontrado")) {
                res.status(404).json({ error: error.message });
            }
            else {
                res.status(500).json({
                    error: "Erro ao remover componente",
                    details: error.message,
                });
            }
        }
    }
    /**
     * Lista componentes de um produto
     */
    async getProductComponents(req, res) {
        try {
            const { productId } = req.params;
            const components = await productComponentService_1.default.getProductComponents(productId);
            res.json({
                product_id: productId,
                components,
                total_components: components.length,
            });
        }
        catch (error) {
            console.error("Erro ao buscar componentes:", error);
            res.status(500).json({
                error: "Erro ao buscar componentes",
                details: error.message,
            });
        }
    }
    /**
     * Calcula estoque disponível do produto
     */
    async calculateProductStock(req, res) {
        try {
            const { productId } = req.params;
            const availableStock = await productComponentService_1.default.calculateProductStock(productId);
            res.json({
                product_id: productId,
                available_stock: availableStock,
            });
        }
        catch (error) {
            console.error("Erro ao calcular estoque:", error);
            res.status(500).json({
                error: "Erro ao calcular estoque",
                details: error.message,
            });
        }
    }
    /**
     * Valida se há estoque suficiente para os componentes
     */
    async validateComponentsStock(req, res) {
        try {
            const { productId } = req.params;
            const { quantity } = req.body;
            if (!quantity || quantity <= 0) {
                return res.status(400).json({
                    error: "Quantidade é obrigatória e deve ser maior que zero",
                });
            }
            const validation = await productComponentService_1.default.validateComponentsStock(productId, quantity);
            if (validation.valid) {
                res.json({
                    valid: true,
                    message: "Estoque suficiente para os componentes",
                });
            }
            else {
                res.status(400).json({
                    valid: false,
                    errors: validation.errors,
                });
            }
        }
        catch (error) {
            console.error("Erro ao validar estoque:", error);
            res.status(500).json({
                error: "Erro ao validar estoque",
                details: error.message,
            });
        }
    }
    /**
     * Busca produtos que usam um item específico
     */
    async getProductsUsingItem(req, res) {
        try {
            const { itemId } = req.params;
            const products = await productComponentService_1.default.getProductsUsingItem(itemId);
            res.json({
                item_id: itemId,
                products,
                total_products: products.length,
            });
        }
        catch (error) {
            console.error("Erro ao buscar produtos:", error);
            res.status(500).json({
                error: "Erro ao buscar produtos",
                details: error.message,
            });
        }
    }
}
exports.default = new ProductComponentController();
