export declare const options: {
  readonly stages: readonly [
    {
      readonly duration: "30s";
      readonly target: 50;
    },
    {
      readonly duration: "60s";
      readonly target: 500;
    },
    {
      readonly duration: "30s";
      readonly target: 0;
    },
  ];
  readonly thresholds: {
    readonly errors: readonly ["rate<0.02"];
    readonly http_req_duration: readonly ["p(95)<1000"];
  };
  readonly teardownTimeout: "30s";
};
export default function (): void;
//# sourceMappingURL=rateLimit.loadtest.d.ts.map
