let counter = 0;

/** 生成唯一 ID（本地足够） */
export function genId(): string {
  counter = (counter + 1) % 46656;
  return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
