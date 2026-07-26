/**
 * 회원 경계를 지키는 배치 청킹.
 *
 * geo_citations 를 고정 크기(200행)로 자르면 한 회원의 행이 두 청크로 갈릴 수 있다.
 * 앞 청크만 성공하고 뒤 청크가 실패하면 그 회원은 **부분 표본**으로 남아
 * 주간 인용률이 조용히 왜곡된다("전부 아니면 전무" 원칙 위반).
 * → 그룹(회원) 단위를 절대 쪼개지 않고 채워 넣는다.
 *
 * 한 그룹이 상한보다 크면 그 그룹만 단독 청크로 만든다(쪼개는 것보다 낫다).
 * 회원당 최대 행 수는 5질의 × 3엔진 = 15 이므로 실제로는 발생하지 않는다.
 *
 * 외부 의존 없는 순수 모듈(@/ alias import 금지).
 */

export function chunkGroups<T>(groups: readonly (readonly T[])[], maxChunkSize: number): T[][] {
  const limit = Math.max(1, maxChunkSize);
  const chunks: T[][] = [];
  let current: T[] = [];

  for (const group of groups) {
    if (group.length === 0) continue;

    // 그룹 자체가 상한을 넘으면 단독 청크로 분리한다(그룹은 쪼개지 않는다)
    if (group.length >= limit) {
      if (current.length > 0) {
        chunks.push(current);
        current = [];
      }
      chunks.push([...group]);
      continue;
    }

    if (current.length + group.length > limit) {
      chunks.push(current);
      current = [];
    }
    current.push(...group);
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}
