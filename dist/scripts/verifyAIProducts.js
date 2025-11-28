"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const aiProductService_1 = __importDefault(require("../services/aiProductService"));
const prisma_1 = __importDefault(require("../database/prisma"));
async function verify() {
    try {
        console.log("START_VERIFICATION");
        const lightProducts = await aiProductService_1.default.getLightweightProducts();
        console.log(`Total products: ${lightProducts.products.length}`);
        console.log("\n--- Current Order ---");
        lightProducts.products.forEach((p, index) => {
            console.log(`${index + 1}. [${p.price}] ${p.name} (Tags: ${p.tags.join(", ")})`);
        });
        console.log("END_VERIFICATION");
    }
    catch (error) {
        console.error("Verification failed:", error);
    }
    finally {
        await prisma_1.default.$disconnect();
    }
}
verify();
