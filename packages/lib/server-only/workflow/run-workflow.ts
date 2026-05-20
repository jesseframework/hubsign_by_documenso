/**
 * Workflow execution engine.
 *
 * Walks the step graph of a WorkflowRun's definition, one step at a time, until
 * there are no more steps. Designed to be driven by the jobs system (Inngest /
 * Local): each step's work runs inside `io.runTask` and returns the next pointer
 * plus the updated variable bag, so retries/replays are idempotent regardless of
 * provider. Delays use `io.wait`.
 *
 * Every step writes a WorkflowRunStep row for observability.
 */

import { WorkflowRunStatus, WorkflowRunStepStatus } from '@prisma/client';

import { prisma } from '@documenso/prisma';

import type { Json } from '../../jobs/client/_internal/json';
import type { JobRunIO } from '../../jobs/client/_internal/job';
import type { TWorkflowDefinition, TWorkflowStep, TWorkflowVariables } from '../../types/workflow';
import { ZWorkflowDefinitionSchema } from '../../types/workflow';
import { runAction } from './actions';
import { evaluateCondition, evaluateLogic } from './logic';

/** Hard ceiling on steps per run to prevent runaway loops. */
const MAX_STEPS = 1000;

type StepOutcome = {
  next?: string;
  vars: TWorkflowVariables;
};

/** DELAY steps are handled by the main loop (they need `io.wait`), never here. */
type ProcessableStep = Exclude<TWorkflowStep, { type: 'DELAY' }>;

const delayToMs = (config: {
  ms?: number;
  seconds?: number;
  minutes?: number;
  hours?: number;
  days?: number;
}): number =>
  (config.ms ?? 0) +
  (config.seconds ?? 0) * 1_000 +
  (config.minutes ?? 0) * 60_000 +
  (config.hours ?? 0) * 3_600_000 +
  (config.days ?? 0) * 86_400_000;

/**
 * Process a single non-delay step: record a row, run it, return where to go next
 * and the (possibly updated) variable bag.
 */
const processStep = async (
  runId: string,
  step: ProcessableStep,
  context: Record<string, unknown>,
  varsIn: TWorkflowVariables,
  io: JobRunIO,
): Promise<StepOutcome> => {
  const vars: TWorkflowVariables = { ...varsIn };
  const data = { ...context, vars };

  const stepRow = await prisma.workflowRunStep.create({
    data: {
      runId,
      stepId: step.id,
      type: step.type,
      status: WorkflowRunStepStatus.RUNNING,
      input: { config: step.config } as PrismaJson.WorkflowVariables,
      startedAt: new Date(),
    },
  });

  const fail = async (error: unknown): Promise<StepOutcome> => {
    const message = error instanceof Error ? error.message : String(error);

    await prisma.workflowRunStep.update({
      where: { id: stepRow.id },
      data: {
        status: WorkflowRunStepStatus.FAILED,
        error: message,
        finishedAt: new Date(),
      },
    });

    // onError routing: jump to a step, continue, or fail the whole run.
    if (step.onError && step.onError !== 'FAIL') {
      if (step.onError === 'CONTINUE') {
        return { next: 'next' in step ? step.next : undefined, vars };
      }
      return { next: step.onError, vars };
    }

    throw error instanceof Error ? error : new Error(message);
  };

  try {
    let next: string | undefined;
    let output: Record<string, unknown> = {};

    switch (step.type) {
      case 'CONDITION': {
        const result = evaluateCondition(step.config.rule, data);
        next = result ? step.next : step.else;
        output = { result, taken: result ? 'next' : 'else' };
        break;
      }

      case 'BRANCH': {
        const matchedIndex = step.config.branches.findIndex((b) =>
          evaluateCondition(b.when, data),
        );
        if (matchedIndex >= 0) {
          next = step.config.branches[matchedIndex].next;
          output = { matchedIndex };
        } else {
          next = step.else;
          output = { matchedIndex: -1, taken: 'else' };
        }
        break;
      }

      case 'SET_VARIABLE': {
        const assigned: Record<string, unknown> = {};
        for (const [key, rule] of Object.entries(step.config.assignments)) {
          const value = evaluateLogic(rule, data);
          vars[key] = value;
          assigned[key] = value;
        }
        next = step.next;
        output = { assigned };
        break;
      }

      case 'ACTION': {
        const result = await runAction(step.config, { data, logger: io.logger });
        // HTTP responses can be captured into a variable for later steps.
        if (
          step.config.action === 'HTTP_REQUEST' &&
          step.config.saveResponseAs &&
          result &&
          typeof result === 'object'
        ) {
          vars[step.config.saveResponseAs] = (result as { body?: unknown }).body ?? null;
        }
        next = step.next;
        output = { result: result as unknown } as Record<string, unknown>;
        break;
      }

      default: {
        // Exhaustiveness guard.
        const _never: never = step;
        throw new Error(`Unsupported step type: ${JSON.stringify(_never)}`);
      }
    }

    await prisma.workflowRunStep.update({
      where: { id: stepRow.id },
      data: {
        status: WorkflowRunStepStatus.COMPLETED,
        output: output as PrismaJson.WorkflowVariables,
        finishedAt: new Date(),
      },
    });

    // Persist the variable bag so it survives across job retries / restarts.
    await prisma.workflowRun.update({
      where: { id: runId },
      data: { variables: vars as PrismaJson.WorkflowVariables },
    });

    return { next, vars };
  } catch (error) {
    return fail(error);
  }
};

/**
 * Execute a WorkflowRun to completion. Safe to call repeatedly for the same run
 * id — terminal runs are ignored.
 */
export const executeWorkflowRun = async ({
  runId,
  io,
}: {
  runId: string;
  io: JobRunIO;
}): Promise<{ status: WorkflowRunStatus }> => {
  const run = await prisma.workflowRun.findUnique({
    where: { id: runId },
    include: { workflow: true },
  });

  if (!run) {
    throw new Error(`WorkflowRun ${runId} not found`);
  }

  if (run.status === WorkflowRunStatus.COMPLETED || run.status === WorkflowRunStatus.FAILED) {
    return { status: run.status };
  }

  let definition: TWorkflowDefinition;
  try {
    definition = ZWorkflowDefinitionSchema.parse(run.workflow.definition);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid workflow definition';
    await prisma.workflowRun.update({
      where: { id: runId },
      data: { status: WorkflowRunStatus.FAILED, error: message, finishedAt: new Date() },
    });
    return { status: WorkflowRunStatus.FAILED };
  }

  await prisma.workflowRun.update({
    where: { id: runId },
    data: { status: WorkflowRunStatus.RUNNING, startedAt: run.startedAt ?? new Date() },
  });

  const context = (run.context ?? {}) as Record<string, unknown>;
  let vars: TWorkflowVariables = (run.variables ?? {}) as TWorkflowVariables;

  const stepIds = Object.keys(definition.steps);
  let currentId: string | undefined = definition.startStepId ?? stepIds[0];
  let index = 0;

  try {
    while (currentId && index < MAX_STEPS) {
      // Honour cancellation requested while we were running.
      const status = await prisma.workflowRun.findUnique({
        where: { id: runId },
        select: { status: true },
      });
      if (status?.status === WorkflowRunStatus.CANCELLED) {
        return { status: WorkflowRunStatus.CANCELLED };
      }

      const step: TWorkflowStep | undefined = definition.steps[currentId];
      if (!step) {
        throw new Error(`Step "${currentId}" referenced but not defined`);
      }

      if (step.type === 'DELAY') {
        const ms = delayToMs(step.config);
        await io.wait(`wait-${index}-${step.id}`, ms);
        await io.runTask(`step-${index}-${step.id}`, async () => {
          await prisma.workflowRunStep.create({
            data: {
              runId,
              stepId: step.id,
              type: step.type,
              status: WorkflowRunStepStatus.COMPLETED,
              output: { waitedMs: ms } as PrismaJson.WorkflowVariables,
              startedAt: new Date(),
              finishedAt: new Date(),
            },
          });
        });
        currentId = step.next;
        index += 1;
        continue;
      }

      // The IO layer constrains task results to `Json`; our StepOutcome carries
      // an arbitrary variable bag, so round-trip it through the Json cast (it is
      // always JSON-serialisable in practice) and narrow back on the way out.
      const outcome = (await io.runTask(
        `step-${index}-${step.id}`,
        async () => (await processStep(runId, step, context, vars, io)) as unknown as Json,
      )) as unknown as StepOutcome;

      vars = outcome.vars;
      currentId = outcome.next;
      index += 1;
    }

    if (index >= MAX_STEPS) {
      throw new Error(`Workflow exceeded the maximum of ${MAX_STEPS} steps (possible loop)`);
    }

    await prisma.workflowRun.update({
      where: { id: runId },
      data: {
        status: WorkflowRunStatus.COMPLETED,
        variables: vars as PrismaJson.WorkflowVariables,
        finishedAt: new Date(),
      },
    });

    return { status: WorkflowRunStatus.COMPLETED };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await prisma.workflowRun.update({
      where: { id: runId },
      data: { status: WorkflowRunStatus.FAILED, error: message, finishedAt: new Date() },
    });

    return { status: WorkflowRunStatus.FAILED };
  }
};
