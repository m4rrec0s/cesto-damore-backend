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
import { upload, convertImagesToWebP } from "./config/multer";
import {
  authenticateToken,
  requireAdmin,
  validateMercadoPagoWebhook,
  paymentRateLimit,
  validatePaymentData,
  logFinancialOperation,
} from "./middleware/security";

const router = Router();

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

// category routes
router.get("/categories", categoryController.index);
router.get("/categories/:id", categoryController.show);
router.post("/categories", categoryController.create);
router.put("/categories/:id", categoryController.update);
router.delete("/categories/:id", categoryController.remove);

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

export default router;
