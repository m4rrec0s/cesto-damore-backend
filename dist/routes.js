"use strict";
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
const checkoutTransparente_1 = __importDefault(require("./routes/checkoutTransparente"));
const multer_1 = require("./config/multer");
const security_1 = require("./middleware/security");
const router = (0, express_1.Router)();
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
// Checkout Transparente Routes
router.use(checkoutTransparente_1.default);
exports.default = router;
