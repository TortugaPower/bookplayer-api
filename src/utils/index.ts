export const splitArrayGroups = (array: unknown[], chunkSize: number) => {
  const chunks = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    const chunk = array.slice(i, i + chunkSize);
    chunks.push(chunk);
  }
  return chunks;
};

/**
 * Detects excessive consecutive folder name repetition in a path
 * Useful for catching app bugs that create nested duplicate folders
 * @param path - The relative path to validate (e.g., "Documents/Documents/Documents")
 * @param maxConsecutiveRepeats - Maximum allowed consecutive identical folder names (default: 5)
 * @returns Object with isExcessive flag and details about the repetition
 */
export const detectExcessiveFolderNesting = (
  path: string,
  maxConsecutiveRepeats: number = 5,
): {
  isExcessive: boolean;
  repeatedFolder?: string;
  consecutiveCount?: number;
  totalCount?: number;
} => {
  const pathSegments = path.split('/').filter((s) => s.length > 0);

  if (pathSegments.length === 0) {
    return { isExcessive: false };
  }

  let consecutiveCount = 1;
  let maxConsecutive = 1;
  let repeatedFolder = pathSegments[0];

  // Check for repeated folder names
  for (let i = 1; i < pathSegments.length; i++) {
    if (pathSegments[i] === pathSegments[i - 1]) {
      consecutiveCount++;
      if (consecutiveCount > maxConsecutive) {
        maxConsecutive = consecutiveCount;
        repeatedFolder = pathSegments[i];
      }
    } else {
      consecutiveCount = 1;
    }
  }

  if (maxConsecutive >= maxConsecutiveRepeats) {
    const totalCount = pathSegments.filter((s) => s === repeatedFolder).length;
    return {
      isExcessive: true,
      repeatedFolder,
      consecutiveCount: maxConsecutive,
      totalCount,
    };
  }

  return { isExcessive: false };
};
