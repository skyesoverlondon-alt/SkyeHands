import fs from 'node:fs';

function stripQuotes(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}

export function parseDotEnv(contents) {
  const values = {};

  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex < 1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = stripQuotes(line.slice(separatorIndex + 1).trim());
    values[key] = value;
  }

  return values;
}

export function readEnvFiles(filePaths) {
  return filePaths.reduce((merged, filePath) => {
    if (!fs.existsSync(filePath)) {
      return merged;
    }

    return {
      ...merged,
      ...parseDotEnv(fs.readFileSync(filePath, 'utf8'))
    };
  }, {});
}