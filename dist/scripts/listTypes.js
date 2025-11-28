"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = __importDefault(require("../database/prisma"));
async function listTypes() {
    try {
        const types = await prisma_1.default.productType.findMany();
        console.log("Product Types:", JSON.stringify(types, null, 2));
    }
    catch (error) {
        console.error(error);
    }
    finally {
        await prisma_1.default.$disconnect();
    }
}
listTypes();
