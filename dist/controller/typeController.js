"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.typeController = void 0;
const typeService_1 = require("../services/typeService");
exports.typeController = {
    async index(req, res) {
        const list = await typeService_1.typeService.list();
        res.json(list);
    },
    async show(req, res) {
        const { id } = req.params;
        const item = await typeService_1.typeService.getById(id);
        if (!item)
            return res.status(404).json({ message: "Type not found" });
        res.json(item);
    },
    async create(req, res) {
        try {
            const newItem = await typeService_1.typeService.create(req.body);
            res.status(201).json(newItem);
        }
        catch (err) {
            res.status(400).json({ message: "Error creating type: " + err.message });
        }
    },
    async update(req, res) {
        const { id } = req.params;
        try {
            const updatedItem = await typeService_1.typeService.update(id, req.body);
            if (!updatedItem)
                return res.status(404).json({ message: "Type not found" });
            res.json(updatedItem);
        }
        catch (error) {
            res
                .status(400)
                .json({ message: "Error updating type: " + error.message });
        }
    },
    async remove(req, res) {
        const { id } = req.params;
        try {
            await typeService_1.typeService.remove(id);
            res.status(204).send();
        }
        catch (err) {
            res.status(400).json({ message: "Error removing type: " + err.message });
        }
    },
};
exports.default = exports.typeController;
