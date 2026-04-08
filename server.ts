import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { Queue, Worker, Job } from "bullmq";
import Redis from "ioredis";
import rateLimit from "express-rate-limit";
import { analyzeResume, optimizeResume } from "./src/lib/gemini.js";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Redis Connection
const rawHost = process.env.REDIS_HOST || "localhost";
const rawPort = process.env.REDIS_PORT || "6379";

let host = rawHost.trim();
let port = parseInt(rawPort.trim());

// Handle cases where host might include the port (e.g. from a copy-paste)
if (host.includes(":")) {
  const parts = host.split(":");
  host = parts[0];
  port = parseInt(parts[1]);
}

console.log(`[Redis] Attempting connection to ${host}:${port}`);

// Redis Connections
const redisOptions = {
  host,
  port,
  password: process.env.REDIS_PASSWORD?.trim(),
  maxRetriesPerRequest: null,
};

const connection = new Redis(redisOptions);
const workerConnection = new Redis(redisOptions);

connection.on("connect", () => console.log(`[Redis] Main connection successful to ${host}:${port}`));
workerConnection.on("connect", () => console.log(`[Redis] Worker connection successful to ${host}:${port}`));

connection.on("error", (err) => {
  console.error("[Redis] Main Error:", err.message);
  if (err.message.includes("ENOTFOUND")) {
    console.error(`[Redis] DNS Error: Could not find host "${host}". Please check if the REDIS_HOST secret is correct and complete.`);
  }
});
workerConnection.on("error", (err) => console.error("[Redis] Worker Error:", err.message));

// Queues
const analysisQueue = new Queue("analysis-queue", { connection });
const optimizationQueue = new Queue("optimization-queue", { connection });

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: { error: "Too many requests, please try again later." },
});

app.use(express.json({ limit: "10mb" }));
app.use("/api/", limiter);

// API Routes
app.post("/api/analyze", async (req, res) => {
  const { resumeText, jdText } = req.body;
  
  if (!resumeText || !jdText) {
    return res.status(400).json({ error: "Missing resume or JD text" });
  }

  // Check Cache
  const cacheKey = `analysis:${Buffer.from(resumeText + jdText).toString("base64").substring(0, 50)}`;
  const cachedResult = await connection.get(cacheKey);
  if (cachedResult) {
    return res.json({ jobId: "cached", result: JSON.parse(cachedResult) });
  }

  const job = await analysisQueue.add("analyze", { resumeText, jdText }, {
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
  });

  res.json({ jobId: job.id });
});

app.post("/api/optimize", async (req, res) => {
  const { resumeText, jdText, analysis } = req.body;

  if (!resumeText || !jdText || !analysis) {
    return res.status(400).json({ error: "Missing required data" });
  }

  const job = await optimizationQueue.add("optimize", { resumeText, jdText, analysis }, {
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
  });

  res.json({ jobId: job.id });
});

app.get("/api/job/:queue/:id", async (req, res) => {
  const { queue, id } = req.params;
  
  if (id === "cached") {
    return res.json({ status: "completed" });
  }

  const targetQueue = queue === "analysis" ? analysisQueue : optimizationQueue;
  const job = await Job.fromId(targetQueue, id);

  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  const state = await job.getState();
  res.json({
    id: job.id,
    status: state,
    progress: job.progress,
    result: job.returnvalue,
    error: job.failedReason,
  });
});

// Workers
const analysisWorker = new Worker("analysis-queue", async (job) => {
  console.log(`[Worker] Starting Analysis Job ${job.id}`);
  const { resumeText, jdText } = job.data;
  const result = await analyzeResume(resumeText, jdText);
  
  const cacheKey = `analysis:${Buffer.from(resumeText + jdText).toString("base64").substring(0, 50)}`;
  await connection.setex(cacheKey, 3600, JSON.stringify(result));
  
  console.log(`[Worker] Completed Analysis Job ${job.id}`);
  return result;
}, { connection: workerConnection });

const optimizationWorker = new Worker("optimization-queue", async (job) => {
  console.log(`[Worker] Starting Optimization Job ${job.id}`);
  const { resumeText, jdText, analysis } = job.data;
  const result = await optimizeResume(resumeText, jdText, analysis);
  console.log(`[Worker] Completed Optimization Job ${job.id}`);
  return result;
}, { connection: workerConnection });

analysisWorker.on("failed", (job, err) => {
  console.error(`Analysis Job ${job?.id} failed:`, err);
});

optimizationWorker.on("failed", (job, err) => {
  console.error(`Optimization Job ${job?.id} failed:`, err);
});

// Vite middleware setup
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
