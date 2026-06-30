> 📋 **Phase 4.5 단독 발췌** — v2 설계서에서 이 Phase만 떼어낸 복붙용 파일입니다.
> 첫 Phase를 시작할 땐 먼저 `00_공통_먼저-붙여넣기.md`(전제·절대 규칙·정확도 원칙·아키텍처·데이터 모델)를 AI에 함께 전달하세요.
> 전체 문서: `PDF-to-MXL-웹앱-바이브코딩-프롬프트(v2_정확도_강화판).md`

### Phase 4.5 — 반복 교정 루프 (수렴 제어) · 선택

Phase 4가 "1패스 보정"이라면, 4.5는 그것을 **여러 번 돌려 점진적으로 정확도를 끌어올린다.** 단, **무한 수렴은 보장되지 않는다. Claude는 완벽한 심판이 아니다.** 그래서 5개 수렴 조건을 **전부** 구현해 발산·진동을 막는다. 이 단계는 선택이며, `REFINE_ENABLED=false`면 Phase 4를 1회만 돈다.

핵심 설계: **품질 점수(`accuracy_score`)를 Phase 4의 sanity/검증 + 미해결 `needs_human` 수와 연결**한다. 점수가 비악화일 때만 패스를 채택하고, 악화하면 롤백 후 종료한다.

```text
[프롬프트 — Phase 4.5]
역할: 너는 OMR 보정 파이프라인의 "반복 교정 루프(refine)"를 만드는 백엔드 엔지니어다.
Phase 4(apply/sanity/validate/mxl)는 이미 있다. 그 함수들을 재사용한다.

목표: vision→apply→sanity+validate 를 여러 패스 반복하되, 수렴/진동/악화를 제어해 안전하게 종료한다.
원칙(정직하게 명시): 무한 수렴은 보장되지 않는다. 100% 자동 수렴을 약속하지 않는다.
보통 95~99%는 자동, 남는 1~5%는 needs_human으로 사람에게 넘긴다.

== 산출물 ==
1) /worker/src/score.ts        // 품질 점수
2) /worker/src/oscillation.ts  // 진동 감지(상태 해시 이력)
3) /worker/src/refine.ts       // 루프 오케스트레이션
4) 단위테스트: 정상수렴 / 진동 / 악화롤백 3종

== score.ts (품질 점수) ==
export interface QualityScore {
  accuracy_score: number;   // 높을수록 좋음 (0~1 정규화)
  needs_human: number;      // 미해결로 동결된 마디 수
  xsd_ok: boolean; sanity_ok: boolean;
}
export function scoreState(xml: string, results: PageVerifyResult[],
                           validation: ValidationResult, sanity: SanityReport): QualityScore
점수 정의(가산):
  - 기준: 검증 통과(xsd_ok && sanity_ok)가 아니면 accuracy_score는 0으로 본다(채택 불가).
  - 채택된 보정(applied=true) 1건당 +, confidence high면 가중↑.
  - 미해결 항목(low confidence skip, measure not found 등) needs_human로 카운트, 점수에서 감점.
  - 정규화: accuracy_score = adopted_weighted / (adopted_weighted + unresolved_weighted + ε).
  - (선택) eval 하니스의 music-error-rate류 지표가 있으면 그 값으로 대체/보강.

== oscillation.ts (진동 감지) ==
// 각 measure의 "상태"를 안정적으로 직렬화해 해시. 같은 측정이 이전 상태로 "되돌아가면" 진동.
export function measureStateHash(measureNode): string  // pitch들+harmony+lyric을 정규화 직렬화 후 sha1
export interface OscillationTracker {
  record(pass: number, measureKey: string, hash: string): void;
  // 같은 measureKey가 직전 2개 패스 사이를 왕복(A→B→A)하면 진동으로 판정
  isOscillating(measureKey: string): boolean;
  oscillatingMeasures(): string[];   // measureKey = `${partId}:${measureNumber}`
}

== refine.ts (오케스트레이션 — 5개 수렴 조건 전부) ==
export interface RefineConfig {
  maxIterations: number;     // (1) 상한, 기본 3
  convergeThreshold: number; // (2) 수렴 판정, 기본 1
}
export interface RefineResult {
  finalXml: string; finalMxlPath: string;
  passes: { pass: number; adopted: number; score: QualityScore; }[];
  stopReason: "converged" | "max_iterations" | "oscillation" | "validation_failed" | "no_improvement" | "cost_limit";
  needsHumanMeasures: string[];   // freeze된 measureKey 목록
}

export async function refine(originalXml, pages, cfg, deps): Promise<RefineResult>

의사코드(원본 계승):
  bestXml = originalXml
  bestScore = scoreState(originalXml, [], lastValidation, lastSanity)  // baseline
  frozen = new Set<measureKey>()       // needs_human 동결
  osc = new OscillationTracker()
  for pass in 1..maxIterations:
     # (5) 대상 좁히기: 변경 있던/medium·low 페이지 + frozen 아닌 마디만 재대조
     targetPages = selectTargets(pages, lastResults, frozen)
     results = await visionVerify(targetPages)            # Phase 3
     applied = applyCorrections(bestXml, results, "AUTO_PATCH",
                                { skipMeasures: frozen })  # frozen은 건드리지 않음
     san = musicalSanity(bestXml, applied.musicXml)
     val = await validateMusicXml(tmp(applied.musicXml))

     # (3) 진동 감지: 각 측정 상태 해시 기록
     for m in changedMeasures(applied):
        osc.record(pass, key(m), measureStateHash(m))
        if osc.isOscillating(key(m)):
           frozen.add(key(m)); markNeedsHuman(key(m))     # 동결 + needs_human

     newScore = scoreState(applied.musicXml, results, val, san)

     # (4) 단조 개선 가드: 검증 통과 AND 점수 비악화일 때만 채택
     if (val.ok && san.ok && newScore.accuracy_score >= bestScore.accuracy_score):
        adopted = applied.appliedCount
        bestXml = applied.musicXml; bestScore = newScore
        passes.push({pass, adopted, score:newScore})
     else:
        # 악화/검증실패 → 롤백 + 종료
        stopReason = val.ok && san.ok ? "no_improvement" : "validation_failed"
        break

     # (2) 수렴 판정: 이번 패스 신규 채택 수 <= convergeThreshold면 종료
     if adopted <= cfg.convergeThreshold:
        stopReason = "converged"; break
  else:
     stopReason = "max_iterations"

  if osc.oscillatingMeasures().length and !stopReason: stopReason = "oscillation"
  repackMxl(bestXml, finalMxlPath)                       # 항상 best(검증통과)만 .mxl로
  return { finalXml: bestXml, ..., needsHumanMeasures: [...frozen], stopReason }

== UI 연동(보고) ==
- 종료 사유 배지: 수렴 / 상한 / 진동 / 검증실패 / 무개선.
- needs_human 마디 강조(프론트에서 measureKey로 하이라이트).
- report.json 확장: passes별 {adopted, accuracy_score, needs_human}, 최종 stopReason, needsHumanMeasures.

환경변수: REFINE_ENABLED, MAX_REFINE_ITERATIONS(기본3), CONVERGE_THRESHOLD(기본1).
정직한 한계를 코드 주석과 리포트 문구에 남겨라: 100% 자동수렴은 약속하지 않는다.
```

**산출물**
- `/worker/src/score.ts` — `scoreState(...): QualityScore` (검증 미통과 시 `accuracy_score=0`)
- `/worker/src/oscillation.ts` — `measureStateHash`, `OscillationTracker`
- `/worker/src/refine.ts` — `refine(originalXml, pages, cfg, deps): RefineResult`
- `report.json` 확장: `passes[]`(패스별 채택수·점수·needs_human), `stopReason`, `needsHumanMeasures[]`
- 단위테스트 3종: **정상 수렴 / 진동 감지+freeze / 악화 롤백**

**완료 판정**
- [ ] 5개 수렴 조건 모두 코드에 존재: (1) `maxIterations` 상한, (2) 신규 채택 ≤ `convergeThreshold` 종료, (3) 진동 감지 시 해당 마디 freeze + `needs_human`, (4) 검증 통과 AND 점수 비악화일 때만 채택(악화 시 롤백+종료), (5) 변경/medium·low 페이지만 재대조.
- [ ] **정상 케이스**: 보정이 1패스 후 더 채택할 게 없으면 `stopReason:"converged"`로 1~2패스 내 종료.
- [ ] **진동 케이스**(한 마디가 A→B→A로 왕복하도록 vision 응답을 모킹): 해당 `measureKey`가 `needsHumanMeasures`에 들어가고 더 이상 변경 안 됨.
- [ ] **악화 케이스**(패스 결과가 `accuracy_score`를 떨어뜨리도록 모킹): 채택 안 하고 `bestXml` 유지, `stopReason:"no_improvement"`(또는 검증 깨지면 `"validation_failed"`).
- [ ] 최종 `.mxl`은 **항상 검증을 통과한 best 상태**에서만 재압축된다(중간 실패본이 사용자에게 가지 않음).
- [ ] `REFINE_ENABLED=false`면 루프가 돌지 않고 Phase 4를 1회만 수행.

**정직한 한계 (반드시 리포트/UI에 노출)**

> ⚠️ **정직한 한계 — 약속하지 않는 것**
> - 이 루프는 **수렴을 보장하지 않는다.** Claude Vision은 빽빽한 음표 카운팅·정밀 박자 판정에서 약하고(공식 문서가 명시), 완벽한 심판이 아니다. 따라서 "돌리면 100% 맞아진다"는 약속은 하지 않는다.
> - 현실적 기대치는 **보통 95~99% 자동 교정, 남는 1~5%는 `needs_human`**으로 사람에게 넘긴다. 진동·발산하는 마디는 강제 동결되어 그 자체로 "여기는 사람이 봐야 한다"는 신호가 된다.
> - 루프는 **품질을 절대 악화시키지 않는다**(단조 개선 가드 + 검증 게이트). 더 못 만들 바엔 직전 best, 그것도 안 되면 Audiveris 원본을 반환한다. 즉 **최악의 경우에도 무보정 baseline은 보장**되고, 그 이상은 "운이 좋으면 더 좋아지는" 영역으로 솔직하게 다룬다.
> - 종료 사유 배지(수렴/상한/진동/검증실패/무개선)와 `needs_human` 마디 강조로, 사용자가 "어디를 믿고 어디를 직접 봐야 하는지"를 항상 알 수 있게 한다.

**참고 모델 ID(이 단계에서 고정)**: 1차 전수 대조는 `claude-sonnet-4-6`, 저신뢰(`confidence:"low"`) 또는 `wrong_notes` 임계 초과 페이지만 `claude-opus-4-8`로 승격(Phase 3 티어링 계승). 두 모델 모두 구조화 출력(JSON schema 강제)을 지원하므로 보정 JSON 스키마를 강제해 파싱 실패를 줄인다.
