/// <reference types="jest" />

declare global {
  namespace jest {
    interface MockedFunction<T extends (...args: unknown[]) => any> {
      (...args: Parameters<T>): ReturnType<T>;
      mockReturnValue(value: ReturnType<T>): this;
      mockResolvedValue(value: ReturnType<T>): this;
      mockRejectedValue(value: unknown): this;
    }
  }
}

export {};