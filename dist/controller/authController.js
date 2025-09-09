"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authController = void 0;
const authService_1 = __importDefault(require("../services/authService"));
const sharp_1 = __importDefault(require("sharp"));
const googleDrive_1 = require("../config/googleDrive");
exports.authController = {
    async google(req, res) {
        const { idToken } = req.body;
        try {
            const result = await authService_1.default.googleLogin({ idToken, ...req.body });
            res.json(result);
        }
        catch (err) {
            res.status(400).json({ message: err.message });
        }
    },
    async login(req, res) {
        const { email, password } = req.body;
        try {
            const result = await authService_1.default.login(email, password);
            res.json(result);
        }
        catch (err) {
            res.status(400).json({ message: err.message });
        }
    },
    async register(req, res) {
        const { email, password, name } = req.body;
        try {
            let imageUrl = undefined;
            if (req.file) {
                const compressed = await (0, sharp_1.default)(req.file.buffer)
                    .resize({ width: 800, withoutEnlargement: true })
                    .jpeg({ quality: 80 })
                    .toBuffer();
                imageUrl = await (0, googleDrive_1.uploadToDrive)(compressed, req.file.originalname, req.file.mimetype);
            }
            const result = await authService_1.default.registerWithEmail(email, password, name, imageUrl);
            res.status(201).json(result);
        }
        catch (err) {
            res.status(400).json({ message: err.message });
        }
    },
};
exports.default = exports.authController;
