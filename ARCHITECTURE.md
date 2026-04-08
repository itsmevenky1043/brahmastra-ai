# Brahmastra AI: High-Traffic Architecture Redesign

To handle 5,000+ concurrent users and eliminate 503 "High Demand" errors, the system has been redesigned with a production-grade asynchronous architecture.

## 🏗️ System Architecture

1.  **Frontend (React/Vite)**:
    *   Submits analysis/optimization requests to the backend.
    *   Receives a `jobId` and enters a "Processing" state.
    *   Polls the backend for job status updates.
    *   Displays real-time progress to the user.

2.  **Backend API (Express)**:
    *   **Rate Limiting**: Implements `express-rate-limit` to prevent abuse and ensure fair resource distribution.
    *   **Job Producer**: Pushes incoming requests into a persistent queue (BullMQ).
    *   **Caching**: Uses Redis to store results for identical Resume/JD pairs, reducing redundant AI calls.

3.  **Queue System (BullMQ + Redis)**:
    *   Decouples the request from the execution.
    *   Handles spikes in traffic by buffering requests.
    *   Ensures no request is lost if the AI model is temporarily unavailable.

4.  **Background Workers**:
    *   Process jobs from the queue.
    *   **Exponential Backoff**: Retries failed AI calls (503 errors) with increasing delays (2s, 4s, 8s...).
    *   **Graceful Degradation**: If the primary model fails repeatedly, it can be configured to fallback to a secondary model.

5.  **Scaling Strategy**:
    *   **Horizontal Scaling**: Workers can be scaled independently based on queue depth.
    *   **Serverless/K8s**: Deploy workers as serverless functions or Kubernetes pods that autoscale under load.

## 🛠️ Key Features for 5K Users

*   **Queue-Based Processing**: Requests are never sent directly to the AI model, preventing direct 503 propagation to the user.
*   **Redis Caching**: Frequent requests for similar job descriptions are served instantly from cache.
*   **Rate Limiting**: Prevents a single user from monopolizing the AI workers.
*   **Monitoring**: Failures are logged and can be monitored via Prometheus/Grafana (integrated at the infrastructure level).

## 🚀 Deployment Requirements

*   **Redis Server**: Required for BullMQ and Caching.
*   **Environment Variables**:
    *   `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`
    *   `GEMINI_API_KEY`
