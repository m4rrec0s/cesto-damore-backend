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
import reportController from "./controller/reportController";
import whatsappController from "./controller/whatsappController";
import customizationController from "./controller/customizationController";
import orderCustomizationController from "./controller/orderCustomizationController";
import itemConstraintController from "./controller/itemConstraintController";
import customizationUploadController from "./controller/customizationUploadController";
import oauthController from "./controller/oauthController";
import { PaymentService } from "./services/paymentService";
import logger from "./utils/logger";
import googleDriveService from "./services/googleDriveService";
import prisma from "./database/prisma";
import itemController from "./controller/itemController";
import productComponentController from "./controller/productComponentController";
import layoutBaseController from "./controller/layoutBaseController";
import customerManagementController from "./controller/customerManagementController";
import aiProductController from "./controller/aiProductController";
import webhookNotificationController from "./controller/webhookNotificationController";
import {
  upload,
  uploadAny,
  convertImagesToWebP,
  convertImagesToWebPLossless,
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

router.get("/preview", (req: Request, res: Response) => {
  try {
    const imgParam = req.query.img as string;

    if (!imgParam) {
      return res.status(400).json({
        error: "Parâmetro 'img' obrigatório",
        example: "/preview?img=produto.webp",
      });
    }

    // Validação simples: permitir apenas caracteres alfanuméricos, hífens e pontos
    if (!/^[a-zA-Z0-9._\-/]+$/.test(imgParam)) {
      return res.status(400).json({ error: "Nome de arquivo inválido" });
    }

    // Construir URL completa da imagem
    const baseUrl = process.env.BASE_URL || "https://api.cestodamore.com.br";
    const imageUrl = `${baseUrl}/images/${imgParam}`;

    // Metadata para a página
    const title = "Cesto d'Amore - Produto";
    const description =
      "Confira nosso produto especial disponível agora na Cesto d'Amore";

    // Dimensões recomendadas para OG:Image (mínimo 1200x627, ideal para WhatsApp)
    const imageWidth = 1200;
    const imageHeight = 627;

    // HTML com meta tags Open Graph otimizadas para WhatsApp
    const encodedImg = encodeURIComponent(imgParam);
    const previewUrl = `${baseUrl}/preview?img=${encodedImg}`;
    const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <meta name="description" content="${description}">
    
    <!-- Open Graph Meta Tags (para WhatsApp, Facebook, etc) -->
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${description}">
    <meta property="og:image" content="${imageUrl}">
    <meta property="og:image:width" content="${imageWidth}">
    <meta property="og:image:height" content="${imageHeight}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${previewUrl}">
    
    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${title}">
    <meta name="twitter:description" content="${description}">
    <meta name="twitter:image" content="${imageUrl}">
</head>
<body>
    <img src="${imageUrl}" alt="${title}" loading="eager" style="width:80%;height:auto;">
</body>
</html>
    `.trim();

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600"); // Cache por 1 hora
    res.send(html);
  } catch (error: any) {
    logger.error("❌ [PREVIEW] Erro ao renderizar preview:", error);
    res.status(500).json({
      error: "Erro ao renderizar preview",
      message: error.message,
    });
  }
});

// ============================================
// DEBUG ENDPOINT - Upload de teste
// ============================================
router.post(
  "/debug/test-upload",
  upload.single("image"),
  async (req: Request, res: Response) => {
    try {
      logger.info("🧪 [TEST-UPLOAD] Endpoint de teste acionado");

      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: "Nenhuma imagem enviada" });
      }

      logger.info("🧪 [TEST-UPLOAD] Arquivo recebido:", {
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        bufferSize: file.buffer?.length,
      });

      // Teste 1: Salvar sem processar
      const path = await import("path");
      const fs = await import("fs");
      const testPath = path.join(
        process.cwd(),
        "images",
        `TEST-${Date.now()}-${file.originalname}`
      );

      logger.info("🧪 [TEST-UPLOAD] Salvando em:", testPath);
      fs.writeFileSync(testPath, file.buffer);
      logger.info("🧪 [TEST-UPLOAD] Arquivo salvo! Verificando...");

      if (fs.existsSync(testPath)) {
        const stats = fs.statSync(testPath);
        logger.info(
          "✅ [TEST-UPLOAD] Arquivo confirmado:",
          stats.size,
          "bytes"
        );

        return res.status(200).json({
          success: true,
          message: "Teste de escrita funcionou!",
          filePath: testPath,
          fileSize: stats.size,
        });
      } else {
        logger.error("❌ [TEST-UPLOAD] Arquivo NÃO foi criado!");
        return res.status(500).json({
          success: false,
          message: "Arquivo não foi criado após writeFileSync",
        });
      }
    } catch (error: any) {
      logger.error("❌ [TEST-UPLOAD] Erro:", error);
      return res.status(500).json({
        success: false,
        error: error.message,
        stack: error.stack,
      });
    }
  }
);

// ============================================
// WEBHOOK DEBUG ENDPOINT (temporário)
// ============================================
router.post("/webhook/mercadopago/debug", (req: Request, res: Response) => {
  logger.info("🔍 DEBUG WEBHOOK - Headers:", {
    "x-signature": req.headers["x-signature"],
    "x-request-id": req.headers["x-request-id"],
    "content-type": req.headers["content-type"],
    "user-agent": req.headers["user-agent"],
  });

  // Log only a small preview of the body to avoid leaking base64/large blobs
  const body = req.body || {};
  const bodyPreview = {
    type: body.type || body.action || body.topic || null,
    action: body.action || null,
    paymentId: body?.data?.id || body.resource || null,
    keys: Object.keys(body),
  };
  logger.info("🔍 DEBUG WEBHOOK - Body preview:", bodyPreview);

  res.status(200).json({
    received: true,
    message: "Debug webhook OK",
    timestamp: new Date().toISOString(),
  });
});

// ============================================
// WEBHOOK NOTIFICATIONS (SSE - Server-Sent Events)
// ============================================

// Conectar ao stream de notificações de um pedido específico
// GET /webhooks/notifications/:orderId
router.get(
  "/webhooks/notifications/:orderId",
  webhookNotificationController.streamNotifications
);

// Obter estatísticas de conexões SSE ativas
// GET /webhooks/notifications-stats
router.get(
  "/webhooks/notifications-stats",
  authenticateToken,
  requireAdmin,
  webhookNotificationController.getStats
);

// ============================================
// AI PRODUCT ROUTES (Consultas otimizadas para IA)
// ============================================

router.get("/ai/products/light", aiProductController.getLightweightProducts);
router.get("/ai/products/detail/:id", aiProductController.getProductDetail);
router.get("/ai/products/info", aiProductController.getEndpointInfo);

// ============================================
// GOOGLE DRIVE OAUTH2
// ============================================

router.get("/oauth/authorize", oauthController.authorize);

router.get("/oauth/callback", oauthController.callback);

router.get("/oauth/status", oauthController.status);

router.get("/oauth/debug", oauthController.debug);

router.post(
  "/oauth/clear",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => oauthController.clear(req, res)
);

// Admin test for Google Drive (checks create/delete permissions)
router.post(
  "/admin/google-drive/test",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const folderName = `test-drive-${Date.now()}`;
      const folderId = await googleDriveService.createFolder(folderName);
      // Clean up
      await googleDriveService.deleteFolder(folderId);
      res.json({ success: true, message: "Drive upload OK" });
    } catch (err: any) {
      logger.error("Admin Google Drive test failed:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

// Admin: Reprocess finalization for a specific order or payment
router.post(
  "/admin/reprocess-finalization",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { orderId, paymentId } = req.body;
      if (!orderId && !paymentId) {
        return res
          .status(400)
          .json({ success: false, error: "orderId or paymentId required" });
      }

      let targetOrderId = orderId;
      if (!targetOrderId && paymentId) {
        const payment = await prisma.payment.findFirst({
          where: { mercado_pago_id: paymentId },
        });
        if (!payment) {
          return res
            .status(404)
            .json({ success: false, error: "Payment not found" });
        }
        targetOrderId = payment.order_id;
      }

      const result = await PaymentService.reprocessFinalizationForOrder(
        targetOrderId!
      );
      return res.json({ success: true, result });
    } catch (err: any) {
      logger.error("Erro ao reprocessar finalização manualmente:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }
);

// Admin: Reprocess all missing finalizations
router.post(
  "/admin/reprocess-missing",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { maxAttempts } = req.body || {};
      await PaymentService.reprocessFailedFinalizations(maxAttempts || 5);
      return res.json({ success: true, message: "Reprocess started" });
    } catch (err: any) {
      logger.error("Erro ao reprocessar finalizar pendentes:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }
);

// Servir imagens de produtos/adicionais
router.get("/images/:filename", (req: Request, res: Response) => {
  try {
    const filename = req.params.filename;
    // Pasta de imagens FORA do diretório do código em produção
    const imagesPath =
      process.env.NODE_ENV === "production"
        ? "/app/images"
        : path.join(process.cwd(), "images");
    const filePath = path.join(imagesPath, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        error: "Imagem não encontrada",
        filename: filename,
      });
    }

    res.sendFile(filePath);
  } catch (error: any) {
    logger.error("Erro ao servir imagem:", error.message);
    res.status(500).json({
      error: "Erro interno do servidor",
      message: error.message,
    });
  }
});

// Servir arquivos de customizações (diretamente da pasta customizations)
router.get(
  "/images/customizations/:filename",
  (req: Request, res: Response) => {
    try {
      const { filename } = req.params;
      const imagesPath =
        process.env.NODE_ENV === "production"
          ? "/app/images"
          : path.join(process.cwd(), "images");
      const customizationsPath = path.join(imagesPath, "customizations");
      const filePath = path.join(customizationsPath, filename);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({
          error: "Arquivo de customização não encontrado",
          filename,
        });
      }

      res.sendFile(filePath);
    } catch (error: any) {
      logger.error("Erro ao servir arquivo de customização:", error.message);
      res.status(500).json({
        error: "Erro interno do servidor",
        message: error.message,
      });
    }
  }
);

// Servir arquivos de customizações (subpastas - mantido para compatibilidade)
router.get(
  "/images/customizations/:folderId/:filename",
  (req: Request, res: Response) => {
    try {
      const { folderId, filename } = req.params;
      const imagesPath =
        process.env.NODE_ENV === "production"
          ? "/app/images"
          : path.join(process.cwd(), "images");
      const customizationsPath = path.join(
        imagesPath,
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
      logger.error("Erro ao servir arquivo de customização:", error.message);
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
router.get("/users/:userId/orders", orderController.getByUserId);
router.get("/users/:id", userController.show);
router.post("/users", upload.single("image"), userController.create);
router.put("/users/:id", upload.single("image"), userController.update);
router.delete("/users/:id", userController.remove);

// order routes
router.get("/orders", orderController.index);

router.get(
  "/users/:id/orders/pending",
  authenticateToken,
  orderController.getPendingOrder
);

// Rota para cancelar pedido (autenticado)
router.post(
  "/orders/:id/cancel",
  authenticateToken,
  orderController.cancelOrder
);

router.put("/orders/:id/items", authenticateToken, orderController.updateItems);

router.put(
  "/orders/:id/metadata",
  authenticateToken,
  orderController.updateMetadata
);

router.patch(
  "/orders/:id/status",
  authenticateToken,
  requireAdmin,
  orderController.updateStatus
);

router.get("/orders/:id", orderController.show);
router.post("/orders", orderController.create);
router.delete("/orders/:id", authenticateToken, orderController.remove);
router.delete("/orders/canceled", orderController.removeAllCanceledOrders);

// ========== PAYMENT ROUTES ==========

router.get("/payment/health", PaymentController.healthCheck);

router.post(
  "/webhook/mercadopago",
  validateMercadoPagoWebhook,
  PaymentController.handleWebhook
);

router.post(
  "/api/webhook/mercadopago",
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

// Buscar parcelas
router.post(
  "/mercadopago/get-installments",
  authenticateToken,
  paymentRateLimit,
  async (req: Request, res: Response) => {
    const { getInstallments } = await import(
      "./controller/mercadopagoController"
    );
    return getInstallments(req, res);
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
  uploadAny.single("image"),
  convertImagesToWebPLossless,
  feedController.createBanner
);

router.put(
  "/admin/feed/banners/:id",
  authenticateToken,
  requireAdmin,
  uploadAny.single("image"),
  convertImagesToWebPLossless,
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
// ✅ NÃO converter para WebP - manter formato original
router.post(
  "/customization/upload-image",
  authenticateToken,
  requireAdmin,
  upload.single("image"),
  customizationUploadController.uploadImage
);

// Delete de imagem de customização (Admin)
router.delete(
  "/customization/image/:filename",
  authenticateToken,
  requireAdmin,
  customizationUploadController.deleteImage
);

// ========== ITEM CONSTRAINTS ROUTES ==========

// Rota pública para buscar constraints de um item (usada no frontend do cliente)
router.get(
  "/constraints/item/:itemType/:itemId",
  itemConstraintController.getByItem
);

// Listar todos os constraints (Admin)
router.get(
  "/admin/constraints",
  authenticateToken,
  requireAdmin,
  itemConstraintController.listAll
);

// Buscar constraints de um item específico (Admin - duplicado para manter compatibilidade)
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
  uploadAny.any(),
  convertImagesToWebP,
  customizationController.create
);

// Atualizar customização
router.put(
  "/customizations/:id",
  authenticateToken,
  requireAdmin,
  uploadAny.any(),
  convertImagesToWebP,
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

// Listar layouts base
router.get("/layouts", layoutBaseController.list);

// Buscar layout base por ID
router.get("/layouts/:id", layoutBaseController.show);

// ===== ADMIN LAYOUTS ROUTES (protegidas) =====
router.get(
  "/admin/layouts",
  authenticateToken,
  requireAdmin,
  layoutBaseController.list
);

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

// ========== CUSTOMER MANAGEMENT ROUTES (N8N INTEGRATION) ==========

// Listar clientes para follow-up (deve vir antes de /:phone)
router.get(
  "/customers/follow-up",
  authenticateToken,
  requireAdmin,
  customerManagementController.getFollowUpCustomers
);

// Listar todos os clientes
router.get(
  "/customers",
  // authenticateToken,
  // requireAdmin,
  customerManagementController.listCustomers
);

// Criar ou atualizar cliente
router.post(
  "/customers",
  authenticateToken,
  requireAdmin,
  customerManagementController.upsertCustomer
);

// Sincronizar usuário do app para n8n
router.post(
  "/customers/sync/:userId",
  authenticateToken,
  requireAdmin,
  customerManagementController.syncAppUser
);

// Buscar informações completas do cliente
router.get(
  "/customers/:phone",
  authenticateToken,
  requireAdmin,
  customerManagementController.getCustomerInfo
);

// Atualizar follow-up
router.patch(
  "/customers/:phone/follow-up",
  authenticateToken,
  requireAdmin,
  customerManagementController.updateFollowUp
);

// Enviar mensagem ao cliente
router.post(
  "/customers/:phone/send-message",
  authenticateToken,
  requireAdmin,
  customerManagementController.sendMessage
);

// Atualizar status de serviço
router.patch(
  "/customers/:phone/service-status",
  authenticateToken,
  requireAdmin,
  customerManagementController.updateServiceStatus
);

// Atualizar status de cliente (already_a_customer)
router.patch(
  "/customers/:phone/customer-status",
  authenticateToken,
  requireAdmin,
  customerManagementController.updateCustomerStatus
);

// Atualizar nome do cliente
router.patch(
  "/customers/:phone/name",
  authenticateToken,
  requireAdmin,
  customerManagementController.updateName
);

// ============================================
// TEMPORARY FILES MANAGEMENT
// ============================================

import tempFileController from "./controller/tempFileController";

// Upload de arquivo temporário (durante customização)
// POST /api/temp/upload
router.post(
  "/temp/upload",
  upload.single("image"),
  convertImagesToWebP,
  tempFileController.upload
);

// Lista arquivos temporários (admin only)
// GET /api/temp/files
router.get(
  "/temp/files",
  authenticateToken,
  requireAdmin,
  tempFileController.listFiles
);

// Deleta um arquivo temporário específico
// DELETE /api/temp/files/:filename
router.delete(
  "/temp/files/:filename",
  authenticateToken,
  requireAdmin,
  tempFileController.deleteFile
);

// Limpeza automática de arquivos antigos (admin only)
// DELETE /api/temp/cleanup?hours=48
router.delete(
  "/temp/cleanup",
  authenticateToken,
  requireAdmin,
  tempFileController.cleanup
);

// Deleta arquivos temporários associados a um pedido
// POST /api/temp/cleanup-by-order
router.post(
  "/temp/cleanup-by-order",
  authenticateToken,
  requireAdmin,
  tempFileController.cleanupByOrder
);

export default router;
