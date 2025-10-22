import { Router } from "express";
import { Request, Response } from "express";
import path from "path";
import fs from "fs";
import additionalController from "./controller/additionalController";
import productController from "./controller/productController";
import categoryController from "./controller/categoryController";
import userController from "./controller/userController";
import orderController from "./controller/orderController";
import typeController from "./controller/typeController";
import authController from "./controller/authController";
import PaymentController from "./controller/paymentController";
import feedController from "./controller/feedController";
import uploadController from "./controller/uploadController";
import colorController from "./controller/colorController";
import reportController from "./controller/reportController";
import whatsappController from "./controller/whatsappController";
import customizationController from "./controller/customizationController";
import orderCustomizationController from "./controller/orderCustomizationController";
import productRuleController from "./controller/productRuleController";
import itemConstraintController from "./controller/itemConstraintController";
import customizationUploadController from "./controller/customizationUploadController";
import oauthController from "./controller/oauthController";
import itemController from "./controller/itemController";
import productComponentController from "./controller/productComponentController";
import layoutController from "./controller/layoutController";
import layoutBaseController from "./controller/layoutBaseController";
import personalizationController from "./controller/personalizationController";
import {
  upload,
  convertImagesToWebP,
  upload3D,
  uploadTemp,
} from "./config/multer";
import {
  authenticateToken,
  requireAdmin,
  validateMercadoPagoWebhook,
  paymentRateLimit,
  validatePaymentData,
  logFinancialOperation,
} from "./middleware/security";
import { healthCheckEndpoint } from "./middleware/healthCheck";

const router = Router();

// Health check endpoint
router.get("/health", healthCheckEndpoint);

// ============================================
// GOOGLE DRIVE OAUTH2
// ============================================
// GET /oauth/authorize - Gera URL de autenticação
router.get("/oauth/authorize", oauthController.authorize);

// GET /oauth/callback - Callback após autorização
router.get("/oauth/callback", oauthController.callback);

// GET /oauth/status - Verifica status da autenticação
router.get("/oauth/status", oauthController.status);

// Servir imagens de produtos/adicionais
router.get("/images/:filename", (req: Request, res: Response) => {
  try {
    const filename = req.params.filename;
    const imagesPath = path.join(process.cwd(), "images");
    const filePath = path.join(imagesPath, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        error: "Imagem não encontrada",
        filename: filename,
      });
    }

    res.sendFile(filePath);
  } catch (error: any) {
    console.error("Erro ao servir imagem:", error.message);
    res.status(500).json({
      error: "Erro interno do servidor",
      message: error.message,
    });
  }
});

// Servir arquivos de customizações (subpastas)
router.get(
  "/images/customizations/:folderId/:filename",
  (req: Request, res: Response) => {
    try {
      const { folderId, filename } = req.params;
      const customizationsPath = path.join(
        process.cwd(),
        "images",
        "customizations",
        folderId
      );
      const filePath = path.join(customizationsPath, filename);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({
          error: "Arquivo de customização não encontrado",
          folderId,
          filename,
        });
      }

      res.sendFile(filePath);
    } catch (error: any) {
      console.error("Erro ao servir arquivo de customização:", error.message);
      res.status(500).json({
        error: "Erro interno do servidor",
        message: error.message,
      });
    }
  }
);

router.get("/additional", additionalController.index);
router.get("/additional/:id", additionalController.show);
router.post(
  "/additional",
  upload.single("image"),
  convertImagesToWebP,
  additionalController.create
);
router.put(
  "/additional/:id",
  upload.single("image"),
  convertImagesToWebP,
  additionalController.update
);
router.delete("/additional/:id", additionalController.remove);
router.post("/additional/:id/link", additionalController.link);
router.put("/additional/:id/link", additionalController.updateLink);
router.post("/additional/:id/unlink", additionalController.unlink);
router.get("/additional/:id/price", additionalController.getPrice);
router.get(
  "/products/:productId/additionals",
  additionalController.getByProduct
);

// product routes
router.get("/products", productController.index);
router.get("/products/:id", productController.show);
router.post(
  "/products",
  upload.single("image"),
  convertImagesToWebP,
  productController.create
);
router.put(
  "/products/:id",
  upload.single("image"),
  convertImagesToWebP,
  productController.update
);
router.delete("/products/:id", productController.remove);
router.post("/products/:id/link", productController.link);
router.post("/products/:id/unlink", productController.unlink);

// type routes
router.get("/types", typeController.index);
router.get("/types/:id", typeController.show);
router.post("/types", typeController.create);
router.put("/types/:id", typeController.update);
router.delete("/types/:id", typeController.remove);

// auth routes
router.post("/auth/google", authController.google);
router.post("/auth/login", authController.login);
router.post("/auth/register", upload.single("image"), authController.register);
router.post("/auth/refresh", authenticateToken, authController.refreshToken); // Novo: renovar token

// Upload routes (public)
router.post(
  "/upload/image",
  upload.single("image"),
  convertImagesToWebP,
  uploadController.uploadImage
);

// category routes
router.get("/categories", categoryController.index);
router.get("/categories/:id", categoryController.show);
router.post("/categories", categoryController.create);
router.put("/categories/:id", categoryController.update);
router.delete("/categories/:id", categoryController.remove);

// color routes
router.get("/colors", colorController.index);
router.get("/colors/:id", colorController.show);
router.post("/colors", colorController.create);
router.put("/colors/:id", colorController.update);
router.delete("/colors/:id", colorController.remove);

// report routes
router.get("/reports/stock", reportController.getStockReport);
router.get("/reports/stock/critical", reportController.getCriticalStock);
router.get("/reports/stock/check", reportController.checkLowStock);

// whatsapp routes
router.get("/whatsapp/config", whatsappController.getConfig);
router.post("/whatsapp/test", whatsappController.testMessage);
router.post("/whatsapp/check-stock", whatsappController.checkStock);
router.post("/whatsapp/stock-summary", whatsappController.sendStockSummary);

// user routes
router.get("/users/me", authenticateToken, userController.me); // Novo: obter usuário logado
router.get("/users/cep/:zipCode", userController.getAddressByZipCode); // Novo: consultar CEP
router.get("/users", userController.index);
router.get("/users/:id", userController.show);
router.post("/users", upload.single("image"), userController.create);
router.put("/users/:id", upload.single("image"), userController.update);
router.delete("/users/:id", userController.remove);

// order routes
router.get("/orders", orderController.index);
router.get("/orders/:id", orderController.show);
router.post("/orders", orderController.create);
router.patch(
  "/orders/:id/status",
  authenticateToken,
  requireAdmin,
  orderController.updateStatus
);
router.delete("/orders/:id", orderController.remove);

// ========== PAYMENT ROUTES ==========

// Health check do Mercado Pago
router.get("/payment/health", PaymentController.healthCheck);

// Webhook do Mercado Pago (sem autenticação)
router.post(
  "/webhook/mercadopago",
  validateMercadoPagoWebhook,
  PaymentController.handleWebhook
);

// Páginas de retorno do checkout (sem autenticação)
router.get("/payment/success", PaymentController.paymentSuccess);
router.get("/payment/failure", PaymentController.paymentFailure);
router.get("/payment/pending", PaymentController.paymentPending);

// Rotas de pagamento protegidas
router.post(
  "/payment/preference",
  authenticateToken,
  paymentRateLimit,
  logFinancialOperation("CREATE_PREFERENCE"),
  PaymentController.createPreference
);

router.post(
  "/payment/create",
  authenticateToken,
  paymentRateLimit,
  validatePaymentData,
  logFinancialOperation("CREATE_PAYMENT"),
  PaymentController.createPayment
);

// Criar token de cartão (para Checkout Transparente)
router.post(
  "/mercadopago/create-token",
  authenticateToken,
  paymentRateLimit,
  async (req: Request, res: Response) => {
    const { createCardToken } = await import(
      "./controller/mercadopagoController"
    );
    return createCardToken(req, res);
  }
);

// Buscar issuer do cartão (banco emissor)
router.post(
  "/mercadopago/get-issuers",
  authenticateToken,
  paymentRateLimit,
  async (req: Request, res: Response) => {
    const { getCardIssuers } = await import(
      "./controller/mercadopagoController"
    );
    return getCardIssuers(req, res);
  }
);

// Checkout Transparente (pagamento direto na aplicação)
router.post(
  "/payment/transparent-checkout",
  authenticateToken,
  paymentRateLimit,
  logFinancialOperation("TRANSPARENT_CHECKOUT"),
  PaymentController.processTransparentCheckout
);

router.get(
  "/payment/:paymentId/status",
  authenticateToken,
  logFinancialOperation("GET_PAYMENT_STATUS"),
  PaymentController.getPaymentStatus
);

router.post(
  "/payment/:paymentId/cancel",
  authenticateToken,
  logFinancialOperation("CANCEL_PAYMENT"),
  PaymentController.cancelPayment
);

router.get(
  "/payments/user",
  authenticateToken,
  logFinancialOperation("GET_USER_PAYMENTS"),
  PaymentController.getUserPayments
);

// Rotas administrativas
router.get(
  "/admin/financial-summary",
  authenticateToken,
  requireAdmin,
  logFinancialOperation("GET_FINANCIAL_SUMMARY"),
  PaymentController.getFinancialSummary
);

// ========== FEED ROUTES ==========

// Rota pública para obter feed (sem autenticação)
router.get("/feed", feedController.getPublicFeed);

// Utilitários públicos
router.get("/feed/section-types", feedController.getSectionTypes);

// ============== ROTAS ADMINISTRATIVAS DE FEED ==============

// Feed Configuration Routes (Admin only)
router.get(
  "/admin/feed/configurations",
  authenticateToken,
  requireAdmin,
  feedController.getAllConfigurations
);

router.get(
  "/admin/feed/configurations/:id",
  authenticateToken,
  requireAdmin,
  feedController.getConfiguration
);

router.post(
  "/admin/feed/configurations",
  authenticateToken,
  requireAdmin,
  feedController.createConfiguration
);

router.put(
  "/admin/feed/configurations/:id",
  authenticateToken,
  requireAdmin,
  feedController.updateConfiguration
);

router.delete(
  "/admin/feed/configurations/:id",
  authenticateToken,
  requireAdmin,
  feedController.deleteConfiguration
);

// Feed Banner Routes (Admin only)
router.post(
  "/admin/feed/banners",
  authenticateToken,
  requireAdmin,
  upload.single("image"),
  convertImagesToWebP,
  feedController.createBanner
);

router.put(
  "/admin/feed/banners/:id",
  authenticateToken,
  requireAdmin,
  upload.single("image"),
  convertImagesToWebP,
  feedController.updateBanner
);

router.delete(
  "/admin/feed/banners/:id",
  authenticateToken,
  requireAdmin,
  feedController.deleteBanner
);

// Feed Section Routes (Admin only)
router.post(
  "/admin/feed/sections",
  authenticateToken,
  requireAdmin,
  feedController.createSection
);

router.put(
  "/admin/feed/sections/:id",
  authenticateToken,
  requireAdmin,
  feedController.updateSection
);

router.delete(
  "/admin/feed/sections/:id",
  authenticateToken,
  requireAdmin,
  feedController.deleteSection
);

// Feed Section Item Routes (Admin only)
router.post(
  "/admin/feed/section-items",
  authenticateToken,
  requireAdmin,
  feedController.createSectionItem
);

router.put(
  "/admin/feed/section-items/:id",
  authenticateToken,
  requireAdmin,
  feedController.updateSectionItem
);

router.delete(
  "/admin/feed/section-items/:id",
  authenticateToken,
  requireAdmin,
  feedController.deleteSectionItem
);

// ========== CUSTOMIZATION ROUTES ==========

// Public customization routes (REFATORADO para usar Items)
router.get(
  "/items/:itemId/customizations",
  customizationController.getItemCustomizations
);

router.post(
  "/customizations/validate",
  customizationController.validateCustomizations
);

router.post("/customizations/preview", customizationController.buildPreview);

// Order customization routes
router.get(
  "/orders/:orderId/customizations",
  authenticateToken,
  orderCustomizationController.listOrderCustomizations
);

router.post(
  "/orders/:orderId/items/:itemId/customizations",
  authenticateToken,
  orderCustomizationController.saveOrderItemCustomization
);

// ========== ITEMS ROUTES ==========
router.get("/items", itemController.index);
router.get("/items/available", itemController.getAvailable);
router.get("/items/customizable", itemController.getWithCustomizations);
router.get("/items/:id", itemController.show);
router.post(
  "/items",
  authenticateToken,
  requireAdmin,
  upload.single("image"),
  convertImagesToWebP,
  itemController.create
);
router.put(
  "/items/:id",
  authenticateToken,
  requireAdmin,
  upload.single("image"),
  convertImagesToWebP,
  itemController.update
);
router.put(
  "/items/:id/stock",
  authenticateToken,
  requireAdmin,
  itemController.updateStock
);
router.delete(
  "/items/:id",
  authenticateToken,
  requireAdmin,
  itemController.delete
);

// ========== PRODUCT COMPONENTS ROUTES ==========
router.get(
  "/products/:productId/components",
  productComponentController.getProductComponents
);
router.post(
  "/products/:productId/components",
  authenticateToken,
  requireAdmin,
  productComponentController.addComponent
);
router.put(
  "/components/:componentId",
  authenticateToken,
  requireAdmin,
  productComponentController.updateComponent
);
router.delete(
  "/components/:componentId",
  authenticateToken,
  requireAdmin,
  productComponentController.removeComponent
);
router.get(
  "/products/:productId/stock/calculate",
  productComponentController.calculateProductStock
);
router.post(
  "/products/:productId/stock/validate",
  productComponentController.validateComponentsStock
);
router.get(
  "/items/:itemId/products",
  productComponentController.getProductsUsingItem
);

// ========== CUSTOMIZATION IMAGE UPLOAD ROUTES ==========

// Upload de imagem para preview de customização (Admin)
router.post(
  "/customization/upload-image",
  authenticateToken,
  requireAdmin,
  upload.single("image"),
  convertImagesToWebP,
  customizationUploadController.uploadImage
);

// Delete de imagem de customização (Admin)
router.delete(
  "/customization/image/:filename",
  authenticateToken,
  requireAdmin,
  customizationUploadController.deleteImage
);

// Admin routes for ProductRule management
router.get(
  "/admin/customization/rule/type/:productTypeId",
  authenticateToken,
  requireAdmin,
  productRuleController.getRulesByType
);

router.post(
  "/admin/customization/rule",
  authenticateToken,
  requireAdmin,
  upload.single("image"),
  convertImagesToWebP,
  productRuleController.createRule
);

router.put(
  "/admin/customization/rule/:ruleId",
  authenticateToken,
  requireAdmin,
  upload.single("image"),
  convertImagesToWebP,
  productRuleController.updateRule
);

router.delete(
  "/admin/customization/rule/:ruleId",
  authenticateToken,
  requireAdmin,
  productRuleController.deleteRule
);

// ========== ITEM CONSTRAINTS ROUTES ==========

// Listar todos os constraints
router.get(
  "/admin/constraints",
  authenticateToken,
  requireAdmin,
  itemConstraintController.listAll
);

// Buscar constraints de um item específico
router.get(
  "/admin/constraints/item/:itemType/:itemId",
  authenticateToken,
  requireAdmin,
  itemConstraintController.getByItem
);

// Buscar produtos/adicionais para autocomplete
router.get(
  "/admin/constraints/search",
  authenticateToken,
  requireAdmin,
  itemConstraintController.searchItems
);

// Criar constraint
router.post(
  "/admin/constraints",
  authenticateToken,
  requireAdmin,
  itemConstraintController.create
);

// Atualizar constraint
router.put(
  "/admin/constraints/:constraintId",
  authenticateToken,
  requireAdmin,
  itemConstraintController.update
);

// Deletar constraint
router.delete(
  "/admin/constraints/:constraintId",
  authenticateToken,
  requireAdmin,
  itemConstraintController.delete
);

// ========== CUSTOMIZATION ROUTES ==========

// Listar todas as customizações (com filtro opcional por item)
router.get(
  "/customizations",
  authenticateToken,
  requireAdmin,
  customizationController.index
);

// Buscar customização por ID
router.get(
  "/customizations/:id",
  authenticateToken,
  requireAdmin,
  customizationController.show
);

// Criar customização
router.post(
  "/customizations",
  authenticateToken,
  requireAdmin,
  customizationController.create
);

// Atualizar customização
router.put(
  "/customizations/:id",
  authenticateToken,
  requireAdmin,
  customizationController.update
);

// Deletar customização
router.delete(
  "/customizations/:id",
  authenticateToken,
  requireAdmin,
  customizationController.remove
);

// Buscar customizações de um item (público - para clientes)
router.get(
  "/items/:itemId/customizations",
  customizationController.getItemCustomizations
);

// Validar customizações (público - para clientes)
router.post(
  "/customizations/validate",
  customizationController.validateCustomizations
);

// Gerar preview de customizações (público - para clientes)
router.post("/customizations/preview", customizationController.buildPreview);

// ========== LAYOUT 3D ROUTES ==========

// Listar layouts (com filtro opcional por item)
router.get("/layouts", authenticateToken, requireAdmin, layoutController.index);

// Buscar layout por ID
router.get(
  "/layouts/:id",
  authenticateToken,
  requireAdmin,
  layoutController.show
);

// Criar layout 3D
router.post(
  "/layouts",
  authenticateToken,
  requireAdmin,
  layoutController.create
);

// Atualizar layout 3D
router.put(
  "/layouts/:id",
  authenticateToken,
  requireAdmin,
  layoutController.update
);

// Deletar layout 3D
router.delete(
  "/layouts/:id",
  authenticateToken,
  requireAdmin,
  layoutController.remove
);

// Upload de modelo 3D (.glb, .gltf)
router.post(
  "/layouts/upload-3d",
  authenticateToken,
  requireAdmin,
  upload3D.single("model"),
  layoutController.upload3DModel
);

// Servir modelos 3D
router.get("/3d-models/:filename", (req: Request, res: Response) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, "../public/3d-models", filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Arquivo não encontrado" });
  }

  res.sendFile(filePath);
});

// ========== LAYOUT BASE ROUTES (ADMIN) ==========

// Listar layouts base
router.get(
  "/admin/layouts",
  authenticateToken,
  requireAdmin,
  layoutBaseController.list
);

// Buscar layout base por ID
router.get(
  "/admin/layouts/:id",
  authenticateToken,
  requireAdmin,
  layoutBaseController.show
);

// Criar layout base (SEM conversão WebP - mantém formato original)
router.post(
  "/admin/layouts",
  authenticateToken,
  requireAdmin,
  upload.single("image"),
  layoutBaseController.create
);

// Atualizar layout base (SEM conversão WebP - mantém formato original)
router.put(
  "/admin/layouts/:id",
  authenticateToken,
  requireAdmin,
  upload.single("image"),
  layoutBaseController.update
);

// Deletar layout base
router.delete(
  "/admin/layouts/:id",
  authenticateToken,
  requireAdmin,
  layoutBaseController.delete
);

// ========== PERSONALIZATION ROUTES ==========

// Gerar preview da composição (público - para preview no cliente)
router.post("/preview/compose", personalizationController.preview);

// Commit de personalização (requer autenticação)
router.post(
  "/orders/:orderId/items/:itemId/personalize/commit",
  authenticateToken,
  personalizationController.commit
);

// Buscar personalização por ID
router.get(
  "/personalizations/:id",
  authenticateToken,
  personalizationController.show
);

// Listar personalizações de um pedido
router.get(
  "/orders/:orderId/personalizations",
  authenticateToken,
  personalizationController.listByOrder
);

export default router;
