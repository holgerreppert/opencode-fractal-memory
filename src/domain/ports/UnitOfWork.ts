export interface UnitOfWork {
  withTransaction<T>(operation: () => T | Promise<T>): Promise<T>;
}
