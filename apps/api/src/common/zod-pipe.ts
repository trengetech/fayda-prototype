import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/** Validates a request value against a contract schema. Failures become 400 VALIDATION via ProblemFilter. */
@Injectable()
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}
  transform(value: unknown): T {
    return this.schema.parse(value);
  }
}
