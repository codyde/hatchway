export interface SSEPayloadParser {
  push: (chunk: string) => string[];
  finish: () => string[];
}

export function createSSEPayloadParser(): SSEPayloadParser {
  let lineBuffer = '';
  let dataLines: string[] = [];

  const processLine = (line: string, payloads: string[]) => {
    if (line.length === 0) {
      if (dataLines.length > 0) {
        payloads.push(dataLines.join('\n'));
        dataLines = [];
      }
      return;
    }

    if (line.startsWith(':')) return;

    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) {
      // Keep compatibility with runner output that contains an unprefixed data line.
      dataLines.push(line.trim());
      return;
    }

    const field = line.slice(0, separatorIndex);
    if (field !== 'data') {
      if (field !== 'event' && field !== 'id' && field !== 'retry') {
        dataLines.push(line.trim());
      }
      return;
    }

    const rawValue = line.slice(separatorIndex + 1);
    dataLines.push(rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue);
  };

  const push = (chunk: string) => {
    const payloads: string[] = [];
    if (!chunk) return payloads;

    lineBuffer += chunk;
    let lineStart = 0;
    let index = 0;

    while (index < lineBuffer.length) {
      const character = lineBuffer[index];
      if (character === '\n') {
        processLine(lineBuffer.slice(lineStart, index), payloads);
        index += 1;
        lineStart = index;
        continue;
      }

      if (character === '\r') {
        // A trailing CR may be the first half of CRLF in the next chunk.
        if (index + 1 === lineBuffer.length) break;

        processLine(lineBuffer.slice(lineStart, index), payloads);
        index += lineBuffer[index + 1] === '\n' ? 2 : 1;
        lineStart = index;
        continue;
      }

      index += 1;
    }

    lineBuffer = lineBuffer.slice(lineStart);
    return payloads;
  };

  const finish = () => {
    const payloads: string[] = [];

    if (lineBuffer.length > 0) {
      const finalLine = lineBuffer.endsWith('\r')
        ? lineBuffer.slice(0, -1)
        : lineBuffer;
      processLine(finalLine, payloads);
      lineBuffer = '';
    }

    if (dataLines.length > 0) {
      payloads.push(dataLines.join('\n'));
      dataLines = [];
    }

    return payloads;
  };

  return { push, finish };
}
