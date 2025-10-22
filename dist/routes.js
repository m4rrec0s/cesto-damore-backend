"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const additionalController_1 = __importDefault(require("./controller/additionalController"));
const productController_1 = __importDefault(require("./controller/productController"));
const categoryController_1 = __importDefault(require("./controller/categoryController"));
const userController_1 = __importDefault(require("./controller/userController"));
const orderController_1 = __importDefault(require("./controller/orderController"));
const typeController_1 = __importDefault(require("./controller/typeController"));
const authController_1 = __importDefault(require("./controller/authController"));
const paymentController_1 = __importDefault(require("./controller/paymentController"));
const feedController_1 = __importDefault(require("./controller/feedController"));
const uploadController_1 = __importDefault(require("./controller/uploadController"));
const colorController_1 = __importDefault(require("./controller/colorController"));
const reportController_1 = __importDefault(require("./controller/reportController"));
const whatsappController_1 = __importDefault(require("./controller/whatsappController"));
const customizationController_1 = __importDefault(require("./controller/customizationController"));
const orderCustomizationController_1 = __importDefault(require("./controller/orderCustomizationController"));
const productRuleController_1 = __importDefault(require("./controller/productRuleController"));
const itemConstraintController_1 = __importDefault(require("./controller/itemConstraintController"));
const customizationUploadController_1 = __importDefault(require("./controller/customizationUploadController"));
const oauthController_1 = __importDefault(require("./controller/oauthController"));
const itemController_1 = __importDefault(require("./controller/itemController"));
const productComponentController_1 = __importDefault(require("./controller/productComponentController"));
const layoutController_1 = __importDefault(require("./controller/layoutController"));
const layoutBaseController_1 = __importDefault(require("./controller/layoutBaseController"));
const personalizationController_1 = __importDefault(require("./controller/personalizationController"));
const multer_1 = require("./config/multer");
const security_1 = require("./middleware/security");
const healthCheck_1 = require("./middleware/healthCheck");
const router = (0, express_1.Router)();
// Health check endpoint
router.get("/health", healthCheck_1.healthCheckEndpoint);
// ============================================
// GOOGLE DRIVE OAUTH2
// ============================================
// GET /oauth/authorize - Gera URL de autenticação
router.get("/oauth/authorize", oauthController_1.default.authorize);
// GET /oauth/callback - Callback após autorização
router.get("/oauth/callback", oauthController_1.default.callback);
// GET /oauth/status - Verifica status da autenticação
router.get("/oauth/status", oauthController_1.default.status);
// Servir imagens de produtos/adicionais
router.get("/images/:filename", (req, res) => {
    try {
        const filename = req.params.filename;
        const imagesPath = path_1.default.join(process.cwd(), "images");
        const filePath = path_1.default.join(imagesPath, filename);
        if (!fs_1.default.existsSync(filePath)) {
            return res.status(404).json({
                error: "Imagem não encontrada",
                filename: filename,
            });
        }
        res.sendFile(filePath);
    }
    catch (error) {
        console.error("Erro ao servir imagem:", error.message);
        res.status(500).json({
            error: "Erro interno do servidor",
            message: error.message,
        });
    }
});
// Servir arquivos de customizações (subpastas)
router.get("/images/customizations/:folderId/:filename", (req, res) => {
    try {
        const { folderId, filename } = req.params;
        const customizationsPath = path_1.default.join(process.cwd(), "images", "customizations", folderId);
        const filePath = path_1.default.join(customizationsPath, filename);
        if (!fs_1.default.existsSync(filePath)) {
            return res.status(404).json({
                error: "Arquivo de customização não encontrado",
                folderId,
                filename,
            });
        }
        res.sendFile(filePath);
    }
    catch (error) {
        console.error("Erro ao servir arquivo de customização:", error.message);
        res.status(500).json({
            error: "Erro interno do servidor",
            message: error.message,
        });
    }
});
router.get("/additional", additionalController_1.default.index);
router.get("/additional/:id", additionalController_1.default.show);
router.post("/additional", multer_1.upload.single("image"), multer_1.convertImagesToWebP, additionalController_1.default.create);
router.put("/additional/:id", multer_1.upload.single("image"), multer_1.convertImagesToWebP, additionalController_1.default.update);
router.delete("/additional/:id", additionalController_1.default.remove);
router.post("/additional/:id/link", additionalController_1.default.link);
router.put("/additional/:id/link", additionalController_1.default.updateLink);
router.post("/additional/:id/unlink", additionalController_1.default.unlink);
router.get("/additional/:id/price", additionalController_1.default.getPrice);
router.get("/products/:productId/additionals", additionalController_1.default.getByProduct);
// product routes
router.get("/products", productController_1.default.index);
router.get("/products/:id", productController_1.default.show);
router.post("/products", multer_1.upload.single("image"), multer_1.convertImagesToWebP, productController_1.default.create);
router.put("/products/:id", multer_1.upload.single("image"), multer_1.convertImagesToWebP, productController_1.default.update);
router.delete("/products/:id", productController_1.default.remove);
router.post("/products/:id/link", productController_1.default.link);
router.post("/products/:id/unlink", productController_1.default.unlink);
// type routes
router.get("/types", typeController_1.default.index);
router.get("/types/:id", typeController_1.default.show);
router.post("/types", typeController_1.default.create);
router.put("/types/:id", typeController_1.default.update);
router.delete("/types/:id", typeController_1.default.remove);
// auth routes
router.post("/auth/google", authController_1.default.google);
router.post("/auth/login", authController_1.default.login);
router.post("/auth/register", multer_1.upload.single("image"), authController_1.default.register);
router.post("/auth/refresh", security_1.authenticateToken, authController_1.default.refreshToken); // Novo: renovar token
// Upload routes (public)
router.post("/upload/image", multer_1.upload.single("image"), multer_1.convertImagesToWebP, uploadController_1.default.uploadImage);
// category routes
router.get("/categories", categoryController_1.default.index);
router.get("/categories/:id", categoryController_1.default.show);
router.post("/categories", categoryController_1.default.create);
router.put("/categories/:id", categoryController_1.default.update);
router.delete("/categories/:id", categoryController_1.default.remove);
// color routes
router.get("/colors", colorController_1.default.index);
router.get("/colors/:id", colorController_1.default.show);
router.post("/colors", colorController_1.default.create);
router.put("/colors/:id", colorController_1.default.update);
router.delete("/colors/:id", colorController_1.default.remove);
// report routes
router.get("/reports/stock", reportController_1.default.getStockReport);
router.get("/reports/stock/critical", reportController_1.default.getCriticalStock);
router.get("/reports/stock/check", reportController_1.default.checkLowStock);
// whatsapp routes
router.get("/whatsapp/config", whatsappController_1.default.getConfig);
router.post("/whatsapp/test", whatsappController_1.default.testMessage);
router.post("/whatsapp/check-stock", whatsappController_1.default.checkStock);
router.post("/whatsapp/stock-summary", whatsappController_1.default.sendStockSummary);
// user routes
router.get("/users/me", security_1.authenticateToken, userController_1.default.me); // Novo: obter usuário logado
router.get("/users/cep/:zipCode", userController_1.default.getAddressByZipCode); // Novo: consultar CEP
router.get("/users", userController_1.default.index);
router.get("/users/:id", userController_1.default.show);
router.post("/users", multer_1.upload.single("image"), userController_1.default.create);
router.put("/users/:id", multer_1.upload.single("image"), userController_1.default.update);
router.delete("/users/:id", userController_1.default.remove);
// order routes
router.get("/orders", orderController_1.default.index);
router.get("/orders/:id", orderController_1.default.show);
router.post("/orders", orderController_1.default.create);
router.patch("/orders/:id/status", security_1.authenticateToken, security_1.requireAdmin, orderController_1.default.updateStatus);
router.delete("/orders/:id", orderController_1.default.remove);
// ========== PAYMENT ROUTES ==========
// Health check do Mercado Pago
router.get("/payment/health", paymentController_1.default.healthCheck);
// Webhook do Mercado Pago (sem autenticação)
router.post("/webhook/mercadopago", security_1.validateMercadoPagoWebhook, paymentController_1.default.handleWebhook);
// Páginas de retorno do checkout (sem autenticação)
router.get("/payment/success", paymentController_1.default.paymentSuccess);
router.get("/payment/failure", paymentController_1.default.paymentFailure);
router.get("/payment/pending", paymentController_1.default.paymentPending);
// Rotas de pagamento protegidas
router.post("/payment/preference", security_1.authenticateToken, security_1.paymentRateLimit, (0, security_1.logFinancialOperation)("CREATE_PREFERENCE"), paymentController_1.default.createPreference);
router.post("/payment/create", security_1.authenticateToken, security_1.paymentRateLimit, security_1.validatePaymentData, (0, security_1.logFinancialOperation)("CREATE_PAYMENT"), paymentController_1.default.createPayment);
// Criar token de cartão (para Checkout Transparente)
router.post("/mercadopago/create-token", security_1.authenticateToken, security_1.paymentRateLimit, async (req, res) => {
    const { createCardToken } = await Promise.resolve().then(() => __importStar(require("./controller/mercadopagoController")));
    return createCardToken(req, res);
});
// Buscar issuer do cartão (banco emissor)
router.post("/mercadopago/get-issuers", security_1.authenticateToken, security_1.paymentRateLimit, async (req, res) => {
    const { getCardIssuers } = await Promise.resolve().then(() => __importStar(require("./controller/mercadopagoController")));
    return getCardIssuers(req, res);
});
// Checkout Transparente (pagamento direto na aplicação)
router.post("/payment/transparent-checkout", security_1.authenticateToken, security_1.paymentRateLimit, (0, security_1.logFinancialOperation)("TRANSPARENT_CHECKOUT"), paymentController_1.default.processTransparentCheckout);
router.get("/payment/:paymentId/status", security_1.authenticateToken, (0, security_1.logFinancialOperation)("GET_PAYMENT_STATUS"), paymentController_1.default.getPaymentStatus);
router.post("/payment/:paymentId/cancel", security_1.authenticateToken, (0, security_1.logFinancialOperation)("CANCEL_PAYMENT"), paymentController_1.default.cancelPayment);
router.get("/payments/user", security_1.authenticateToken, (0, security_1.logFinancialOperation)("GET_USER_PAYMENTS"), paymentController_1.default.getUserPayments);
// Rotas administrativas
router.get("/admin/financial-summary", security_1.authenticateToken, security_1.requireAdmin, (0, security_1.logFinancialOperation)("GET_FINANCIAL_SUMMARY"), paymentController_1.default.getFinancialSummary);
// ========== FEED ROUTES ==========
// Rota pública para obter feed (sem autenticação)
router.get("/feed", feedController_1.default.getPublicFeed);
// Utilitários públicos
router.get("/feed/section-types", feedController_1.default.getSectionTypes);
// ============== ROTAS ADMINISTRATIVAS DE FEED ==============
// Feed Configuration Routes (Admin only)
router.get("/admin/feed/configurations", security_1.authenticateToken, security_1.requireAdmin, feedController_1.default.getAllConfigurations);
router.get("/admin/feed/configurations/:id", security_1.authenticateToken, security_1.requireAdmin, feedController_1.default.getConfiguration);
router.post("/admin/feed/configurations", security_1.authenticateToken, security_1.requireAdmin, feedController_1.default.createConfiguration);
router.put("/admin/feed/configurations/:id", security_1.authenticateToken, security_1.requireAdmin, feedController_1.default.updateConfiguration);
router.delete("/admin/feed/configurations/:id", security_1.authenticateToken, security_1.requireAdmin, feedController_1.default.deleteConfiguration);
// Feed Banner Routes (Admin only)
router.post("/admin/feed/banners", security_1.authenticateToken, security_1.requireAdmin, multer_1.upload.single("image"), multer_1.convertImagesToWebP, feedController_1.default.createBanner);
router.put("/admin/feed/banners/:id", security_1.authenticateToken, security_1.requireAdmin, multer_1.upload.single("image"), multer_1.convertImagesToWebP, feedController_1.default.updateBanner);
router.delete("/admin/feed/banners/:id", security_1.authenticateToken, security_1.requireAdmin, feedController_1.default.deleteBanner);
// Feed Section Routes (Admin only)
router.post("/admin/feed/sections", security_1.authenticateToken, security_1.requireAdmin, feedController_1.default.createSection);
router.put("/admin/feed/sections/:id", security_1.authenticateToken, security_1.requireAdmin, feedController_1.default.updateSection);
router.delete("/admin/feed/sections/:id", security_1.authenticateToken, security_1.requireAdmin, feedController_1.default.deleteSection);
// Feed Section Item Routes (Admin only)
router.post("/admin/feed/section-items", security_1.authenticateToken, security_1.requireAdmin, feedController_1.default.createSectionItem);
router.put("/admin/feed/section-items/:id", security_1.authenticateToken, security_1.requireAdmin, feedController_1.default.updateSectionItem);
router.delete("/admin/feed/section-items/:id", security_1.authenticateToken, security_1.requireAdmin, feedController_1.default.deleteSectionItem);
// ========== CUSTOMIZATION ROUTES ==========
// Public customization routes (REFATORADO para usar Items)
router.get("/items/:itemId/customizations", customizationController_1.default.getItemCustomizations);
router.post("/customizations/validate", customizationController_1.default.validateCustomizations);
router.post("/customizations/preview", customizationController_1.default.buildPreview);
// Order customization routes
router.get("/orders/:orderId/customizations", security_1.authenticateToken, orderCustomizationController_1.default.listOrderCustomizations);
router.post("/orders/:orderId/items/:itemId/customizations", security_1.authenticateToken, orderCustomizationController_1.default.saveOrderItemCustomization);
// ========== ITEMS ROUTES ==========
router.get("/items", itemController_1.default.index);
router.get("/items/available", itemController_1.default.getAvailable);
router.get("/items/customizable", itemController_1.default.getWithCustomizations);
router.get("/items/:id", itemController_1.default.show);
router.post("/items", security_1.authenticateToken, security_1.requireAdmin, multer_1.upload.single("image"), multer_1.convertImagesToWebP, itemController_1.default.create);
router.put("/items/:id", security_1.authenticateToken, security_1.requireAdmin, multer_1.upload.single("image"), multer_1.convertImagesToWebP, itemController_1.default.update);
router.put("/items/:id/stock", security_1.authenticateToken, security_1.requireAdmin, itemController_1.default.updateStock);
router.delete("/items/:id", security_1.authenticateToken, security_1.requireAdmin, itemController_1.default.delete);
// ========== PRODUCT COMPONENTS ROUTES ==========
router.get("/products/:productId/components", productComponentController_1.default.getProductComponents);
router.post("/products/:productId/components", security_1.authenticateToken, security_1.requireAdmin, productComponentController_1.default.addComponent);
router.put("/components/:componentId", security_1.authenticateToken, security_1.requireAdmin, productComponentController_1.default.updateComponent);
router.delete("/components/:componentId", security_1.authenticateToken, security_1.requireAdmin, productComponentController_1.default.removeComponent);
router.get("/products/:productId/stock/calculate", productComponentController_1.default.calculateProductStock);
router.post("/products/:productId/stock/validate", productComponentController_1.default.validateComponentsStock);
router.get("/items/:itemId/products", productComponentController_1.default.getProductsUsingItem);
// ========== CUSTOMIZATION IMAGE UPLOAD ROUTES ==========
// Upload de imagem para preview de customização (Admin)
router.post("/customization/upload-image", security_1.authenticateToken, security_1.requireAdmin, multer_1.upload.single("image"), multer_1.convertImagesToWebP, customizationUploadController_1.default.uploadImage);
// Delete de imagem de customização (Admin)
router.delete("/customization/image/:filename", security_1.authenticateToken, security_1.requireAdmin, customizationUploadController_1.default.deleteImage);
// Admin routes for ProductRule management
router.get("/admin/customization/rule/type/:productTypeId", security_1.authenticateToken, security_1.requireAdmin, productRuleController_1.default.getRulesByType);
router.post("/admin/customization/rule", security_1.authenticateToken, security_1.requireAdmin, multer_1.upload.single("image"), multer_1.convertImagesToWebP, productRuleController_1.default.createRule);
router.put("/admin/customization/rule/:ruleId", security_1.authenticateToken, security_1.requireAdmin, multer_1.upload.single("image"), multer_1.convertImagesToWebP, productRuleController_1.default.updateRule);
router.delete("/admin/customization/rule/:ruleId", security_1.authenticateToken, security_1.requireAdmin, productRuleController_1.default.deleteRule);
// ========== ITEM CONSTRAINTS ROUTES ==========
// Listar todos os constraints
router.get("/admin/constraints", security_1.authenticateToken, security_1.requireAdmin, itemConstraintController_1.default.listAll);
// Buscar constraints de um item específico
router.get("/admin/constraints/item/:itemType/:itemId", security_1.authenticateToken, security_1.requireAdmin, itemConstraintController_1.default.getByItem);
// Buscar produtos/adicionais para autocomplete
router.get("/admin/constraints/search", security_1.authenticateToken, security_1.requireAdmin, itemConstraintController_1.default.searchItems);
// Criar constraint
router.post("/admin/constraints", security_1.authenticateToken, security_1.requireAdmin, itemConstraintController_1.default.create);
// Atualizar constraint
router.put("/admin/constraints/:constraintId", security_1.authenticateToken, security_1.requireAdmin, itemConstraintController_1.default.update);
// Deletar constraint
router.delete("/admin/constraints/:constraintId", security_1.authenticateToken, security_1.requireAdmin, itemConstraintController_1.default.delete);
// ========== CUSTOMIZATION ROUTES ==========
// Listar todas as customizações (com filtro opcional por item)
router.get("/customizations", security_1.authenticateToken, security_1.requireAdmin, customizationController_1.default.index);
// Buscar customização por ID
router.get("/customizations/:id", security_1.authenticateToken, security_1.requireAdmin, customizationController_1.default.show);
// Criar customização
router.post("/customizations", security_1.authenticateToken, security_1.requireAdmin, customizationController_1.default.create);
// Atualizar customização
router.put("/customizations/:id", security_1.authenticateToken, security_1.requireAdmin, customizationController_1.default.update);
// Deletar customização
router.delete("/customizations/:id", security_1.authenticateToken, security_1.requireAdmin, customizationController_1.default.remove);
// Buscar customizações de um item (público - para clientes)
router.get("/items/:itemId/customizations", customizationController_1.default.getItemCustomizations);
// Validar customizações (público - para clientes)
router.post("/customizations/validate", customizationController_1.default.validateCustomizations);
// Gerar preview de customizações (público - para clientes)
router.post("/customizations/preview", customizationController_1.default.buildPreview);
// ========== LAYOUT 3D ROUTES ==========
// Listar layouts (com filtro opcional por item)
router.get("/layouts", security_1.authenticateToken, security_1.requireAdmin, layoutController_1.default.index);
// Buscar layout por ID
router.get("/layouts/:id", security_1.authenticateToken, security_1.requireAdmin, layoutController_1.default.show);
// Criar layout 3D
router.post("/layouts", security_1.authenticateToken, security_1.requireAdmin, layoutController_1.default.create);
// Atualizar layout 3D
router.put("/layouts/:id", security_1.authenticateToken, security_1.requireAdmin, layoutController_1.default.update);
// Deletar layout 3D
router.delete("/layouts/:id", security_1.authenticateToken, security_1.requireAdmin, layoutController_1.default.remove);
// Upload de modelo 3D (.glb, .gltf)
router.post("/layouts/upload-3d", security_1.authenticateToken, security_1.requireAdmin, multer_1.upload3D.single("model"), layoutController_1.default.upload3DModel);
// Servir modelos 3D
router.get("/3d-models/:filename", (req, res) => {
    const filename = req.params.filename;
    const filePath = path_1.default.join(__dirname, "../public/3d-models", filename);
    if (!fs_1.default.existsSync(filePath)) {
        return res.status(404).json({ error: "Arquivo não encontrado" });
    }
    res.sendFile(filePath);
});
// ========== LAYOUT BASE ROUTES (ADMIN) ==========
// Listar layouts base
router.get("/admin/layouts", security_1.authenticateToken, security_1.requireAdmin, layoutBaseController_1.default.list);
// Buscar layout base por ID
router.get("/admin/layouts/:id", security_1.authenticateToken, security_1.requireAdmin, layoutBaseController_1.default.show);
// Criar layout base (SEM conversão WebP - mantém formato original)
router.post("/admin/layouts", security_1.authenticateToken, security_1.requireAdmin, multer_1.upload.single("image"), layoutBaseController_1.default.create);
// Atualizar layout base (SEM conversão WebP - mantém formato original)
router.put("/admin/layouts/:id", security_1.authenticateToken, security_1.requireAdmin, multer_1.upload.single("image"), layoutBaseController_1.default.update);
// Deletar layout base
router.delete("/admin/layouts/:id", security_1.authenticateToken, security_1.requireAdmin, layoutBaseController_1.default.delete);
// ========== PERSONALIZATION ROUTES ==========
// Gerar preview da composição (público - para preview no cliente)
router.post("/preview/compose", personalizationController_1.default.preview);
// Commit de personalização (requer autenticação)
router.post("/orders/:orderId/items/:itemId/personalize/commit", security_1.authenticateToken, personalizationController_1.default.commit);
// Buscar personalização por ID
router.get("/personalizations/:id", security_1.authenticateToken, personalizationController_1.default.show);
// Listar personalizações de um pedido
router.get("/orders/:orderId/personalizations", security_1.authenticateToken, personalizationController_1.default.listByOrder);
exports.default = router;
