// loadtest.ts
import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";
/**
 * TypeScript for k6 — transpile to JS before running k6.
 *
 * This script simulates realistic clients (jittered think-time),
 * sends a header-heavy request to the target, and collects metrics.
 *
 * Two modes:
 *  - VU-based stages (default)
 *  - RPS-based (arrival rate) — uncomment scenario block to use it
 */
/* -------------------------
   Metrics
   ------------------------- */
const reqDuration = new Trend("req_duration_ms");
const errRate = new Rate("errors");
/* -------------------------
   Config
   ------------------------- */
export const options = {
  // Default scenario: VU stages (uncomment arrival-rate scenario below to use RPS)
  stages: [
    { duration: "30s", target: 50 }, // warmup
    { duration: "60s", target: 500 }, // ramp to mid
    { duration: "30s", target: 0 }, // ramp down
  ],
  thresholds: {
    // fail if >2% errors or p95 latency above 1000ms
    errors: ["rate<0.02"],
    http_req_duration: ["p(95)<1000"],
  },
  // Optional: increase grace period for shutdowns
  teardownTimeout: "30s",
};
/* -------------------------
   // If you prefer exact RPS, comment-out the 'stages' block above and
   // uncomment the 'scenarios' block below. This runs constant-arrival-rate.
   ------------------------- */
/*
export const options = {
  scenarios: {
    steady_rps: {
      executor: "constant-arrival-rate",
      rate: 2000,            // target RPS (requests per second)
      timeUnit: "1s",
      duration: "10m",
      preAllocatedVUs: 200,  // initial VUs
      maxVUs: 5000,
    },
  },
  thresholds: {
    errors: ["rate<0.02"],
    http_req_duration: ["p(95)<1000"],
  },
} as const;
*/
/* -------------------------
   Target & helpers
   ------------------------- */
const TARGET = __ENV.TARGET ?? "http://127.0.0.1:8080"; // override with env var if needed
function makeThiccHeaders() {
  // The Rust server responds with massive headers; let's send some varied headers too.
  const headers = {
    "User-Agent": "k6-loadtester/1.0",
    Accept: "text/plain",
    "X-Client-Id": `${Math.floor(Math.random() * 10_000)}`,
  };
  // add a bunch of smaller custom headers to simulate real-world traffic diversity
  for (let i = 0; i < 20; i++) {
    headers[`X-Custom-${i}`] = "loremipsumdolorsitamet";
  }
  return headers;
}
/* -------------------------
   Main
   ------------------------- */
export default function () {
  const url = `${TARGET}/api/health`; // adjust if your endpoint differs
  // Build request params
  const params = {
    headers: makeThiccHeaders(),
    tags: { endpoint: "/api/health" }, // handy for k6 output filtering
    timeout: "60s",
  };
  const start = Date.now();
  const res = http.get(url, params);
  const dur = Date.now() - start;
  reqDuration.add(dur);
  const ok = check(res, {
    "status 200": r => r.status === 200,
    "not 429": r => r.status !== 429,
    "not 5xx": r => r.status < 500,
  });
  if (!ok) {
    errRate.add(1);
  } else {
    errRate.add(0);
  }
  // realistic think time with jitter: 50ms - 600ms
  sleep(Math.random() * 0.55 + 0.05);
}
//# sourceMappingURL=rateLimit.loadtest.js.map
