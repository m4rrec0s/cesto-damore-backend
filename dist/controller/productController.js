"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.productController = void 0;
const productService_1 = __importDefault(require("../services/productService"));
const sharp_1 = __importDefault(require("sharp"));
const googleDrive_1 = require("../config/googleDrive");
exports.productController = {
    async index(req, res) {
        const list = await productService_1.default.list();
        res.json(list);
    },
    async show(req, res) {
        const { id } = req.params;
        const item = await productService_1.default.getById(id);
        if (!item)
            return res.status(404).json({ message: "Product not found" });
        res.json(item);
    },
    async create(req, res) {
        try {
            const payload = req.body;
            console.log("Received file:", req.file ? "YES" : "NO");
            console.log("Payload before image processing:", payload);
            if (req.file) {
                console.log("Processing image file:", req.file.originalname, req.file.size);
                const compressed = await (0, sharp_1.default)(req.file.buffer)
                    .resize({ width: 1600, withoutEnlargement: true })
                    .jpeg({ quality: 80 })
                    .toBuffer();
                const url = await (0, googleDrive_1.uploadToDrive)(compressed, req.file.originalname, req.file.mimetype);
                payload.image_url = url;
                console.log("Image uploaded to:", url);
            }
            console.log("Final payload:", payload);
            const created = await productService_1.default.create(payload);
            res.status(201).json(created);
        }
        catch (err) {
            console.error("Error creating product:", err);
            res
                .status(400)
                .json({ message: "Error creating product: " + err.message });
        }
    },
    async update(req, res) {
        const { id } = req.params;
        try {
            const payload = req.body;
            if (req.file) {
                const compressed = await (0, sharp_1.default)(req.file.buffer)
                    .resize({ width: 1600, withoutEnlargement: true })
                    .jpeg({ quality: 80 })
                    .toBuffer();
                const url = await (0, googleDrive_1.uploadToDrive)(compressed, req.file.originalname, req.file.mimetype);
                payload.image_url = url;
            }
            const updated = await productService_1.default.update(id, payload);
            if (!updated)
                return res.status(404).json({ message: "Product not found" });
            res.json(updated);
        }
        catch (err) {
            res
                .status(400)
                .json({ message: "Error updating product: " + err.message });
        }
    },
    async remove(req, res) {
        const { id } = req.params;
        try {
            await productService_1.default.remove(id);
            res.status(204).send();
        }
        catch (err) {
            res
                .status(400)
                .json({ message: "Error removing product: " + err.message });
        }
    },
    async link(req, res) {
        const { id } = req.params;
        const { additionalId } = req.body;
        try {
            const rel = await productService_1.default.linkAdditional(id, additionalId);
            res.status(201).json(rel);
        }
        catch (err) {
            res
                .status(400)
                .json({ message: "Error linking product: " + err.message });
        }
    },
    async unlink(req, res) {
        const { id } = req.params;
        const { additionalId } = req.body;
        try {
            await productService_1.default.unlinkAdditional(id, additionalId);
            res.status(204).send();
        }
        catch (err) {
            res
                .status(400)
                .json({ message: "Error unlinking product: " + err.message });
        }
    },
};
exports.default = exports.productController;
