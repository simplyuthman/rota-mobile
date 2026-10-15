# Rota Load Tests

This directory contains k6 load testing scripts and recorded performance reports.

## Requirements (AGENTS.md §3.5 D-07)
- 200 virtual users (VUs)
- 30 s ramp-up
- 3 min steady state
- p95 latency <= 500 ms
- Error rate < 1%
- Tests cached first-page feed reads against a baseline run first

## Execution
```bash
k6 run load-tests/k6-feed-baseline.js
```
