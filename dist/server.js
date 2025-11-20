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
const node_cron_1 = __importDefault(require("node-cron"));
const orderService_1 = __importDefault(require("./services/orderService"));
const prisma_1 = __importDefault(require("./database/prisma"));
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: "50mb" }));
app.use(express_1.default.urlencoded({ extended: true, limit: "50mb" }));
app.get("/", async (req, res) => {
    return res.json({ message: "Cesto d'Amore Backend is running!" });
});
app.use(routes_1.default);
node_cron_1.default.schedule("0 */6 * * *", async () => {
    try {
        console.log("🕒 [Cron] Iniciando limpeza de pedidos cancelados...");
        const twentyFourHoursAgo = new Date();
        twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);
        const canceledOrders = await prisma_1.default.order.findMany({
            where: {
                status: "CANCELED",
                updated_at: {
                    lt: twentyFourHoursAgo,
                },
            },
            select: {
                id: true,
                updated_at: true,
            },
        });
        if (canceledOrders.length === 0) {
            console.log("🕒 [Cron] Nenhum pedido cancelado para deletar");
            return;
        }
        console.log(`🕒 [Cron] Deletando ${canceledOrders.length} pedidos cancelados...`);
        for (const order of canceledOrders) {
            try {
                await orderService_1.default.deleteOrder(order.id);
                console.log(`✅ [Cron] Pedido cancelado deletado: ${order.id}`);
            }
            catch (error) {
                console.error(`❌ [Cron] Erro ao deletar pedido ${order.id}:`, error);
            }
        }
        console.log("✅ [Cron] Limpeza de pedidos cancelados concluída");
    }
    catch (error) {
        console.error("❌ [Cron] Erro na limpeza de pedidos cancelados:", error);
    }
});
const PORT = process.env.PORT || 3333;
const BASE_URL = process.env.BASE_URL;
app.listen(PORT, () => {
    console.log(`🚀 Server running on ${BASE_URL}`);
    console.log(`📡 PORT: ${PORT}`);
    console.log(`🔗 BASE_URL: ${BASE_URL}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || "development"}`);
});
