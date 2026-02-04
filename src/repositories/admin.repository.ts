import { BaseRepository } from "@/utils/base-repository";
import { AdminDocument, AdminModel } from "@/models/admin.model";

class AdminRepository extends BaseRepository<AdminDocument> {
  constructor() {
    super(AdminModel);
  }
  findByEmail(email: string): Promise<AdminDocument | null> {
    const query = this.getOneQuery({ email } as any);
    query.select("+password");
    return query.exec();
  }
}

export const adminRepository = new AdminRepository();
