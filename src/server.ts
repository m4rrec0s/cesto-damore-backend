import dotenv from "dotenv";

// Carrega variáveis de ambiente o mais cedo possível, antes de qualquer import
// que possa inicializar o PrismaClient.
dotenv.config();

import express from "express";
import cors from "cors";
import path from "path";
import routes from "./routes";
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", async (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.use("/api", routes);

app.listen(8080, () => {
  console.log("🚀 Server running on http://localhost:8080");
});
