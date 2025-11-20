import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import routes from "./routes";
import cron from "node-cron";
import orderService from "./services/orderService";
import prisma from "./database/prisma";

const app = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.get("/", async (req, res) => {
  return res.json({ message: "Cesto d'Amore Backend is running!" });
});

app.use(routes);

cron.schedule("0 */6 * * *", async () => {
  try {
    console.log("🕒 [Cron] Iniciando limpeza de pedidos cancelados...");

    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    const canceledOrders = await prisma.order.findMany({
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

    console.log(
      `🕒 [Cron] Deletando ${canceledOrders.length} pedidos cancelados...`
    );

    for (const order of canceledOrders) {
      try {
        await orderService.deleteOrder(order.id);
        console.log(`✅ [Cron] Pedido cancelado deletado: ${order.id}`);
      } catch (error) {
        console.error(`❌ [Cron] Erro ao deletar pedido ${order.id}:`, error);
      }
    }

    console.log("✅ [Cron] Limpeza de pedidos cancelados concluída");
  } catch (error) {
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
