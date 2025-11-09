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

app.use("/api", routes);

app.listen(8080, () => {
  console.log("🚀 Server running on http://localhost:8080");
});
