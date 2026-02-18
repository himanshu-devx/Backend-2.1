import { ENV } from "@/config/env";

const clamp = (val: number, min: number, max: number) =>
  Math.min(max, Math.max(min, val));

const normalizedRate = clamp(ENV.LOG_SAMPLE_RATE ?? 1, 0, 1);

const hashString = (input: string): number => {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return hash >>> 0;
};

export const sampleRate = normalizedRate;

export const shouldSample = (): boolean => {
  if (normalizedRate >= 1) return true;
  if (normalizedRate <= 0) return false;
  return Math.random() < normalizedRate;
};

export const sampleFromId = (id?: string): boolean => {
  if (!id) return shouldSample();
  if (normalizedRate >= 1) return true;
  if (normalizedRate <= 0) return false;
  const hash = hashString(id);
  return (hash % 10000) / 10000 < normalizedRate;
};
