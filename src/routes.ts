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
import testController from "./controller/testController";
import { upload, convertImagesToWebP, uploadAny } from "./config/multer";

const router = Router();

// Rota para servir imagens locais
router.get("/images/:filename", (req: Request, res: Response) => {
  try {
    const filename = req.params.filename;
    const imagesPath = path.join(process.cwd(), "images");
    const filePath = path.join(imagesPath, filename);

    // Verifica se o arquivo existe
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        error: "Imagem não encontrada",
        filename: filename,
      });
    }

    // Envia a imagem
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
router.post("/additional", upload.single("image"), additionalController.create);
router.put(
  "/additional/:id",
  upload.single("image"),
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

// category routes
router.get("/categories", categoryController.index);
router.get("/categories/:id", categoryController.show);
router.post("/categories", categoryController.create);
router.put("/categories/:id", categoryController.update);
router.delete("/categories/:id", categoryController.remove);

// user routes
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

// test routes
router.post(
  "/test/upload",
  upload.single("image"),
  convertImagesToWebP,
  testController.testUpload
);
router.post(
  "/test/local-upload",
  upload.single("image"),
  convertImagesToWebP,
  testController.testLocalUpload
);
router.post("/test/debug-multipart", (req: Request, res: Response) => {
  console.log("=== DEBUG MULTIPART ===");
  console.log("Headers:", req.headers);
  console.log("Content-Type:", req.headers["content-type"]);
  console.log("Body keys:", Object.keys(req.body || {}));
  console.log("Body:", req.body);
  console.log("File:", req.file);
  console.log("Files:", req.files);
  console.log("Raw headers:", JSON.stringify(req.headers, null, 2));
  console.log("========================");

  res.json({
    headers: req.headers,
    bodyKeys: Object.keys(req.body || {}),
    body: req.body,
    hasFile: !!req.file,
    hasFiles: !!req.files,
    file: req.file
      ? {
          fieldname: req.file.fieldname,
          originalname: req.file.originalname,
          mimetype: req.file.mimetype,
          size: req.file.size,
        }
      : null,
    files: req.files,
  });
});
router.get("/test/images", testController.listImages);
router.delete("/test/image", testController.deleteImage);
router.post("/test/plain", testController.testPlain);

export default router;
