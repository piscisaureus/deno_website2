// Copyright 2018-2019 the Deno authors. All rights reserved. MIT license.

import Benchmarks from "../pages/benchmarks";

// How much to multiply time values in order to process log graphs properly.
const TimeScaleFactor = 10000;

export interface BenchmarkExecTimeResult {
  min?: number;
  max?: number;
  mean?: number;
  stddev?: number;
  system?: number;
  user?: number;
}

export interface BenchmarkExecTimeResultSet {
  [variant: string]: BenchmarkExecTimeResult;
}

export interface BenchmarkVariantsResultSet {
  [variant: string]: number;
}

export interface BenchmarkRun {
  created_at: string;
  sha1: string;
  benchmark: BenchmarkExecTimeResultSet;
  binary_size?: BenchmarkVariantsResultSet | number;
  max_memory?: BenchmarkVariantsResultSet | number;
  bundle_size?: BenchmarkVariantsResultSet;
  max_latency?: BenchmarkVariantsResultSet;
  req_per_sec?: BenchmarkVariantsResultSet;
  req_per_sec_proxy?: BenchmarkVariantsResultSet;
  syscall_count?: BenchmarkVariantsResultSet;
  thread_count?: BenchmarkVariantsResultSet;
  throughput?: BenchmarkVariantsResultSet;
}

export type BenchmarkName = Exclude<keyof BenchmarkRun, "created_at" | "sha1">;

export interface Column {
  name: string;
  data: Array<number | null>;
}

function getBenchmarkVarieties(
  data: BenchmarkRun[],
  benchmarkName: BenchmarkName,
): string[] {
  // Look at last sha hash.
  const last = data[data.length - 1];
  return Object.keys(last[benchmarkName] ?? {});
}

function createColumns(
  data: BenchmarkRun[],
  benchmarkName: BenchmarkName,
): Column[] {
  const varieties = getBenchmarkVarieties(data, benchmarkName);
  return varieties.map((variety) => ({
    name: variety,
    data: data.map((d) => {
      // TODO fix typescript madness.
      d = d as any;
      if (d[benchmarkName] != null) {
        const b = d[benchmarkName] as any;
        if (b[variety] != null) {
          const v = b[variety];
          if (benchmarkName === "benchmark") {
            const meanValue = v ? v.mean : 0;
            return meanValue || null;
          } else {
            return v;
          }
        }
      }
      return null;
    }),
  }));
}

export function createNormalizedColumns(
  data: BenchmarkRun[],
  benchmarkName: BenchmarkName,
): Column[] {
  const data2 = data.map((p) => p[benchmarkName] as BenchmarkVariantsResultSet);

  interface SeriesStats {
    count: number;
    sum: number;
    values: number[];
    stratifiedValues: number[];
    normalizedValues: number[];
  }
  const seriesStats: { [name: string]: SeriesStats } = Object.create(null);
  const zeroValues = () => new Array(data2.length).fill(0);
  const getSeriesStats = (varietyName: string) =>
    seriesStats[varietyName] ??
      (seriesStats[varietyName] = {
        count: 0,
        sum: 0,
        values: zeroValues(),
        stratifiedValues: zeroValues(),
        normalizedValues: zeroValues(),
      });
  for (const [k, v] of data2.flatMap(Object.entries).filter(([, v]) => !!v)) {
    const stats = getSeriesStats(k);
    stats.sum += v;
    stats.count += 1;
  }
  for (const [varietyName, stats] of Object.entries(seriesStats)) {
    // Use squares?
    const stratificationScaleFactor = stats.sum != 0
      ? stats.count / stats.sum
      : 0;
    for (let i = 0; i < data2.length; i++) {
      const v = data2[i][varietyName] ?? 0;
      stats.values[i] = v;
      stats.stratifiedValues[i] = v * stratificationScaleFactor;
    }
  }
  interface SampleStats {
    count: number;
    sum: number;
    normalizationFactor: number;
  }
  const sampleStats: SampleStats[] = new Array(data2.length)
    .fill(null).map((_, i) => {
      const samples = Object.values(seriesStats).map((stats) =>
        stats.stratifiedValues[i]
      ).filter((v) => !!v);
      const count = samples.length;
      const sum = samples.reduce((acc, v) => acc + v, 0);
      const normalizationFactor = sum > 0 ? count / sum : 0;
      return { count, sum, normalizationFactor };
    });
  for (const stats of Object.values(seriesStats)) {
    stats.normalizedValues = stats.stratifiedValues.map(
      (v, i) => v * sampleStats[i].normalizationFactor,
    );
  }
  const result = Object.entries(seriesStats).map(([name, stats]) => ({
    name,
    data: filter(stats.normalizedValues.map((v) => v || null)),
  }));
  function filter(values: number[]): number[] {
    const delay = 20;
    let acc = 1;
    const values2 = [...values];
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (!v) continue;
      acc = (v / delay) + (acc * (1 - (1 / delay)));
      values2[i] = acc;
    }
    return values2;
  }
  const avgData = sampleStats.map((_, i) => {
    const values = Object.values(seriesStats).map((stats) =>
      stats.normalizedValues[i]
    ).filter(Boolean);
    const count = values.length;
    const sum = values.reduce((acc, v) => acc + v, 0);
    const avg = count > 0 ? sum / count : 1;
    return avg;
  });
  result.push({ name: "average", data: avgData });
  return result;
}

function createBinarySizeColumns(data: BenchmarkRun[]): Column[] {
  const propName = "binary_size";
  const last = data[data.length - 1]!;
  const binarySizeNames = Object.keys(last[propName]!);
  return binarySizeNames.map((name) => ({
    name,
    data: data.map((d) => {
      const binarySizeData = d["binary_size"];
      switch (typeof binarySizeData) {
        case "number": // legacy implementation
          return name === "deno" ? binarySizeData : 0;
        default:
          if (!binarySizeData) {
            return null;
          }
          return binarySizeData[name] || null;
      }
    }),
  }));
}

function createThreadCountColumns(data: BenchmarkRun[]): Column[] {
  const propName = "thread_count";
  const last = data[data.length - 1];
  const threadCountNames = Object.keys(last[propName]!);
  return threadCountNames.map((name) => ({
    name,
    data: data.map((d) => {
      const threadCountData = d[propName];
      if (!threadCountData) {
        return null;
      }
      return threadCountData[name] || null;
    }),
  }));
}

function createSyscallCountColumns(data: BenchmarkRun[]): Column[] {
  const propName = "syscall_count";
  const syscallCountNames = Object.keys(data[data.length - 1][propName]!);
  return syscallCountNames.map((name) => ({
    name,
    data: data.map((d) => {
      const syscallCountData = d[propName];
      if (!syscallCountData) {
        return null;
      }
      return syscallCountData[name] || null;
    }),
  }));
}

export function formatFloat(n: number): string {
  return n.toFixed(3);
}

export function formatKB(bytes: number): string {
  return (bytes / 1024).toFixed(2);
}

export function formatMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(2);
}

export function formatReqSec(reqPerSec: number): string {
  return (reqPerSec / 1000).toFixed(3);
}

export function formatPercentage(decimal: number): string {
  return (decimal * 100).toFixed(2);
}

export function formatLogScale(t: number): string {
  return (Math.pow(10, t) / TimeScaleFactor).toFixed(4);
}

export function logScale(columns: Column[]): void {
  for (const col of columns) {
    for (let i = 0; i < col.data.length; i++) {
      if (col.data[i] == null || col.data[i] === 0) {
        continue;
      }
      col.data[i] = Math.log10((col.data[i] as number) * TimeScaleFactor);
    }
  }
}

function renameReqPerSecFields(data: BenchmarkRun[]): void {
  /* eslint-disable @typescript-eslint/camelcase */
  for (const row of data) {
    if (row.req_per_sec === undefined) continue;
    const {
      core_http_bin_ops,
      deno_core_http_bench,
      deno_core_single,
      deno_tcp,
      deno,
      node_http,
      node,
      ...rest
    } = row.req_per_sec;
    row.req_per_sec = {
      core_http_bin_ops:
        core_http_bin_ops ?? deno_core_http_bench ?? deno_core_single,
      deno_tcp: deno_tcp ?? deno,
      node_http: node_http ?? node,
      ...rest,
    };
  }
}

const proxyFields: BenchmarkName[] = ["req_per_sec"];
function extractProxyFields(data: BenchmarkRun[]): void {
  for (const row of data) {
    for (const field of proxyFields) {
      const d = row[field];
      if (!d) continue;
      const name = field + "_proxy";
      const newField = {};
      (row as any)[name] = newField;
      for (const k of Object.getOwnPropertyNames(d)) {
        if (k.includes("_proxy")) {
          const d2 = d as any;
          const v = d2[k];
          delete d2[k];
          (newField as any)[k] = v;
        }
      }
    }
  }
}

export interface BenchmarkData {
  execTime: Column[];
  throughput: Column[];
  reqPerSec: Column[];
  normalizedReqPerSec: Column[];
  proxy: Column[];
  normalizedProxy: Column[];
  maxLatency: Column[];
  maxMemory: Column[];
  binarySize: Column[];
  threadCount: Column[];
  syscallCount: Column[];
  bundleSize: Column[];
  sha1List: string[];
}

export function reshape(data: BenchmarkRun[]): BenchmarkData {
  // Rename req/s fields that had a different name in the past.
  renameReqPerSecFields(data);
  // Hack to extract proxy fields from req/s fields.
  extractProxyFields(data);

  const normalizedReqPerSec = createNormalizedColumns(
    data,
    "req_per_sec",
  );
  const normalizedProxy = createNormalizedColumns(
    data,
    "req_per_sec_proxy",
  );

  return {
    execTime: createColumns(data, "benchmark"),
    throughput: createColumns(data, "throughput"),
    reqPerSec: createColumns(data, "req_per_sec"),
    normalizedReqPerSec,
    proxy: createColumns(data, "req_per_sec_proxy"),
    normalizedProxy,
    maxLatency: createColumns(data, "max_latency"),
    maxMemory: createColumns(data, "max_memory"),
    binarySize: createBinarySizeColumns(data),
    threadCount: createThreadCountColumns(data),
    syscallCount: createSyscallCountColumns(data),
    bundleSize: createColumns(data, "bundle_size"),
    sha1List: data.map((d) => d.sha1),
  };
}
