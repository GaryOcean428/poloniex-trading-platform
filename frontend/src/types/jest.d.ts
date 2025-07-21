/// <reference types="jest" />

declare global {
  namespace jest {
    interface MockedFunction<T extends (...args: any[]) => any> {
      (...args: Parameters<T>): ReturnType<T>;
      mockReturnValue(value: ReturnType<T>): this;
      mockResolvedValue(value: ReturnType<T>): this;
      mockRejectedValue(value: any): this;
    }
  }
}

export {};