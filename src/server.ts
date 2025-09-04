import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";
import routes from "./routes";

dotenv.config();
const app = express();

app.use(cors());
app.use(express.json());

app.get("/", async (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.use("/api", routes);

app.listen(8080, () => {
  console.log("🚀 Server running on http://localhost:8080");
});
