import { mongoose } from "@/infra/mongoose-instance";
import { Schema, Document, Model } from "mongoose";
import { getISTDate } from "@/utils/date.util";

export interface CounterDocument extends Omit<Document, "_id"> {
  _id: string; // The name of the sequence
  seq: number;
}

const CounterSchema = new Schema<CounterDocument>(
  {
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
  },
  {
    timestamps: { currentTime: getISTDate },
  }
);

export const CounterModel: Model<CounterDocument> =
  mongoose.models.Counter || mongoose.model("Counter", CounterSchema);
