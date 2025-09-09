"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.categoryController = void 0;
const categoryService_1 = __importDefault(require("../services/categoryService"));
exports.categoryController = {
    async index(req, res) {
        const list = await categoryService_1.default.list();
        res.json(list);
    },
    async show(req, res) {
        const { id } = req.params;
        const item = await categoryService_1.default.getById(id);
        if (!item)
            return res.status(404).json({ message: "Category not found" });
        res.json(item);
    },
    async create(req, res) {
        try {
            const created = await categoryService_1.default.create(req.body);
            res.status(201).json(created);
        }
        catch (err) {
            res.status(400).json({ message: err.message });
        }
    },
    async update(req, res) {
        const { id } = req.params;
        try {
            const updated = await categoryService_1.default.update(id, req.body);
            res.json(updated);
        }
        catch (err) {
            res.status(400).json({ message: err.message });
        }
    },
    async remove(req, res) {
        const { id } = req.params;
        try {
            await categoryService_1.default.remove(id);
            res.status(204).send();
        }
        catch (err) {
            res.status(400).json({ message: err.message });
        }
    },
};
exports.default = exports.categoryController;
