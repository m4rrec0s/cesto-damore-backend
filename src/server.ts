import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import path from "path";
import routes from "./routes";

const app = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.get("/", async (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.use(routes);

const PORT = process.env.PORT || 3333;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

app.listen(PORT, () => {
  console.log(`🚀 Server running on ${BASE_URL}`);
  console.log(`📡 PORT: ${PORT}`);
  console.log(`🔗 BASE_URL: ${BASE_URL}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`💳 Mercado Pago Webhook: ${BASE_URL}/api/webhook/mercadopago`);
});
