import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

const main = async () => {
  console.log(
    'template entityTypes:',
    JSON.stringify(await p.approvalTemplate.groupBy({ by: ['entityType'], _count: true })),
  );
  console.log(
    'ruleset entityTypes:',
    JSON.stringify(await p.approvalRuleSet.groupBy({ by: ['entityType'], _count: true })),
  );
  console.log(
    'request entityTypes:',
    JSON.stringify(await p.approvalRequest.groupBy({ by: ['entityType'], _count: true })),
  );
};

main()
  .catch((e) => console.error(e))
  .finally(async () => {
    await p.$disconnect();
    process.exit(0);
  });
