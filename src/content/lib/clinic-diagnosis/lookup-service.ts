import {
  findClinicByMngNo,
  lookupClinicsDetailed,
  scoreCandidate,
  splitRegionHint,
} from './registry';
import {
  combineWithDirectory,
  isDirectoryMngNo,
  shouldTryDirectory,
  type CombinedLookup,
} from './directory';
import { createDirectorySearch, findDirectoryClinic } from './directory-db';
import type { ClinicCandidate } from './types';

/**
 * 병원 특정의 **단일 진입점** — 행정안전부(정본) → 폴백 명부(심평원 공개자료) 순.
 *
 * 라우트가 registry 를 직접 부르지 않고 여기만 부르게 하는 이유는 하나다.
 * 조회 경로가 두 군데(/lookup 과 진단 재확인)로 갈라져 있으면, 폴백을 한쪽에만
 * 붙이는 순간 "목록에서는 고를 수 있는데 누르면 다시 못 찾는" 상태가 된다.
 */

/**
 * 이름(+지역)으로 병원 후보를 찾는다.
 * 행안부가 0건이거나 호출 자체가 실패했을 때만 폴백 명부로 내려간다.
 */
export async function lookupClinicWithFallback(
  name: string,
  region: string,
): Promise<CombinedLookup> {
  const { outcome: registryOutcome, trace } = await lookupClinicsDetailed(name, { region });
  // 행안부가 제대로 답한 경우(대부분)에는 폴백 클라이언트를 만들지도 않는다.
  const combined = await combineWithDirectory(registryOutcome, name, {
    search: shouldTryDirectory(registryOutcome) ? createDirectorySearch() : null,
    region,
  });

  if (combined.usedDirectory) {
    // 폴백이 실제로 화면을 살린 순간이다 — 행안부가 조용히 죽어 있었다는 증거이기도 하다.
    console.warn(
      `[clinic-diagnosis/lookup] 폴백 사용 registry=${registryOutcome.kind} ` +
        `fallback=${combined.outcome.kind} name="${trace.name}" region="${trace.region}"`,
    );
  }
  return combined;
}

/**
 * 확정된 식별자로 병원 1건을 서버에서 다시 확인한다 (진단 진입 전 재검증).
 *
 * 식별자 접두사로 원천을 가른다 — 클라이언트가 준 병원 정보를 그대로 믿지 않는다는
 * 원칙은 폴백에서도 동일하다.
 */
export async function resolveClinicForDiagnosis(
  mngNo: string,
  name: string,
  region: string,
): Promise<ClinicCandidate | null> {
  if (isDirectoryMngNo(mngNo)) {
    const clinic = await findDirectoryClinic(mngNo);
    if (!clinic) return null;
    // 식별자만 맞고 이름이 전혀 다르면 거부한다(오래된 화면·조작 방어).
    const queryName = splitRegionHint(name, region).name;
    if (scoreCandidate(clinic, queryName) < 30) {
      console.warn('[clinic-diagnosis] 폴백 재확인 이름 불일치로 거부');
      return null;
    }
    return clinic;
  }
  return findClinicByMngNo(mngNo, name, { region });
}
