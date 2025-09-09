"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const additionalController_1 = __importDefault(require("./controller/additionalController"));
const productController_1 = __importDefault(require("./controller/productController"));
const categoryController_1 = __importDefault(require("./controller/categoryController"));
const userController_1 = __importDefault(require("./controller/userController"));
const orderController_1 = __importDefault(require("./controller/orderController"));
const typeController_1 = __importDefault(require("./controller/typeController"));
const authController_1 = __importDefault(require("./controller/authController"));
const multer_1 = require("./config/multer");
const router = (0, express_1.Router)();
router.get("/additional", additionalController_1.default.index);
router.get("/additional/:id", additionalController_1.default.show);
router.post("/additional", multer_1.upload.single("image"), additionalController_1.default.create);
router.put("/additional/:id", multer_1.upload.single("image"), additionalController_1.default.update);
router.delete("/additional/:id", additionalController_1.default.remove);
router.post("/additional/:id/link", additionalController_1.default.link);
router.post("/additional/:id/unlink", additionalController_1.default.unlink);
// product routes
router.get("/products", productController_1.default.index);
router.get("/products/:id", productController_1.default.show);
router.post("/products", multer_1.upload.single("image"), productController_1.default.create);
router.put("/products/:id", multer_1.upload.single("image"), productController_1.default.update);
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
exports.default = router;
