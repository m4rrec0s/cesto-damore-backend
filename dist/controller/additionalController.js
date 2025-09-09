"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.additionalController = void 0;
const additionalService_1 = require("../services/additionalService");
const sharp_1 = __importDefault(require("sharp"));
const googleDrive_1 = require("../config/googleDrive");
exports.additionalController = {
    async index(req, res) {
        const list = await additionalService_1.additionalService.list();
        res.json(list);
    },
    async show(req, res) {
        const { id } = req.params;
        const item = await additionalService_1.additionalService.getById(id);
        if (!item)
            return res.status(404).json({ message: "Additional not found" });
        res.json(item);
    },
    async create(req, res) {
        const payload = req.body;
        try {
            if (req.file) {
                const compressed = await (0, sharp_1.default)(req.file.buffer)
                    .resize({ width: 1600, withoutEnlargement: true })
                    .jpeg({ quality: 80 })
                    .toBuffer();
                const url = await (0, googleDrive_1.uploadToDrive)(compressed, req.file.originalname, req.file.mimetype);
                payload.image_url = url;
            }
            const created = await additionalService_1.additionalService.create(payload);
            res.status(201).json(created);
        }
        catch (err) {
            res.status(400).json({ message: err.message });
        }
    },
    async update(req, res) {
        const { id } = req.params;
        const payload = req.body;
        try {
            if (req.file) {
                const compressed = await (0, sharp_1.default)(req.file.buffer)
                    .resize({ width: 1600, withoutEnlargement: true })
                    .jpeg({ quality: 80 })
                    .toBuffer();
                const url = await (0, googleDrive_1.uploadToDrive)(compressed, req.file.originalname, req.file.mimetype);
                payload.image_url = url;
            }
            const updated = await additionalService_1.additionalService.update(id, payload);
            res.json(updated);
        }
        catch (err) {
            res.status(400).json({ message: err.message });
        }
    },
    async remove(req, res) {
        const { id } = req.params;
        try {
            await additionalService_1.additionalService.remove(id);
            res.status(204).send();
        }
        catch (err) {
            res.status(400).json({ message: err.message });
        }
    },
    async link(req, res) {
        const { id } = req.params; // additional id
        const { productId } = req.body;
        try {
            const rel = await additionalService_1.additionalService.linkToProduct(id, productId);
            res.status(201).json(rel);
        }
        catch (err) {
            res.status(400).json({ message: err.message });
        }
    },
    async unlink(req, res) {
        const { id } = req.params; // additional id
        const { productId } = req.body;
        try {
            await additionalService_1.additionalService.unlinkFromProduct(id, productId);
            res.status(204).send();
        }
        catch (err) {
            res.status(400).json({ message: err.message });
        }
    },
};
exports.default = exports.additionalController;
