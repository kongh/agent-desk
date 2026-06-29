export function formatElapsedTime(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}min ${seconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}min ${seconds}s`;
  }

  return `${seconds}s`;
}


export function formatRelativeTime(date: Date, now = new Date()) {
  const totalSeconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  const minutes = Math.floor(totalSeconds / 60);

  if (minutes < 1) {
    return "刚刚";
  }

  if (minutes < 60) {
    return `${minutes} 分`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 时`;
  }

  const days = Math.floor(hours / 24);
  return `${days} 天`;
}
