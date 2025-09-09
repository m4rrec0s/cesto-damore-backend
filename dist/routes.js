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
const testController_1 = __importDefault(require("./controller/testController"));
const multer_1 = require("./config/multer");
const router = (0, express_1.Router)();
// Rota para servir imagens locais
router.get("/images/:filename", (req, res) => {
    try {
        const filename = req.params.filename;
        const imagesPath = path_1.default.join(process.cwd(), "images");
        const filePath = path_1.default.join(imagesPath, filename);
        // Verifica se o arquivo existe
        if (!fs_1.default.existsSync(filePath)) {
            return res.status(404).json({
                error: "Imagem não encontrada",
                filename: filename,
            });
        }
        // Envia a imagem
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
router.post("/additional", multer_1.upload.single("image"), additionalController_1.default.create);
router.put("/additional/:id", multer_1.upload.single("image"), additionalController_1.default.update);
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
// category routes
router.get("/categories", categoryController_1.default.index);
router.get("/categories/:id", categoryController_1.default.show);
router.post("/categories", categoryController_1.default.create);
router.put("/categories/:id", categoryController_1.default.update);
router.delete("/categories/:id", categoryController_1.default.remove);
// user routes
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
// test routes
router.post("/test/upload", multer_1.upload.single("image"), multer_1.convertImagesToWebP, testController_1.default.testUpload);
router.post("/test/local-upload", multer_1.upload.single("image"), multer_1.convertImagesToWebP, testController_1.default.testLocalUpload);
router.post("/test/debug-multipart", (req, res) => {
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
router.get("/test/images", testController_1.default.listImages);
router.delete("/test/image", testController_1.default.deleteImage);
router.post("/test/plain", testController_1.default.testPlain);
exports.default = router;
