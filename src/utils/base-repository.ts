import { Document, FilterQuery, Model, Query } from "mongoose";

export interface ListOptions<T> {
  filter?: FilterQuery<T>;
  page?: number;
  limit?: number;
  search?: string;
  searchFields?: (keyof T)[];
  sort?: string | Record<string, 1 | -1>;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export class BaseRepository<T> {
  protected model: Model<T>;

  constructor(model: Model<T>) {
    this.model = model;
  }

  async create(payload: Partial<T>): Promise<T> {
    const doc = new this.model(payload);
    return (await doc.save()) as unknown as T;
  }

  async findById(id: string): Promise<T | null> {
    return this.model.findById(id).exec() as unknown as T | null;
  }

  async findOne(filter: FilterQuery<T>): Promise<T | null> {
    return this.model.findOne(filter).exec() as unknown as T | null;
  }
  async list(options: ListOptions<T> = {}): Promise<PaginatedResult<T>> {
    const {
      filter = {},
      page = 1,
      limit = 10,
      search,
      searchFields = [],
      sort,
    } = options;

    const queryFilter: FilterQuery<T> = { ...filter };

    // search across fields with regex
    if (search && searchFields.length > 0) {
      const or = searchFields.map((f) => ({
        [f as string]: { $regex: search, $options: "i" },
      }));
      (queryFilter as any).$or = or;
    }

    const skip = (page - 1) * limit;

    // parse sort string like "name,-createdAt"
    let sortOption: any = undefined;
    if (typeof sort === "string") {
      sortOption = sort
        .split(",")
        .filter(Boolean)
        .reduce((acc: Record<string, 1 | -1>, field) => {
          if (field.startsWith("-")) {
            acc[field.substring(1)] = -1;
          } else {
            acc[field] = 1;
          }
          return acc;
        }, {});
    } else if (sort && typeof sort === "object") {
      sortOption = sort;
    }

    const [data, total] = await Promise.all([
      this.model
        .find(queryFilter)
        .sort(sortOption)
        .skip(skip)
        .limit(limit)
        .exec() as unknown as T[],
      this.model.countDocuments(queryFilter).exec(),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  protected getOneQuery(filter: any): Query<T | null, T> {
    return this.model.findOne(filter) as unknown as Query<T | null, T>;
  }

  async update(id: string, payload: Partial<T>): Promise<T | null> {
    return this.model
      .findByIdAndUpdate(
        id,
        payload,
        { new: true } // { new: true } ensures the method returns the updated document, not the original.
      )
      .exec() as unknown as T | null;
  }
  // -
}
