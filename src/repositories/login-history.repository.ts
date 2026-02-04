import { BaseRepository } from "@/utils/base-repository";
import {
  LoginHistoryDocument,
  LoginHistoryModel,
} from "@/models/login-history.model";

export class LoginHistoryRepository extends BaseRepository<LoginHistoryDocument> {
  constructor() {
    super(LoginHistoryModel);
  }
}

export const loginHistoryRepository = new LoginHistoryRepository();
