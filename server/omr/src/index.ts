import cors from "cors";
import express from "express";
import { omrRouter } from "./routes/omr";

const app = express();
app.use(cors());
app.use("/v1/omr", omrRouter);

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => {
  console.log(`Zamar OMR service listening on :${port}`);
});
