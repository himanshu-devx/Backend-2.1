import { CounterModel } from "@/models/counter.model";
import slugify from "slugify";

/**
 * Generates a slug from the given text.
 * Example: "HDFC Bank" -> "hdfc-bank"
 */
export const generateSlug = (text: string): string => {
  return slugify(text, {
    lower: true,
    strict: true,
    trim: true,
  });
};

/**
 * Gets the next sequence number for a given sequence name.
 * Atomically increments the counter.
 */
export const getNextSequence = async (
  sequenceName: string
): Promise<number> => {
  const counter = await CounterModel.findByIdAndUpdate(
    sequenceName,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return counter.seq;
};

/**
 * Generates a custom ID with a prefix and valid sequence number.
 * Example: generateCustomId("WA") -> "WA-1"
 */
export const generateCustomId = async (
  prefix: string,
  sequenceName: string
): Promise<string> => {
  const seq = await getNextSequence(sequenceName);
  return `${prefix}-${seq}`;
};
