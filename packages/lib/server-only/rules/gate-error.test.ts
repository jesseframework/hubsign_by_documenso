/**
 * The refusal a gate throws has to arrive at the signer as readable text.
 *
 * The bug these cover: the block was thrown as UNKNOWN_ERROR with the authored
 * text only in `message` — the field defined as internal-for-logging. The server
 * refused correctly and the signing dialog sat open saying nothing, which reads
 * to the signer as a broken button rather than a policy they can act on.
 */
import { describe, expect, it } from 'vitest';

import { AppError, AppErrorCode, genericErrorCodeToTrpcErrorCodeMap } from '../../errors/app-error';
import { describeBlocks } from './evaluate-gate';
import type { GateVerdict } from './types';

const REFUSAL = 'This invoice has no valid PO number. Add one before signing.';

/** Exactly what `complete-document-with-token` throws when a rule blocks. */
const gateRefusal = (reason: string) =>
  new AppError(AppErrorCode.INVALID_REQUEST, {
    message: reason,
    userMessage: reason,
    statusCode: 400,
  });

/** What the client sees: tRPC puts `AppError.toJSON` on `error.data.appError`. */
const asClientError = (err: AppError) => ({
  name: 'TRPCClientError',
  message: 'some transport-level message',
  data: { appError: AppError.toJSON(err) },
});

describe('gate refusal → signer', () => {
  it('survives serialization to the client with a displayable message', () => {
    const received = AppError.parseError(asClientError(gateRefusal(REFUSAL)));

    expect(received.userMessage).toBe(REFUSAL);
    expect(received.code).toBe(AppErrorCode.INVALID_REQUEST);
  });

  it('is reported as a bad request, not a server fault', () => {
    // UNKNOWN_ERROR maps to a 500, which would log a deliberate policy decision
    // as an application failure.
    expect(genericErrorCodeToTrpcErrorCodeMap[AppErrorCode.INVALID_REQUEST]).toEqual({
      code: 'BAD_REQUEST',
      status: 400,
    });
    expect(genericErrorCodeToTrpcErrorCodeMap[AppErrorCode.UNKNOWN_ERROR].status).toBe(500);
  });

  it('is not masked by the REST error path', () => {
    // toRestAPIError replaces the message with "Something went wrong" for any code
    // it maps to 500 — the previous code was one of those.
    expect(AppError.toRestAPIError(gateRefusal(REFUSAL)).body.message).toBe(REFUSAL);
    expect(
      AppError.toRestAPIError(new AppError(AppErrorCode.UNKNOWN_ERROR, { message: REFUSAL })).body
        .message,
    ).toBe('Something went wrong');
  });

  it('joins multiple blocking rules into one message', () => {
    const verdict: GateVerdict = {
      allowed: false,
      blocks: [
        { ruleId: 'a', name: 'PO required', outcome: 'BLOCK', message: 'Add a PO number.' },
        { ruleId: 'b', name: 'Over 300k', outcome: 'BLOCK', message: 'Needs a second approver.' },
      ],
      warnings: [],
      evaluated: 2,
    };

    // One rule per line, so the signer can be shown a list rather than a
    // run-on sentence stacking every policy that fired.
    expect(describeBlocks(verdict)).toBe('Add a PO number.\nNeeds a second approver.');
  });
});
