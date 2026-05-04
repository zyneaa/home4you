import http from "k6/http";
import { check, sleep } from "k6";
// Test configuration
export const options = {
  vus: 10, // 10 virtual users
  duration: "15s", // test duration equals your WINDOW_SIZE
  thresholds: {
    http_req_failed: ["rate<0.01"], // <1% errors
    http_req_duration: ["p(95)<500"], // 95% of requests < 500ms
  },
};
const REQUESTS_PER_SECOND_PER_VU = 0.6; // safely below 100 req / 15s
export default function () {
  const res = http.get("http://localhost:8080/api/health"); // your endpoint
  check(res, {
    "status is 200": r => r.status === 200,
    "not rate limited": r => r.status !== 429,
  });
  // Calculate sleep time to stay under the limit
  sleep(1 / REQUESTS_PER_SECOND_PER_VU);
}
//# sourceMappingURL=rateLimitOk.loadtest.js.map
