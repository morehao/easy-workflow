#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""轻量只读压测：并发请求待办列表，验证 P95/错误率。
用法: python3 web/scripts/load-test.py [base_url] [concurrency] [requests]
默认 http://127.0.0.1:8180/process 50 200
"""
import concurrent.futures
import statistics
import sys
import time
import urllib.request

base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8180/process"
concurrency = int(sys.argv[2]) if len(sys.argv) > 2 else 50
total = int(sys.argv[3]) if len(sys.argv) > 3 else 200
url = base + "/task/todo?userid=&asc=true&idx=0&rows=20"

def one(_):
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            body = resp.read()
            return resp.status, time.perf_counter() - start, len(body)
    except Exception as e:  # noqa: BLE001
        return 0, time.perf_counter() - start, str(e)

start = time.perf_counter()
with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as ex:
    results = list(ex.map(one, range(total)))
elapsed = time.perf_counter() - start
lat = sorted(r[1] for r in results)
errors = [r for r in results if r[0] != 200]
p95 = lat[max(0, int(len(lat) * 0.95) - 1)] if lat else 0
print(f"requests={total} concurrency={concurrency} elapsed={elapsed:.2f}s rps={total/elapsed:.1f}")
print(f"ok={total-len(errors)} errors={len(errors)} p50={statistics.median(lat)*1000:.1f}ms p95={p95*1000:.1f}ms")
if errors:
    print("sample error:", errors[0])
    sys.exit(1)
