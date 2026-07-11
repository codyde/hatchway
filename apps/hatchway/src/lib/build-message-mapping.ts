export interface RequestMessageLike {
  id: string;
}

export interface RequestBuildLike {
  id: string;
  requestMessageId?: string | null;
  operationType?: string;
  isAutoFix?: boolean;
  startTime?: Date | string | number;
}

export interface BuildMessageMapping<TBuild> {
  buildByMessageId: Map<string, TBuild>;
  unlinkedBuilds: TBuild[];
}

function buildTimestamp(build: RequestBuildLike): number {
  if (build.startTime instanceof Date) return build.startTime.getTime();
  if (build.startTime === undefined) return 0;
  const timestamp = new Date(build.startTime).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function isLegacyRequestBuild(build: RequestBuildLike): boolean {
  return !build.isAutoFix && build.operationType !== 'autofix' && build.operationType !== 'continuation';
}

export function mapBuildsToRequestMessages<
  TMessage extends RequestMessageLike,
  TBuild extends RequestBuildLike,
>(messages: TMessage[], builds: TBuild[]): BuildMessageMapping<TBuild> {
  const messageIds = new Set(messages.map((message) => message.id));
  const buildByMessageId = new Map<string, TBuild>();
  const unlinkedBuilds: TBuild[] = [];
  const legacyBuilds: TBuild[] = [];

  const chronologicalBuilds = [...builds].sort((left, right) => {
    const timeDifference = buildTimestamp(left) - buildTimestamp(right);
    return timeDifference || left.id.localeCompare(right.id);
  });

  for (const build of chronologicalBuilds) {
    if (build.requestMessageId) {
      if (messageIds.has(build.requestMessageId) && !buildByMessageId.has(build.requestMessageId)) {
        buildByMessageId.set(build.requestMessageId, build);
      } else {
        unlinkedBuilds.push(build);
      }
      continue;
    }

    if (isLegacyRequestBuild(build)) {
      legacyBuilds.push(build);
    } else {
      unlinkedBuilds.push(build);
    }
  }

  const legacyMessages = messages.filter((message) => !buildByMessageId.has(message.id));
  legacyBuilds.forEach((build, index) => {
    const message = legacyMessages[index];
    if (message) {
      buildByMessageId.set(message.id, build);
    } else {
      unlinkedBuilds.push(build);
    }
  });

  return { buildByMessageId, unlinkedBuilds };
}
