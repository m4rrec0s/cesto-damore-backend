"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const routes_1 = __importDefault(require("./routes"));
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: "50mb" }));
app.use(express_1.default.urlencoded({ extended: true, limit: "50mb" }));
app.get("/", async (req, res) => {
    return res.json({ message: "Cesto d'Amore Backend is running!" });
});
app.use(routes_1.default);
const PORT = process.env.PORT || 3333;
const BASE_URL = process.env.BASE_URL;
app.listen(PORT, () => {
    console.log(`🚀 Server running on ${BASE_URL}`);
    console.log(`📡 PORT: ${PORT}`);
    console.log(`🔗 BASE_URL: ${BASE_URL}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || "development"}`);
    console.log(`💳 Mercado Pago Webhooks:`);
    console.log(`   - ${BASE_URL}/webhook/mercadopago`);
    console.log(`   - ${BASE_URL}/api/webhook/mercadopago`);
});
