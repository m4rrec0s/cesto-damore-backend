"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.userController = void 0;
const userService_1 = __importDefault(require("../services/userService"));
const sharp_1 = __importDefault(require("sharp"));
const googleDrive_1 = require("../config/googleDrive");
exports.userController = {
    async index(req, res) {
        const list = await userService_1.default.list();
        res.json(list);
    },
    async show(req, res) {
        const { id } = req.params;
        const item = await userService_1.default.getById(id);
        if (!item)
            return res.status(404).json({ message: "User not found" });
        res.json(item);
    },
    async create(req, res) {
        try {
            const payload = req.body;
            if (req.file) {
                const compressed = await (0, sharp_1.default)(req.file.buffer)
                    .resize({ width: 800, withoutEnlargement: true })
                    .jpeg({ quality: 80 })
                    .toBuffer();
                const url = await (0, googleDrive_1.uploadToDrive)(compressed, req.file.originalname, req.file.mimetype);
                payload.image_url = url;
            }
            const created = await userService_1.default.create(payload);
            res.status(201).json(created);
        }
        catch (err) {
            res.status(400).json({ message: err.message });
        }
    },
    async update(req, res) {
        const { id } = req.params;
        try {
            const payload = req.body;
            if (req.file) {
                const compressed = await (0, sharp_1.default)(req.file.buffer)
                    .resize({ width: 800, withoutEnlargement: true })
                    .jpeg({ quality: 80 })
                    .toBuffer();
                const url = await (0, googleDrive_1.uploadToDrive)(compressed, req.file.originalname, req.file.mimetype);
                payload.image_url = url;
            }
            const updated = await userService_1.default.update(id, payload);
            res.json(updated);
        }
        catch (err) {
            res.status(400).json({ message: err.message });
        }
    },
    async remove(req, res) {
        const { id } = req.params;
        try {
            await userService_1.default.remove(id);
            res.status(204).send();
        }
        catch (err) {
            res.status(400).json({ message: err.message });
        }
    },
};
exports.default = exports.userController;
