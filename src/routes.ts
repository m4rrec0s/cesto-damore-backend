import { Router } from "express";
import { Request, Response } from "express";
import path from "path";
import fs from "fs";

// Controllers
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
import customizationReviewController from "./controller/customizationReviewController";
import tempUploadController from "./controller/tempUploadController";
import oauthController from "./controller/oauthController";
import statusController from "./controller/statusController";
import aiSummaryService from "./services/aiSummaryService";
import { PaymentService } from "./services/paymentService";
import logger from "./utils/logger";
import googleDriveService from "./services/googleDriveService";
import prisma from "./database/prisma";
import itemController from "./controller/itemController";
import productComponentController from "./controller/productComponentController";
import layoutBaseController from "./controller/layoutBaseController";
import dynamicLayoutController from "./controller/dynamicLayoutController";
import elementBankController from "./controller/elementBankController";
import customerManagementController from "./controller/customerManagementController";
import aiProductController from "./controller/aiProductController";
import aiAgentController from "./controller/aiAgentController";
import holidayController from "./controller/holidayController";
import followUpController from "./controller/followUpController";
import webhookNotificationController from "./controller/webhookNotificationController";
import tempFileController from "./controller/tempFileController";

// Config & Middleware
import {
  upload,
  uploadAny,
  convertImagesToWebPLossy,
  convertImagesToWebPLossless,
} from "./config/multer";

import {
  authenticateToken,
  optionalAuthenticateToken,
  requireAdmin,
  validateMercadoPagoWebhook,
  paymentRateLimit,
  validatePaymentData,
  logFinancialOperation,
  validateAIAgentKey,
  authRateLimit,
  apiRateLimit,
} from "./middleware/security";

const router = Router();

// ✅ SEGURANÇA: Aplicar limite de requisições apenas nas rotas de API
// Isso evita que o limite bloqueie o carregamento de imagens estáticas
router.use(apiRateLimit);

// ==========================================
// 1. UTIL & DEBUG ROUTES
// ==========================================

router.post(
  "/debug/test-upload",
  authenticateToken,
  requireAdmin,
  upload.single("image"),
  async (req: Request, res: Response) => {
    try {
      logger.info("🧪 [TEST-UPLOAD] Endpoint de teste acionado");
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: "Nenhuma imagem enviada" });
      }
      const testPath = path.join(
        process.cwd(),
        "images",
        `TEST-${Date.now()}-${file.originalname}`,
      );
      fs.writeFileSync(testPath, file.buffer);
      if (fs.existsSync(testPath)) {
        const stats = fs.statSync(testPath);
        return res.status(200).json({
          success: true,
          message: "Teste de escrita funcionou!",
          filePath: testPath,
          fileSize: stats.size,
        });
      } else {
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
      });
    }
  },
);

router.get("/preview", (req: Request, res: Response) => {
  try {
    const imgParam = req.query.img as string;
    if (!imgParam) {
      return res.status(400).json({
        error: "Parâmetro 'img' obrigatório",
        example: "/preview?img=produto.webp",
      });
    }
    const baseUrl = process.env.BASE_URL || "https://api.cestodamore.com.br";
    const imageUrl = `${baseUrl}/images/${imgParam}`;
    const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cesto d'Amore - Preview</title>
    <meta property="og:image" content="${imageUrl}">
    <style>
      body { margin: 0; background-color: #f9f9f9; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
      img { width: 100%; max-width: 500px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
    </style>
</head>
<body>
    <img src="${imageUrl}" loading="eager">
</body>
</html>
    `.trim();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 2. STATIC FILE SERVING
// ==========================================

const getImagesPath = () =>
  process.env.UPLOAD_DIR
    ? path.resolve(process.env.UPLOAD_DIR)
    : path.join(process.cwd(), "images");

router.get("/images/:filename", (req: Request, res: Response) => {
  const filename = req.params.filename;
  // Bloquear tentativas de path traversal
  if (
    filename.includes("..") ||
    filename.includes("/") ||
    filename.includes("\\")
  ) {
    return res.status(400).json({ error: "Nome de arquivo inválido" });
  }
  const filePath = path.join(getImagesPath(), filename);
  if (fs.existsSync(filePath)) return res.sendFile(filePath);
  res.status(404).json({ error: "Imagem não encontrada" });
});

router.get(
  "/images/customizations/:filename",
  (req: Request, res: Response) => {
    const filename = req.params.filename;
    if (
      filename.includes("..") ||
      filename.includes("/") ||
      filename.includes("\\")
    ) {
      return res.status(400).json({ error: "Nome de arquivo inválido" });
    }
    const filePath = path.join(getImagesPath(), "customizations", filename);
    if (fs.existsSync(filePath)) return res.sendFile(filePath);
    res.status(404).json({ error: "Arquivo de customização não encontrado" });
  },
);

router.get(
  "/images/customizations/:folderId/:filename",
  (req: Request, res: Response) => {
    const { folderId, filename } = req.params;
    if (
      filename.includes("..") ||
      filename.includes("/") ||
      filename.includes("\\") ||
      folderId.includes("..") ||
      folderId.includes("/") ||
      folderId.includes("\\")
    ) {
      return res.status(400).json({ error: "Formato inválido" });
    }
    const filePath = path.join(
      getImagesPath(),
      "customizations",
      folderId,
      filename,
    );
    if (fs.existsSync(filePath)) return res.sendFile(filePath);
    res.status(404).json({ error: "Arquivo de customização não encontrado" });
  },
);

// Servir arquivos temporários (uploads)
const getTempUploadsPath = () =>
  process.env.TEMP_UPLOADS_DIR
    ? path.resolve(process.env.TEMP_UPLOADS_DIR)
    : path.join(process.cwd(), "storage", "temp");

router.get("/uploads/temp/:filename", (req: Request, res: Response) => {
  const filename = req.params.filename;
  // Bloquear tentativas de path traversal
  if (
    filename.includes("..") ||
    filename.includes("/") ||
    filename.includes("\\")
  ) {
    return res.status(400).json({ error: "Nome de arquivo inválido" });
  }
  const filePath = path.join(getTempUploadsPath(), filename);
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }
  res.status(404).json({ error: "Arquivo temporário não encontrado" });
});

// ==========================================
// 3. AUTH & USER ROUTES
// ==========================================

router.post("/auth/google", authRateLimit, authController.google);
router.post("/auth/login", authRateLimit, authController.login);
router.post("/auth/verify-2fa", authRateLimit, authController.verify2fa);
router.post(
  "/auth/register",
  authRateLimit,
  upload.single("image"),
  authController.register,
);
router.post("/auth/refresh", authenticateToken, authController.refreshToken);

router.get("/users/me", authenticateToken, userController.me);
router.get("/users/cep/:zipCode", userController.getAddressByZipCode);
router.get("/users", authenticateToken, requireAdmin, userController.index);
router.get(
  "/users/:userId/orders",
  authenticateToken,
  orderController.getByUserId,
);
router.get(
  "/users/:userId/orders/pending",
  authenticateToken,
  orderController.getPendingOrderByUserId,
);
router.get("/users/:id", authenticateToken, userController.show);
router.post(
  "/users",
  authenticateToken,
  requireAdmin,
  upload.single("image"),
  userController.create,
);
router.put(
  "/users/:id",
  authenticateToken,
  upload.single("image"),
  userController.update,
);
router.delete(
  "/users/:id",
  authenticateToken,
  requireAdmin,
  userController.remove,
);

// ==========================================
// 4. PRODUCT & CATALOG ROUTES
// ==========================================

router.get("/products", productController.index);
router.get("/products/:id", productController.show);
router.post(
  "/products",
  authenticateToken,
  requireAdmin,
  upload.single("image"),
  convertImagesToWebPLossless,
  productController.create,
);
router.put(
  "/products/:id",
  authenticateToken,
  requireAdmin,
  upload.single("image"),
  convertImagesToWebPLossless,
  productController.update,
);
router.delete(
  "/products/:id",
  authenticateToken,
  requireAdmin,
  productController.remove,
);
router.post(
  "/products/:id/link",
  authenticateToken,
  requireAdmin,
  productController.link,
);
router.post(
  "/products/:id/unlink",
  authenticateToken,
  requireAdmin,
  productController.unlink,
);

router.get("/items", itemController.index);
router.get("/items/available", itemController.getAvailable);
router.get("/items/customizable", itemController.getWithCustomizations);
router.get("/items/:id", itemController.show);
router.post(
  "/items",
  authenticateToken,
  requireAdmin,
  upload.single("image"),
  convertImagesToWebPLossless,
  itemController.create,
);
router.put(
  "/items/:id",
  authenticateToken,
  requireAdmin,
  upload.single("image"),
  convertImagesToWebPLossless,
  itemController.update,
);
router.put(
  "/items/:id/stock",
  authenticateToken,
  requireAdmin,
  itemController.updateStock,
);
router.delete(
  "/items/:id",
  authenticateToken,
  requireAdmin,
  itemController.delete,
);

router.get("/categories", categoryController.index);
router.get("/categories/:id", categoryController.show);
router.post(
  "/categories",
  authenticateToken,
  requireAdmin,
  categoryController.create,
);
router.put(
  "/categories/:id",
  authenticateToken,
  requireAdmin,
  categoryController.update,
);
router.delete(
  "/categories/:id",
  authenticateToken,
  requireAdmin,
  categoryController.remove,
);

router.get("/types", typeController.index);
router.get("/types/:id", typeController.show);
router.post("/types", authenticateToken, requireAdmin, typeController.create);
router.put(
  "/types/:id",
  authenticateToken,
  requireAdmin,
  typeController.update,
);
router.delete(
  "/types/:id",
  authenticateToken,
  requireAdmin,
  typeController.remove,
);

// Product Components
router.get(
  "/products/:productId/components",
  productComponentController.getProductComponents,
);
router.post(
  "/products/:productId/components",
  authenticateToken,
  requireAdmin,
  productComponentController.addComponent,
);
router.put(
  "/components/:componentId",
  authenticateToken,
  requireAdmin,
  productComponentController.updateComponent,
);
router.delete(
  "/components/:componentId",
  authenticateToken,
  requireAdmin,
  productComponentController.removeComponent,
);
router.get(
  "/products/:productId/stock/calculate",
  productComponentController.calculateProductStock,
);
router.post(
  "/products/:productId/stock/validate",
  productComponentController.validateComponentsStock,
);
router.get(
  "/items/:itemId/products",
  productComponentController.getProductsUsingItem,
);

// Additionals
router.get("/additional", additionalController.index);
router.get("/additional/:id", additionalController.show);
router.post(
  "/additional",
  authenticateToken,
  requireAdmin,
  upload.single("image"),
  convertImagesToWebPLossless,
  additionalController.create,
);
router.put(
  "/additional/:id",
  authenticateToken,
  requireAdmin,
  upload.single("image"),
  convertImagesToWebPLossless,
  additionalController.update,
);
router.delete(
  "/additional/:id",
  authenticateToken,
  requireAdmin,
  additionalController.remove,
);
router.post(
  "/additional/:id/link",
  authenticateToken,
  requireAdmin,
  additionalController.link,
);
router.put(
  "/additional/:id/link",
  authenticateToken,
  requireAdmin,
  additionalController.updateLink,
);
router.post(
  "/additional/:id/unlink",
  authenticateToken,
  requireAdmin,
  additionalController.unlink,
);
router.get("/additional/:id/price", additionalController.getPrice);
router.get(
  "/products/:productId/additionals",
  additionalController.getByProduct,
);

// Constraints
router.get(
  "/constraints/item/:itemType/:itemId",
  itemConstraintController.getByItem,
);
router.get(
  "/admin/constraints",
  authenticateToken,
  requireAdmin,
  itemConstraintController.listAll,
);
router.post(
  "/admin/constraints",
  authenticateToken,
  requireAdmin,
  itemConstraintController.create,
);
router.put(
  "/admin/constraints/:constraintId",
  authenticateToken,
  requireAdmin,
  itemConstraintController.update,
);
router.delete(
  "/admin/constraints/:constraintId",
  authenticateToken,
  requireAdmin,
  itemConstraintController.delete,
);

// ==========================================
// 5. DYNAMIC LAYOUTS & DESIGN BANK
// ==========================================

router.get(
  "/layouts/dynamic",
  optionalAuthenticateToken,
  dynamicLayoutController.list,
);
router.get(
  "/layouts/dynamic/:id",
  optionalAuthenticateToken,
  dynamicLayoutController.show,
);
router.post(
  "/layouts/dynamic",
  authenticateToken,
  dynamicLayoutController.create,
);
router.put(
  "/layouts/dynamic/:id",
  authenticateToken,
  dynamicLayoutController.update,
);
router.delete(
  "/layouts/dynamic/:id",
  authenticateToken,
  dynamicLayoutController.delete,
);
router.post(
  "/layouts/dynamic/:id/versions",
  authenticateToken,
  dynamicLayoutController.saveVersion,
);
router.get(
  "/layouts/dynamic/:id/versions",
  authenticateToken,
  dynamicLayoutController.listVersions,
);
router.post(
  "/layouts/dynamic/:id/versions/:versionNumber/restore",
  authenticateToken,
  dynamicLayoutController.restoreVersion,
);
router.post(
  "/layouts/dynamic/:id/elements",
  authenticateToken,
  dynamicLayoutController.addElement,
);
router.put(
  "/layouts/dynamic/:layoutId/elements/:elementId",
  authenticateToken,
  dynamicLayoutController.updateElement,
);
router.delete(
  "/layouts/dynamic/:layoutId/elements/:elementId",
  authenticateToken,
  dynamicLayoutController.deleteElement,
);

// Elements Bank
router.get(
  "/elements/bank",
  optionalAuthenticateToken,
  elementBankController.list,
);
router.get("/elements/bank/categories", elementBankController.listCategories);
router.get(
  "/elements/bank/:id",
  optionalAuthenticateToken,
  elementBankController.show,
);
router.post(
  "/elements/bank",
  authenticateToken,
  requireAdmin,
  upload.single("image"),
  elementBankController.create,
);
router.put(
  "/elements/bank/:id",
  authenticateToken,
  requireAdmin,
  elementBankController.update,
);
router.delete(
  "/elements/bank/:id",
  authenticateToken,
  requireAdmin,
  elementBankController.delete,
);
router.post(
  "/elements/bank/bulk",
  authenticateToken,
  requireAdmin,
  elementBankController.bulkCreate,
);

// Legacy Layouts (Commented out)
// router.get("/layouts", layoutBaseController.list);
// router.get("/layouts/:id", layoutBaseController.show);
// router.post("/admin/layouts", authenticateToken, requireAdmin, upload.single("image"), layoutBaseController.create);
// router.put("/admin/layouts/:id", authenticateToken, requireAdmin, upload.single("image"), layoutBaseController.update);
// router.delete("/admin/layouts/:id", authenticateToken, requireAdmin, layoutBaseController.delete);

// ==========================================
// 6. CUSTOMIZATIONS & ORDERS
// ==========================================

router.get(
  "/customizations",
  authenticateToken,
  requireAdmin,
  customizationController.index,
);
router.get(
  "/customizations/:id",
  authenticateToken,
  requireAdmin,
  customizationController.show,
);
router.post(
  "/customizations",
  authenticateToken,
  requireAdmin,
  uploadAny.any(),
  customizationController.create,
);
router.put(
  "/customizations/:id",
  authenticateToken,
  requireAdmin,
  uploadAny.any(),
  customizationController.update,
);
router.delete(
  "/customizations/:id",
  authenticateToken,
  requireAdmin,
  customizationController.remove,
);

router.get(
  "/items/:itemId/customizations",
  customizationController.getItemCustomizations,
);
router.post(
  "/customizations/validate",
  customizationController.validateCustomizations,
);
router.post("/customizations/preview", customizationController.buildPreview);
router.get(
  "/customization/review/:orderId",
  customizationReviewController.getReviewData,
);

router.get("/orders", authenticateToken, orderController.index);
router.get("/orders/:id", authenticateToken, orderController.show);
router.post("/orders", orderController.create);
router.put("/orders/:id/items", authenticateToken, orderController.updateItems);
router.put(
  "/orders/:id/metadata",
  authenticateToken,
  orderController.updateMetadata,
);
router.patch(
  "/orders/:id/status",
  authenticateToken,
  requireAdmin,
  orderController.updateStatus,
);
router.delete("/orders/:id", authenticateToken, orderController.remove);
router.delete(
  "/orders/canceled",
  authenticateToken,
  requireAdmin,
  orderController.removeAllCanceledOrders,
);

router.get(
  "/orders/:orderId/customizations",
  authenticateToken,
  orderCustomizationController.listOrderCustomizations,
);
router.post(
  "/orders/:orderId/items/:itemId/customizations",
  authenticateToken,
  orderCustomizationController.saveOrderItemCustomization,
);

// ==========================================
// 7. PAYMENT & WEBHOOKS
// ==========================================

router.get("/payment/health", PaymentController.healthCheck);
router.post(
  "/payment/preference",
  authenticateToken,
  paymentRateLimit,
  logFinancialOperation("CREATE_PREFERENCE"),
  PaymentController.createPreference,
);
router.post(
  "/payment/create",
  authenticateToken,
  paymentRateLimit,
  validatePaymentData,
  logFinancialOperation("CREATE_PAYMENT"),
  PaymentController.createPayment,
);
router.post(
  "/payment/transparent-checkout",
  authenticateToken,
  paymentRateLimit,
  logFinancialOperation("TRANSPARENT_CHECKOUT"),
  PaymentController.processTransparentCheckout,
);
router.get(
  "/payment/:paymentId/status",
  authenticateToken,
  logFinancialOperation("GET_PAYMENT_STATUS"),
  PaymentController.getPaymentStatus,
);
router.post(
  "/payment/:paymentId/cancel",
  authenticateToken,
  logFinancialOperation("CANCEL_PAYMENT"),
  PaymentController.cancelPayment,
);
router.get(
  "/payments/user",
  authenticateToken,
  PaymentController.getUserPayments,
);

router.post(
  "/webhook/mercadopago",
  validateMercadoPagoWebhook,
  PaymentController.handleWebhook,
);
router.post(
  "/webhook/mercadopago",
  validateMercadoPagoWebhook,
  PaymentController.handleWebhook,
);
router.get(
  "/webhooks/notifications/:orderId",
  webhookNotificationController.streamNotifications,
);
router.get(
  "/webhooks/notifications-stats",
  authenticateToken,
  requireAdmin,
  webhookNotificationController.getStats,
);

// Mercado Pago Proxy/Helpers
router.post(
  "/mercadopago/create-token",
  authenticateToken,
  paymentRateLimit,
  async (req, res) => {
    const { createCardToken } =
      await import("./controller/mercadopagoController");
    return createCardToken(req, res);
  },
);
router.post(
  "/mercadopago/get-issuers",
  authenticateToken,
  paymentRateLimit,
  async (req, res) => {
    const { getCardIssuers } =
      await import("./controller/mercadopagoController");
    return getCardIssuers(req, res);
  },
);
router.post(
  "/mercadopago/get-installments",
  authenticateToken,
  paymentRateLimit,
  async (req, res) => {
    const { getInstallments } =
      await import("./controller/mercadopagoController");
    return getInstallments(req, res);
  },
);

// ==========================================
// 8. UPLOADS & TEMP FILES
// ==========================================

router.post(
  "/upload/image",
  upload.single("image"),
  uploadController.uploadImage,
);
router.post(
  "/customization/upload-image",
  upload.single("image"),
  customizationUploadController.uploadImage,
);
router.delete(
  "/customization/image/:filename",
  authenticateToken,
  requireAdmin,
  customizationUploadController.deleteImage,
);

router.post("/temp/upload", upload.single("image"), tempFileController.upload);
router.get(
  "/temp/files",
  authenticateToken,
  requireAdmin,
  tempFileController.listFiles,
);
router.delete(
  "/temp/files/:filename",
  authenticateToken,
  requireAdmin,
  tempFileController.deleteFile,
);
router.delete(
  "/temp/cleanup",
  authenticateToken,
  requireAdmin,
  tempFileController.cleanup,
);
router.post(
  "/temp/cleanup-by-order",
  authenticateToken,
  requireAdmin,
  tempFileController.cleanupByOrder,
);

router.post(
  "/uploads/temp",
  optionalAuthenticateToken,
  upload.single("file"),
  tempUploadController.uploadTemp,
);
router.post(
  "/uploads/temp/:uploadId/make-permanent",
  authenticateToken,
  tempUploadController.makePermanent,
);
router.delete(
  "/uploads/temp/:uploadId",
  authenticateToken,
  tempUploadController.deleteTemp,
);
router.get(
  "/uploads/stats",
  authenticateToken,
  requireAdmin,
  tempUploadController.getStats,
);
router.post(
  "/uploads/cleanup",
  authenticateToken,
  requireAdmin,
  tempUploadController.cleanup,
);

// ==========================================
// 9. CUSTOMER MANAGEMENT
// ==========================================

router.get(
  "/customers",
  authenticateToken,
  requireAdmin,
  customerManagementController.listCustomers,
);
router.get(
  "/customers/follow-up",
  authenticateToken,
  requireAdmin,
  customerManagementController.getFollowUpCustomers,
);
router.get(
  "/customers/:phone",
  authenticateToken,
  requireAdmin,
  customerManagementController.getCustomerInfo,
);
router.post(
  "/customers",
  authenticateToken,
  requireAdmin,
  customerManagementController.upsertCustomer,
);
router.patch(
  "/customers/:phone/follow-up",
  authenticateToken,
  requireAdmin,
  customerManagementController.updateFollowUp,
);
router.patch(
  "/customers/:phone/service-status",
  authenticateToken,
  requireAdmin,
  customerManagementController.updateServiceStatus,
);
router.patch(
  "/customers/:phone/customer-status",
  authenticateToken,
  requireAdmin,
  customerManagementController.updateCustomerStatus,
);
router.patch(
  "/customers/:phone/name",
  authenticateToken,
  requireAdmin,
  customerManagementController.updateName,
);
router.post(
  "/customers/:phone/send-message",
  authenticateToken,
  requireAdmin,
  customerManagementController.sendMessage,
);
router.post(
  "/customers/sync/:userId",
  authenticateToken,
  requireAdmin,
  customerManagementController.syncAppUser,
);

// ==========================================
// 10. AI & FEED & REPORTS
// ==========================================

router.get("/feed", feedController.getPublicFeed);
router.get("/feed/section-types", feedController.getSectionTypes);
router.get(
  "/admin/feed/configurations",
  authenticateToken,
  requireAdmin,
  feedController.getAllConfigurations,
);
router.get(
  "/admin/feed/banners",
  authenticateToken,
  requireAdmin,
  feedController.getAllBanners,
);
router.get(
  "/admin/feed/sections",
  authenticateToken,
  requireAdmin,
  feedController.getAllSections,
);
router.post(
  "/admin/feed/banners",
  authenticateToken,
  requireAdmin,
  uploadAny.single("image"),
  convertImagesToWebPLossless,
  feedController.createBanner,
);
router.put(
  "/admin/feed/banners/:id",
  authenticateToken,
  requireAdmin,
  uploadAny.single("image"),
  convertImagesToWebPLossless,
  feedController.updateBanner,
);
router.delete(
  "/admin/feed/banners/:id",
  authenticateToken,
  requireAdmin,
  feedController.deleteBanner,
);
router.post(
  "/admin/feed/sections",
  authenticateToken,
  requireAdmin,
  feedController.createSection,
);
router.put(
  "/admin/feed/sections/:id",
  authenticateToken,
  requireAdmin,
  feedController.updateSection,
);
router.delete(
  "/admin/feed/sections/:id",
  authenticateToken,
  requireAdmin,
  feedController.deleteSection,
);
router.post(
  "/admin/feed/configurations",
  authenticateToken,
  requireAdmin,
  feedController.createConfiguration,
);
router.put(
  "/admin/feed/configurations/:id",
  authenticateToken,
  requireAdmin,
  feedController.updateConfiguration,
);
router.delete(
  "/admin/feed/configurations/:id",
  authenticateToken,
  requireAdmin,
  feedController.deleteConfiguration,
);

// Feed Section Items
router.post(
  "/admin/feed/sections/:sectionId/items",
  authenticateToken,
  requireAdmin,
  feedController.createSectionItem,
);
router.put(
  "/admin/feed/section-items/:id",
  authenticateToken,
  requireAdmin,
  feedController.updateSectionItem,
);
router.delete(
  "/admin/feed/section-items/:id",
  authenticateToken,
  requireAdmin,
  feedController.deleteSectionItem,
);

router.post("/ai/agent/chat", validateAIAgentKey, aiAgentController.chat);
router.get(
  "/ai/agent/history/:sessionId",
  validateAIAgentKey,
  aiAgentController.getHistory,
);

// 🔄 INCREMENTAL AI AGENT (TEST VERSION)
router.post(
  "/ai/agent/chat-incremental",
  async (req: Request, res: Response) => {
    try {
      const { sessionId, message, customerPhone, customerName } = req.body;

      if (!sessionId || !message || !customerPhone) {
        return res.status(400).json({
          error: "Missing required fields: sessionId, message, customerPhone",
        });
      }

      const aiAgentServiceIncremental = (
        await import("./services/aiAgentServiceIncremental")
      ).default;

      // Aguarda o processamento completo e retorna a mensagem
      const result = await aiAgentServiceIncremental.chatIncremental(
        sessionId,
        message,
        customerPhone,
        customerName,
      );

      return res.json(result);
    } catch (error: any) {
      logger.error("❌ Error in /ai/agent/chat-incremental:", error);
      return res.status(500).json({ error: error.message });
    }
  },
);

router.get(
  "/admin/ai/agent/sessions",
  authenticateToken,
  requireAdmin,
  aiAgentController.listSessions,
);
router.post(
  "/admin/ai/agent/sessions/:sessionId/block",
  authenticateToken,
  requireAdmin,
  aiAgentController.blockSession,
);
router.post(
  "/admin/ai/agent/sessions/:sessionId/unblock",
  authenticateToken,
  requireAdmin,
  aiAgentController.unblockSession,
);
router.delete(
  "/admin/ai/agent/sessions/:sessionId/history",
  authenticateToken,
  requireAdmin,
  aiAgentController.clearSessionHistory,
);

router.get("/ai/products/light", aiProductController.getLightweightProducts);
router.get("/ai/products/detail/:id", aiProductController.getProductDetail);

router.get(
  "/admin/ai/summary",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const summary = await aiSummaryService.getWeeklySummary(
        req.query.force_refresh === "true",
      );
      res.json(summary);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },
);

router.get(
  "/reports/stock",
  authenticateToken,
  requireAdmin,
  reportController.getStockReport,
);
router.get(
  "/reports/stock/critical",
  authenticateToken,
  requireAdmin,
  reportController.getCriticalStock,
);

router.get(
  "/whatsapp/config",
  authenticateToken,
  requireAdmin,
  whatsappController.getConfig,
);
router.post(
  "/whatsapp/test",
  authenticateToken,
  requireAdmin,
  whatsappController.testMessage,
);

// ==========================================
// 11. ADMIN & SYSTEM
// ==========================================

router.get(
  "/admin/holidays",
  authenticateToken,
  requireAdmin,
  holidayController.index,
);
router.post(
  "/admin/holidays",
  authenticateToken,
  requireAdmin,
  holidayController.create,
);
router.put(
  "/admin/holidays/:id",
  authenticateToken,
  requireAdmin,
  holidayController.update,
);
router.delete(
  "/admin/holidays/:id",
  authenticateToken,
  requireAdmin,
  holidayController.delete,
);

router.get(
  "/admin/followup/history",
  authenticateToken,
  requireAdmin,
  followUpController.listHistory,
);
router.post(
  "/admin/followup/toggle",
  authenticateToken,
  requireAdmin,
  followUpController.toggle,
);
router.post(
  "/admin/followup/trigger",
  authenticateToken,
  requireAdmin,
  followUpController.trigger,
);

router.get("/oauth/status", oauthController.status);
router.get(
  "/oauth/authorize",
  authenticateToken,
  requireAdmin,
  oauthController.authorize,
);
router.get("/oauth/callback", oauthController.callback);
router.get(
  "/oauth/debug",
  authenticateToken,
  requireAdmin,
  oauthController.debug,
);
router.post(
  "/oauth/clear",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => oauthController.clear(req, res),
);

router.get(
  "/admin/status",
  authenticateToken,
  requireAdmin,
  statusController.getBusinessStatus,
);

router.post(
  "/admin/google-drive/test",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const folderId = await googleDriveService.createFolder(
        `test-drive-${Date.now()}`,
      );
      await googleDriveService.deleteFolder(folderId);
      res.json({ success: true, message: "Drive upload OK" });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

router.post(
  "/admin/reprocess-finalization",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { orderId } = req.body;
      const result =
        await PaymentService.reprocessFinalizationForOrder(orderId);
      res.json({ success: true, result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

export default router;
