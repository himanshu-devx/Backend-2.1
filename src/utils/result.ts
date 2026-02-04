// utils/result.ts

export type Ok<T> = { ok: true; value: T };
export type Err<E = string> = { ok: false; error: E };
export type Result<T, E = string> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

// Type guards
export const isOk = <T, E>(r: Result<T, E>): r is Ok<T> => r.ok === true;
export const isErr = <T, E>(r: Result<T, E>): r is Err<E> => r.ok === false;

// Map success value
export const map = <T, U, E>(
  r: Result<T, E>,
  fn: (value: T) => U
): Result<U, E> => (isOk(r) ? ok(fn(r.value)) : r);

// Map error value
export const mapError = <T, E, F>(
  r: Result<T, E>,
  fn: (error: E) => F
): Result<T, F> => (isErr(r) ? err(fn(r.error)) : r);

// FlatMap / andThen
export const andThen = <T, U, E>(
  r: Result<T, E>,
  fn: (value: T) => Result<U, E>
): Result<U, E> => (isOk(r) ? fn(r.value) : r);

// From nullable
export const fromNullable = <T, E>(
  value: T | null | undefined,
  error: E
): Result<T, E> => (value == null ? err(error) : ok(value));

// From promise
export const fromPromise = async <T, E = unknown>(
  p: Promise<T>,
  onError: (e: unknown) => E
): Promise<Result<T, E>> => {
  try {
    const value = await p;
    return ok(value);
  } catch (e) {
    return err(onError(e));
  }
};

// all() – fail fast on first Err
export const all = <T, E>(results: Result<T, E>[]): Result<T[], E> => {
  const values: T[] = [];
  for (const r of results) {
    if (isErr(r)) return r;
    values.push(r.value);
  }
  return ok(values);
};
