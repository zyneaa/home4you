import type { IUser } from "./user.type.mjs";

declare global {
  namespace Express {
    interface Request {
      user?: IUser;
    }

    interface Response {
      locals: {
        user?: IUser;
        [key: string]: any; // keep existing locals flexible
      };
    }
  }
}
