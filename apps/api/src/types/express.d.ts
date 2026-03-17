declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        userId?: string;
        username: string;
        email: string;
        credentials?: { apiKey: string; apiSecret: string };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [key: string]: any;
      };
    }
  }
}

export {};
