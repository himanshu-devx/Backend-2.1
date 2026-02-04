import { BaseRepository } from "@/utils/base-repository";
import { MerchantDocument, MerchantModel } from "@/models/merchant.model";

class MerchantRepository extends BaseRepository<MerchantDocument> {
  constructor() {
    super(MerchantModel);
  }
  findByEmail(email: string): Promise<MerchantDocument | null> {
    const query = this.getOneQuery({ email } as any);
    query.select("+password");
    return query.exec();
  }

  // Override to use custom 'id' string instead of _id ObjectId
  async findById(id: string): Promise<MerchantDocument | null> {
    return this.model.findOne({ id }).exec();
  }

  async update(
    id: string,
    payload: Partial<MerchantDocument>
  ): Promise<MerchantDocument | null> {
    return this.model.findOneAndUpdate({ id }, payload, { new: true }).exec();
  }
}

export const merchantRepository = new MerchantRepository();
